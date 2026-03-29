import type {
  FrictionCluster,
  FrictionLog,
  InsightCard,
  StrategicRecommendation,
  ValueProjection,
  Priority,
} from '../types';
import { callGemini, extractJson } from '../lib/aiClient';
import type { GeminiCallMeta } from '../lib/aiClient';

export interface StrategistAIResult {
  recommendation: StrategicRecommendation;
  meta: GeminiCallMeta | null;
}

// ─── Transaction value estimates by error archetype ───────────────────────────
// Based on typical DBS cross-border PayNow-DuitNow transfer amounts (SGD)
const AVG_TXN_VALUE: Record<string, number> = {
  'Timeout Loop':     3_200,
  'Auth Rejected':    2_800,
  'Silent Drop':      4_100,
  'Partial Process':  3_600,
  'Network Flap':     1_950,
  'Duplicate Charge': 4_800,
  'FX Rate Dispute':  3_000,
  'Wrong Recipient':  3_500,
};
const DEFAULT_TXN_VALUE = 3_000;

// ─── Tier multipliers ─────────────────────────────────────────────────────────
const TIER_MULTIPLIER: Record<string, number> = {
  Platinum: 1.5,
  Gold:     1.2,
  Basic:    1.0,
};

// ─── Recommendation templates ─────────────────────────────────────────────────
interface RecoTemplate {
  title: string;
  rationale: string;
  action: string;
  quickWins: string[];
  longTermFix: string;
  baseBizImpact: number;   // 0–1
  baseFrustration: number; // 0–1
}

