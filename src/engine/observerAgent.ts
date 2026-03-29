import type { FrictionLog, FrictionCluster, ApiStatusCode } from '../types';

// ─── Feature extraction ───────────────────────────────────────────────────────
const errorSeverity: Record<number, number> = { 402: 0.5, 408: 0.6, 500: 0.7, 503: 0.8, 504: 1.0 };

type FeatureVector = [number, number, number, number, number, number, number];

function toFeatureVector(log: FrictionLog): FeatureVector {
  const { latencyMs, retryCount, apiStatusCode } = log.systemContext;
  const { nps, creditScore, tenureMonths, tier } = log.userMetadata;
  return [
    log.frictionScore,                                  // overall friction
    Math.min(latencyMs / 12000, 1),                     // latency norm
    retryCount / 4,                                     // retry norm
    errorSeverity[apiStatusCode] ?? 0.5,                // error severity
    (nps + 2) / 4,                                      // nps norm (0–1)
    tier === 'Platinum' ? 1 : 0,                        // tier bit
    Math.min(tenureMonths / 120, 1),                    // tenure norm
    // credit score unused in distance but kept for reporting
    Math.min((creditScore - 580) / 240, 1),
  ] as unknown as FeatureVector;
}

function euclidean(a: number[], b: number[]): number {
  let sum = 0;
  for (let i = 0; i < a.length; i++) sum += (a[i] - b[i]) ** 2;
  return Math.sqrt(sum);
}

// ─── Cluster label templates ──────────────────────────────────────────────────
const CLUSTER_META: Record<string, { label: string; sentiment: string; color: string }> = {
  '504': {
    label: 'Timeout Cascade',
    sentiment: 'Persistent gateway timeouts leaving customers in limbo with debited but undelivered funds.',
    color: '#ef4444',
  },
  '408': {
    label: 'Silent Drop',
    sentiment: 'Requests dispatched but silently dropped — customers receive no confirmation and no recourse.',
    color: '#f59e0b',
  },
  '402': {
    label: 'Auth & Policy Barrier',
    sentiment: 'Policy restrictions and eligibility walls block legitimate cross-border transfers mid-flight.',
    color: '#a855f7',
  },
  '503': {
    label: 'Network Instability',
    sentiment: 'Repeated 503s from flapping DuitNow gateway erode trust in real-time payment reliability.',
    color: '#3b82f6',
  },
  '500': {
    label: 'Partial Settlement Limbo',
    sentiment: 'Debit succeeds but credit leg stalls — customers face ambiguous fund status for hours.',
    color: '#22c55e',
  },
};

function labelCluster(
  dominantCode: ApiStatusCode,
  avgFriction: number,
  idx: number,
): { label: string; sentiment: string; color: string } {
  const meta = CLUSTER_META[String(dominantCode)];
  if (meta) return meta;
  return {
    label: `Friction Group ${String.fromCharCode(65 + idx)}`,
    sentiment: `Unresolved payment friction with avg score ${avgFriction.toFixed(2)}.`,
    color: '#6b7280',
  };
}

// ─── K-means clustering ───────────────────────────────────────────────────────
function initCentroids(vectors: number[][], k: number): number[][] {
  // Spread-maximizing init: pick k points that maximize pairwise distance
  const sorted = [...vectors].map((v, i) => ({ v, i })).sort((a, b) => b.v[0] - a.v[0]);
  const centroids: number[][] = [sorted[0].v];
  while (centroids.length < k) {
    let maxDist = -1;
    let best = sorted[0].v;
    for (const { v } of sorted) {
      const minD = Math.min(...centroids.map(c => euclidean(v, c)));
      if (minD > maxDist) { maxDist = minD; best = v; }
    }
    centroids.push(best);
  }
  return centroids;
}

export function runObserverAgent(logs: FrictionLog[], k = 4): FrictionCluster[] {
  const vectors = logs.map(toFeatureVector);
  let centroids = initCentroids(vectors, k);

  let assignments: number[] = new Array(logs.length).fill(0);

  for (let iter = 0; iter < 50; iter++) {
    // Assign each log to nearest centroid
    const newAssignments = vectors.map(v =>
      centroids.reduce(
        (best, c, ci) => (euclidean(v, c) < euclidean(v, centroids[best]) ? ci : best),
        0,
      ),
    );

    // Check convergence
    if (newAssignments.every((a, i) => a === assignments[i])) break;
    assignments = newAssignments;

    // Recompute centroids
    centroids = centroids.map((_, ci) => {
      const members = vectors.filter((__, li) => assignments[li] === ci);
      if (members.length === 0) return centroids[ci];
      const mean = new Array(vectors[0].length).fill(0);
      for (const v of members) v.forEach((x, j) => (mean[j] += x / members.length));
      return mean;
    });
  }

  // Build cluster objects
  const clusterIds = Array.from({ length: k }, (_, i) => i);
  const clusters: FrictionCluster[] = clusterIds.map((ci, idx) => {
    const memberLogs = logs.filter((_, li) => assignments[li] === ci);
    if (memberLogs.length === 0) return null;

    const logIds = memberLogs.map(l => l.id);
    const avgFriction = memberLogs.reduce((s, l) => s + l.frictionScore, 0) / memberLogs.length;
    const avgLatency = memberLogs.reduce((s, l) => s + l.systemContext.latencyMs, 0) / memberLogs.length;
    const avgCredit = memberLogs.reduce((s, l) => s + l.userMetadata.creditScore, 0) / memberLogs.length;

    // Dominant error code = most frequent in cluster
    const codeCounts: Record<number, number> = {};
    for (const l of memberLogs) {
      codeCounts[l.systemContext.apiStatusCode] = (codeCounts[l.systemContext.apiStatusCode] ?? 0) + 1;
    }
    const dominantErrorCode = Number(
      Object.entries(codeCounts).sort((a, b) => b[1] - a[1])[0][0],
    ) as ApiStatusCode;

    const tierBreakdown = {
      Platinum: memberLogs.filter(l => l.userMetadata.tier === 'Platinum').length,
      Gold: memberLogs.filter(l => l.userMetadata.tier === 'Gold').length,
    };

    const { label, sentiment, color } = labelCluster(dominantErrorCode, avgFriction, idx);

    return {
      id: `CLUSTER-${String.fromCharCode(65 + idx)}`,
      label,
      coreSentiment: sentiment,
      businessFrequency: memberLogs.length / logs.length,
      logIds,
      dominantErrorCode,
      avgFrictionScore: avgFriction,
      avgLatencyMs: Math.round(avgLatency),
      avgCreditScore: Math.round(avgCredit),
      tierBreakdown,
      color,
    };
  }).filter(Boolean) as FrictionCluster[];

  // Sort descending by business frequency
  return clusters.sort((a, b) => b.businessFrequency - a.businessFrequency);
}