const RECO_MAP: Record<string, RecoTemplate> = {
  'Timeout Loop': {
    title: 'Implement Adaptive Timeout + Circuit Breaker on DuitNow Gateway',
    rationale:
      'Every failed PayNow-DuitNow transfer during a timeout window represents a Platinum ' +
      'or Gold customer with SGD 3,200 stranded. The 504 storm is predictable and ' +
      'preventable with circuit-breaker logic and an auto-failback hedge.',
    action:
      'Deploy Resilience4j circuit breaker on the cross-border gateway with a 5-second ' +
      'adaptive timeout. Route to a cached payment status endpoint during open-circuit ' +
      'state. Configure exponential back-off (base 2s, max 30s) for retries. ' +
      'Add a real-time SLA dashboard for the MAS-BNM corridor.',
    quickWins: [
      'Set 5s hard timeout on gateway proxy (immediate config change)',
      'Add "Payment Queued — will process within 30 mins" user message on 504',
      'Alert payments ops team on > 3 consecutive 504s',
    ],
    longTermFix:
      'Negotiate a DuitNow SLA addendum with PayNet; implement dual-path routing ' +
      'via SWIFT gpi as a hot standby for the Singapore-Malaysia corridor.',
    baseBizImpact: 0.88,
    baseFrustration: 0.82,
  },
  'Auth Rejected': {
    title: 'Revise Cross-Border KYC Token Lifecycle & Add Self-Service Uplift',
    rationale:
      'Policy-blocked transfers signal a compliance architecture gap, not a user error. ' +
      'Gold customers are disproportionately affected, and the 402 rejection has no ' +
      'actionable resolution path, driving high churn intent.',
    action:
      'Extend KYC token TTL to 180 days with 30-day proactive renewal push notification. ' +
      'Build a self-service "Cross-Border Limit Uplift" flow in the DBS digibank app. ' +
      'Replace HTTP 402 with a structured error response that includes a deep link to the ' +
      'uplift flow. Measure and reduce mean-time-to-uplift below 5 minutes.',
    quickWins: [
      'Add 30-day expiry warning notification to DBS Notify',
      'Surface uplift CTA directly in the 402 error screen (app update)',
      'Create an in-app FAQ: "Why was my cross-border payment blocked?"',
    ],
    longTermFix:
      'Adopt a perpetual KYC model with continuous re-verification signals ' +
      '(transaction history, device trust) to eliminate hard expiry cliffs.',
    baseBizImpact: 0.72,
    baseFrustration: 0.76,
  },
  'Silent Drop': {
    title: 'Close the Settlement ACK Gap with Dead-Letter Queue & Compensating Transactions',
    rationale:
      'Silent drops are the highest-risk cluster: funds are debited but credit is never ' +
      'confirmed. This creates regulatory exposure under MAS Notice 626 (payment finality) ' +
      'and triggers the highest NPS damage as customers discover their money is missing.',
    action:
      'Extend DuitNow ACK listener timeout to 120 seconds (above PayNet\'s 90s SLA). ' +
      'Add a Kafka dead-letter queue for unacknowledged credit instructions with automated ' +
      'compensating transaction (auto-reversal after 15 minutes if no ACK). ' +
      'Implement a "Payment Confirmed / Reversal Initiated" push notification to both parties.',
    quickWins: [
      'Extend ACK listener timeout from 60s → 120s (single config line)',
      'Manual DLQ sweep script for ops team (bridge until automated fix ships)',
      'Add "Your payment is being verified" status page entry for affected TXN IDs',
    ],
    longTermFix:
      'Migrate to ISO 20022 pacs.002 message with confirmed credit leg before debit ' +
      'finality — eliminating the two-phase commit race condition entirely.',
    baseBizImpact: 0.94,
    baseFrustration: 0.90,
  },
  'Partial Process': {
    title: 'Introduce Saga Orchestration to Replace Two-Phase Commit in Cross-Border Flow',
    rationale:
      'The debit-credit desynchronization directly affects high-value Platinum customers ' +
      'and creates a liability on DBS\'s balance sheet for every partially settled ' +
      'transaction. The 4–6 hour ops resolution window amplifies customer churn risk.',
    action:
      'Replace the current two-phase commit with a Saga orchestration pattern. ' +
      'Publish a CrossBorderPaymentSaga event that coordinates debit and credit as ' +
      'compensatable steps. Implement a Kafka DLQ with automated retry (3x, then ' +
      'auto-reversal). Add a real-time ledger reconciliation job (every 15 minutes) ' +
      'to flag and auto-resolve stuck partial states.',
    quickWins: [
      'Add monitoring alert: any transaction in partial state > 30 minutes',
      'Give ops team a one-click "Force Settle / Force Reverse" tool',
      'Notify customer via push when partial state detected ("We are on it")',
    ],
    longTermFix:
      'Adopt event-sourced ledger with idempotent write guarantees; ' +
      'eliminate the async credit leg by synchronously confirming with DuitNow before ' +
      'posting the debit to the customer ledger.',
    baseBizImpact: 0.82,
    baseFrustration: 0.78,
  },
  'Network Flap': {
    title: 'Integrate Failover Payment Path for DuitNow Endpoint Instability',
    rationale:
      'Periodic BGP instability at PayNet Malaysia is an external dependency DBS cannot ' +
      'control. The current fixed-interval retry policy worsens the situation. ' +
      'A secondary routing path and user-transparent retry window would neutralize ' +
      'the customer-facing impact entirely.',
    action:
      'Switch retry policy from fixed-interval to exponential back-off with jitter ' +
      '(Decorrelated Jitter algorithm). Establish a secondary DuitNow connectivity ' +
      'path via the ASEAN Payment Network\'s SGD-MYR bridge as a warm standby. ' +
      'Implement a 503 health check with 30-second polling that automatically routes ' +
      'to the standby when primary fails health check 3 consecutive times.',
    quickWins: [
      'Deploy exponential back-off retry (immediate library change)',
      'Add "DuitNow service degraded" status banner in app during 503 events',
      'Set up PagerDuty alert for > 5 consecutive 503s on the PayNet connector',
    ],
    longTermFix:
      'Negotiate a dual-provider SLA with both PayNet Malaysia and a secondary ' +
      'regional clearing house (e.g., RippleNet SGD-MYR corridor) to achieve ' +
      '99.9% cross-border payment availability.',
    baseBizImpact: 0.65,
    baseFrustration: 0.70,
  },
  'Duplicate Charge': {
    title: 'Enforce Idempotency Keys Across Cross-Border Retry Flow',
    rationale:
      'Duplicate debits are the highest-severity customer trust failure possible. A Platinum customer ' +
      'losing SGD 5,000+ to a system race condition creates immediate churn risk, regulatory exposure, ' +
      'and brand damage. The fix is a well-understood engineering pattern (idempotency keys) with ' +
      'a short implementation window.',
    action:
      'Inject a stable idempotency key (transaction fingerprint = SHA-256 of account_id + recipient_proxy + amount + date) ' +
      'into the cross-border payment initiation flow. The retry handler must check the settlement-pending state ' +
      'of the original transaction before spawning a new debit instruction. ' +
      'Add a deduplication gate in the payment engine that rejects any new transaction matching ' +
      'an in-flight fingerprint within a 10-minute window.',
    quickWins: [
      'Add idempotency key header to POST /initiate within current sprint',
      'Deploy a "duplicate charge detected" real-time alert for ops team',
      'Create a same-day refund SLA for duplicate charge cases (manual process bridge)',
    ],
    longTermFix:
      'Migrate to an event-sourced payment ledger where every debit is immutably linked to a ' +
      'settlement confirmation, eliminating the race condition by design.',
    baseBizImpact: 0.95,
    baseFrustration: 0.98,
  },
  'FX Rate Dispute': {
    title: 'Introduce FX Rate Lock and Transparent Rate Disclosure Pre-Confirmation',
    rationale:
      'Rate disclosure ambiguity creates legal and reputational risk. Customers who feel deceived ' +
      'by FX slippage are disproportionately likely to escalate to MAS or switch banks. ' +
      'A rate lock feature would also be a competitive differentiator for cross-border transfers.',
    action:
      'Relabel all displayed rates as "indicative rate" with a clear disclosure tooltip. ' +
      'Implement a 30-second rate lock at confirmation — the customer sees the exact rate that will ' +
      'be applied, and if the lock expires, they are prompted to re-confirm. ' +
      'Add a pre-confirmation summary screen showing: locked rate, exact MYR amount recipient will receive, ' +
      'and the DBS margin applied.',
    quickWins: [
      'Update UI copy from "live rate" to "indicative rate" (1-day change)',
      'Add disclosure tooltip explaining rate is locked at settlement',
      'Log all rate-discrepancy complaints to a dedicated feedback queue',
    ],
    longTermFix:
      'Implement a dynamic rate hedging system that guarantees the displayed rate for transfers ' +
      'up to SGD 10,000 by absorbing minor fluctuation risk within the FX spread.',
    baseBizImpact: 0.60,
    baseFrustration: 0.65,
  },
  'Wrong Recipient': {
    title: 'Add Recipient Name Verification Screen + Cross-Border Recall API',
    rationale:
      'Wrong-recipient transfers carry extreme customer distress and potential permanent fund loss. ' +
      'A single-line fix — displaying the registered name before confirmation — would prevent ' +
      'the majority of cases. The recall tooling gap leaves agents helpless and customers exposed.',
    action:
      'Display the DuitNow-registered name of the recipient on the confirmation screen before ' +
      'the customer commits to the transfer. Build a recall request API that automates the ' +
      'PayNet Malaysia inter-bank communication, replacing the current manual email process. ' +
      'Add a 5-second "cancel window" post-confirmation for mobile transfers.',
    quickWins: [
      'Add DuitNow proxy name resolution to confirmation screen (API already available)',
      'Create internal recall request form pre-filled from transaction data',
      'Set up SLA tracking for cross-border recall cases (target: 5 business days)',
    ],
    longTermFix:
      'Negotiate a real-time recall API integration with PayNet Malaysia, ' +
      'enabling instant fund freeze requests for wrong-recipient transfers.',
    baseBizImpact: 0.78,
    baseFrustration: 0.92,
  },
};

const FALLBACK_RECO: RecoTemplate = {
  title: 'Conduct Manual Root Cause Investigation',
  rationale: 'Unclassified friction pattern requires manual engineering triage.',
  action: 'Assign a senior engineer to review raw logs and identify the root cause.',
  quickWins: ['Schedule triage session with payments engineering team'],
  longTermFix: 'Define archetype pattern and add to Observer Agent clustering model.',
  baseBizImpact: 0.5,
  baseFrustration: 0.5,
};

// ─── Helpers ──────────────────────────────────────────────────────────────────
function dominantArchetype(logs: FrictionLog[]): string {
  const counts: Record<string, number> = {};
  for (const l of logs) counts[l.archetype] = (counts[l.archetype] ?? 0) + 1;
  return Object.entries(counts).sort((a, b) => b[1] - a[1])[0]?.[0] ?? '';
}

function effectiveTierMultiplier(cluster: FrictionCluster): number {
  const total = cluster.tierBreakdown.Platinum + cluster.tierBreakdown.Gold;
  if (total === 0) return 1.0;
  const platFrac = cluster.tierBreakdown.Platinum / total;
  const goldFrac = cluster.tierBreakdown.Gold / total;
  return platFrac * TIER_MULTIPLIER.Platinum + goldFrac * TIER_MULTIPLIER.Gold;
}

function computePriority(score: number): Priority {
  if (score >= 0.85) return 'P0';
  if (score >= 0.70) return 'P1';
  if (score >= 0.50) return 'P2';
  return 'P3';
}

// ─── Public API ───────────────────────────────────────────────────────────────
export function runStrategistAgent(
  cluster: FrictionCluster,
  logs: FrictionLog[],
  insightCard: InsightCard,
): StrategicRecommendation {
  const memberLogs = logs.filter(l => cluster.logIds.includes(l.id));
  const archetype = dominantArchetype(memberLogs);
  const reco = RECO_MAP[archetype] ?? FALLBACK_RECO;

  // Value Projection Engine
  const avgTxnValue = AVG_TXN_VALUE[archetype] ?? DEFAULT_TXN_VALUE;
  const clusterFreqPerMonth = Math.round(cluster.logIds.length * 4.3); // weekly → monthly
  const tierMult = effectiveTierMultiplier(cluster);
  const monthlyLoss = avgTxnValue * clusterFreqPerMonth * tierMult;
  const annualLoss = monthlyLoss * 12;

  const valueProjection: ValueProjection = {
    avgTransactionValueSGD: avgTxnValue,
    clusterFrequencyPerMonth: clusterFreqPerMonth,
    tierMultiplier: parseFloat(tierMult.toFixed(2)),
    monthlyLossSGD: Math.round(monthlyLoss),
    annualLossSGD: Math.round(annualLoss),
    platformAtRiskPct: parseFloat((cluster.businessFrequency * 100).toFixed(1)),
  };

  // Adjust impact scores with cluster-specific signals
  const debtPenalty = insightCard.technicalDebtLevel === 'Critical' ? 0.05 :
    insightCard.technicalDebtLevel === 'High' ? 0.025 : 0;
  const bizImpact = Math.min(reco.baseBizImpact + debtPenalty + cluster.avgFrictionScore * 0.1, 1);
  const userFrustration = Math.min(
    reco.baseFrustration + Math.abs(Math.min(
      memberLogs.reduce((s, l) => s + l.userMetadata.nps, 0) / memberLogs.length,
      0,
    )) * 0.1,
    1,
  );

  // Priority scoring: (BusinessImpact * 0.6) + (UserFrustration * 0.4)
  const priorityScore = parseFloat(((bizImpact * 0.6) + (userFrustration * 0.4)).toFixed(3));

  return {
    clusterId: cluster.id,
    title: reco.title,
    rationale: reco.rationale,
    action: reco.action,
    priorityScore,
    priority: computePriority(priorityScore),
    businessImpact: parseFloat(bizImpact.toFixed(3)),
    userFrustration: parseFloat(userFrustration.toFixed(3)),
    valueProjection,
    quickWins: reco.quickWins,
    longTermFix: reco.longTermFix,
  };
}

// ─── AI-powered path ──────────────────────────────────────────────────────────
const STRATEGIST_SYSTEM = `You are the Strategist agent in Sierra, a fintech operations intelligence platform for DBS Bank.
Given analyst insight and cluster data, produce a strategic recommendation with business impact quantification.

Return a JSON object with exactly these keys:
- reasoning: 2-3 sentences explaining your strategic thinking before concluding
- title: short action-oriented recommendation title
- rationale: why this problem matters to DBS and its customers
- action: concrete engineering/product steps to resolve the issue
- priorityScore: float 0-1, calculated as (businessImpact * 0.6) + (userFrustration * 0.4)
- priority: "P0" if priorityScore >= 0.85, "P1" if >= 0.70, "P2" if >= 0.50, else "P3"
- businessImpact: float 0-1 representing business severity
- userFrustration: float 0-1 representing customer impact
- valueProjection: object with keys avgTransactionValueSGD (number, SGD 1500-5000), clusterFrequencyPerMonth (integer), tierMultiplier (float), monthlyLossSGD (integer), annualLossSGD (integer), platformAtRiskPct (float)
- quickWins: array of exactly 3 strings, each a quick actionable step
- longTermFix: string describing the strategic long-term solution

All monetary values in SGD.`;

export async function runStrategistAgentAI(
  cluster: FrictionCluster,
  logs: FrictionLog[],
  insightCard: InsightCard,
): Promise<StrategistAIResult> {
  const memberLogs = logs.filter(l => cluster.logIds.includes(l.id));
  const avgNps = (memberLogs.reduce((s, l) => s + l.userMetadata.nps, 0) / memberLogs.length).toFixed(2);
  const platCount = memberLogs.filter(l => l.userMetadata.tier === 'Platinum').length;
  const goldCount = memberLogs.filter(l => l.userMetadata.tier === 'Gold').length;

  const userContent = `Cluster ID: ${cluster.id}
Analyst Insight: ${JSON.stringify(insightCard)}

Cluster Stats:
  Log count: ${memberLogs.length}
  Avg friction: ${cluster.avgFrictionScore.toFixed(3)}
  Tier: Platinum ${platCount}, Gold ${goldCount}
  Avg latency: ${Math.round(cluster.avgLatencyMs)}ms
  Business frequency: ${(cluster.businessFrequency * 100).toFixed(1)}% of total traffic
  Avg NPS: ${avgNps}
  clusterFrequencyPerMonth estimate: ${Math.round(cluster.logIds.length * 4.3)}

Produce the strategic recommendation JSON.`;

  try {
    const { text, meta } = await callGemini(STRATEGIST_SYSTEM, userContent, 4096);
    const parsed = JSON.parse(extractJson(text)) as StrategicRecommendation;
    return { recommendation: { ...parsed, clusterId: cluster.id }, meta };
  } catch (err) {
    console.error('[Sierra Strategist] AI parse failed, using fallback:', err);
    return { recommendation: runStrategistAgent(cluster, logs, insightCard), meta: null };
  }
}
