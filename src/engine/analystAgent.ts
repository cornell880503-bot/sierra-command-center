import type { FrictionCluster, FrictionLog, InsightCard, TechnicalDebtLevel } from '../types';
import { callGemini, extractJson } from '../lib/aiClient';
import type { GeminiCallMeta } from '../lib/aiClient';

export interface AnalystAIResult {
  insightCard: InsightCard;
  meta: GeminiCallMeta | null;
}

// ─── Archetype → RCA mapping ──────────────────────────────────────────────────
interface RcaTemplate {
  primaryIssue: string;
  affectedSubsystem: string;
  technicalDebtLevel: TechnicalDebtLevel;
  rootCauseDetail: string;
  affectedApiPath: string;
  remediationTimeEst: string;
  engineeringOwner: string;
}

const RCA_MAP: Record<string, RcaTemplate> = {
  'Timeout Loop': {
    primaryIssue: 'Regional Gateway Latency (PayNow-DuitNow Handshake)',
    affectedSubsystem: 'Cross-Border Payment Gateway · MAS ↔ BNM Corridor',
    technicalDebtLevel: 'Critical',
    rootCauseDetail:
      'The PayNow-DuitNow bilateral gateway exceeds its 8-second SLA during peak hours. ' +
      'TCP keepalive is not configured on the upstream SWIFT gpi connector, causing silent ' +
      'connection drops that manifest as 504s after the proxy timeout window. ' +
      'No circuit-breaker is in place to fail-fast and return user-facing errors promptly.',
    affectedApiPath: 'POST /api/v3/payments/cross-border/initiate',
    remediationTimeEst: '3–4 sprints',
    engineeringOwner: 'Payments Infrastructure · Gateway Team',
  },
  'Auth Rejected': {
    primaryIssue: 'Stale KYC Credentials / Token Expiry Policy Gap',
    affectedSubsystem: 'Identity & Access · Cross-Border Authorization Service',
    technicalDebtLevel: 'High',
    rootCauseDetail:
      'Cross-border payment authorization relies on a KYC token that expires every 90 days. ' +
      'There is no proactive notification before expiry, and the rejection message ' +
      '(HTTP 402) is not surfaced clearly in the mobile app. Users with valid funds ' +
      'and identity are blocked by a policy-enforcement layer with no self-service remediation path.',
    affectedApiPath: 'POST /api/v2/auth/cross-border/validate',
    remediationTimeEst: '1–2 sprints',
    engineeringOwner: 'Identity & Compliance Engineering',
  },
  'Silent Drop': {
    primaryIssue: 'Unacknowledged Request Loss in Settlement Queue',
    affectedSubsystem: 'Async Settlement Bus · DuitNow ACK Listener',
    technicalDebtLevel: 'Critical',
    rootCauseDetail:
      'Payment instructions are dispatched to the DuitNow ISO 20022 endpoint but the ' +
      'async acknowledgment listener has a 60-second timeout that is shorter than ' +
      'the DuitNow SLA (up to 90 seconds under load). Requests that arrive between ' +
      't=60s and t=90s are silently dropped — the debit completes but no credit ' +
      'instruction is re-queued, leaving funds in a phantom-hold state with no ' +
      'compensating transaction.',
    affectedApiPath: 'POST /api/v3/payments/cross-border/settle · async ACK handler',
    remediationTimeEst: '2–3 sprints',
    engineeringOwner: 'Settlement Engineering · Event Bus Team',
  },
  'Partial Process': {
    primaryIssue: 'Debit-Credit Leg Desynchronization in Two-Phase Commit',
    affectedSubsystem: 'Core Banking Ledger · ISO 20022 Credit Instruction',
    technicalDebtLevel: 'High',
    rootCauseDetail:
      'The payment flow uses a two-phase commit: debit (leg 1) posts instantly to ' +
      'the DBS core ledger, but the credit instruction (leg 2) to BNM\'s DuitNow ' +
      'settlement layer is dispatched asynchronously via a Kafka topic with no ' +
      'dead-letter queue monitoring. Under high-volume windows, messages are ' +
      'consumed out-of-order, causing partial settlement states that require ' +
      'manual intervention by payment operations teams.',
    affectedApiPath: 'PATCH /api/v3/payments/cross-border/{txnId}/credit',
    remediationTimeEst: '4–6 sprints',
    engineeringOwner: 'Core Banking Platform · Ledger Team',
  },
  'Network Flap': {
    primaryIssue: 'Unreliable 3rd Party Provider (DuitNow Endpoint)',
    affectedSubsystem: 'External Payment Network · PayNet Malaysia Connector',
    technicalDebtLevel: 'High',
    rootCauseDetail:
      'The PayNet Malaysia DuitNow endpoint exhibits periodic BGP route instability, ' +
      'causing 503 storms every 2–6 hours. DBS has no secondary routing path or ' +
      'fallback provider agreement for the SG-MY corridor. The retry policy is ' +
      'fixed-interval (not exponential back-off), which amplifies load on an already ' +
      'degraded endpoint and extends the outage window by 40% on average.',
    affectedApiPath: 'ALL /api/v3/payments/cross-border/* · PayNet egress',
    remediationTimeEst: '1 sprint (policy) + 6–8 sprints (failover infra)',
    engineeringOwner: 'External Partnerships · Network Reliability Engineering',
  },
  'Duplicate Charge': {
    primaryIssue: 'Missing Idempotency Key in Cross-Border Retry Flow',
    affectedSubsystem: 'Payment Deduplication Layer · Retry Orchestrator',
    technicalDebtLevel: 'Critical',
    rootCauseDetail:
      'When a cross-border PayNow-to-DuitNow transfer returns a gateway timeout (504), ' +
      'the retry orchestrator generates a new transaction ID instead of reusing the original ' +
      'idempotency key. This causes the payment engine to treat the retry as a new transaction, ' +
      'resulting in duplicate debits. The deduplication fingerprint only checks DuitNow ACK state ' +
      'but does not gate on pending settlement state, creating a race-condition window of ~2 minutes.',
    affectedApiPath: 'POST /api/v3/payments/cross-border/initiate · retry-handler',
    remediationTimeEst: '1–2 sprints',
    engineeringOwner: 'Payments Engineering · Idempotency & Retry Team',
  },
  'FX Rate Dispute': {
    primaryIssue: 'Indicative-vs-Settlement FX Rate Disclosure Gap',
    affectedSubsystem: 'FX Rate Engine · Cross-Border Payment UI',
    technicalDebtLevel: 'Medium',
    rootCauseDetail:
      'The DBS digibank app displays the spot mid-market rate at transaction initiation, ' +
      'but the actual settlement rate is applied 30–180 seconds later at DuitNow settlement time. ' +
      'The UI labels this as "live rate" rather than "indicative rate", creating a legally ambiguous ' +
      'disclosure. For transfers exceeding SGD 2,000, rate slippage of 5–15 pips is common during ' +
      'peak hours, generating customer complaints and reputational risk.',
    affectedApiPath: 'GET /api/v2/fx/rates/cross-border · UI rate display component',
    remediationTimeEst: '1 sprint (UI) + 3 sprints (rate lock feature)',
    engineeringOwner: 'Digital Banking · FX Rate & UX Team',
  },
  'Wrong Recipient': {
    primaryIssue: 'No Pre-Confirmation Recipient Verification or Post-Settlement Recall Tooling',
    affectedSubsystem: 'DuitNow Proxy Resolution · Customer Service Recall Workflow',
    technicalDebtLevel: 'High',
    rootCauseDetail:
      'The cross-border PayNow flow resolves DuitNow proxy identifiers (phone/email) without ' +
      'displaying the registered name of the recipient for customer verification before confirmation. ' +
      'Additionally, DBS has no internal tooling to initiate real-time cross-border recall requests — ' +
      'agents must manually file inter-bank recall forms via email to PayNet Malaysia, ' +
      'with response times of 3–7 business days and no automated status tracking.',
    affectedApiPath: 'POST /api/v3/payments/cross-border/initiate · confirm-screen · recall-endpoint (missing)',
    remediationTimeEst: '2 sprints (recipient name display) + 8–12 sprints (recall API)',
    engineeringOwner: 'Product Engineering · Cross-Border UX · Payments Operations',
  },
};

const FALLBACK_RCA: RcaTemplate = {
  primaryIssue: 'Unclassified Cross-Border Payment Friction',
  affectedSubsystem: 'Payment Processing Pipeline',
  technicalDebtLevel: 'Medium',
  rootCauseDetail: 'Cluster pattern does not map to a known archetype. Manual investigation required.',
  affectedApiPath: '/api/v3/payments/cross-border/*',
  remediationTimeEst: 'TBD',
  engineeringOwner: 'Platform Engineering',
};

// ─── Dominant archetype detection ────────────────────────────────────────────
function dominantArchetype(logs: FrictionLog[]): string {
  const counts: Record<string, number> = {};
  for (const l of logs) counts[l.archetype] = (counts[l.archetype] ?? 0) + 1;
  return Object.entries(counts).sort((a, b) => b[1] - a[1])[0]?.[0] ?? '';
}

// ─── Public API — deterministic path ─────────────────────────────────────────
export function runAnalystAgent(cluster: FrictionCluster, logs: FrictionLog[]): InsightCard {
  const memberLogs = logs.filter(l => cluster.logIds.includes(l.id));
  const archetype = dominantArchetype(memberLogs);
  const rca = RCA_MAP[archetype] ?? FALLBACK_RCA;

  return {
    clusterId: cluster.id,
    primaryIssue: rca.primaryIssue,
    affectedSubsystem: rca.affectedSubsystem,
    technicalDebtLevel: rca.technicalDebtLevel,
    rootCauseDetail: rca.rootCauseDetail,
    affectedApiPath: rca.affectedApiPath,
    remediationTimeEst: rca.remediationTimeEst,
    engineeringOwner: rca.engineeringOwner,
  };
}

// ─── AI-powered path (for imported logs) ─────────────────────────────────────
const ANALYST_SYSTEM = `You are the Analyst agent in Sierra, a fintech operations intelligence platform for DBS Bank.
Your job is to perform root-cause analysis on a cluster of PayNow-to-DuitNow cross-border payment friction logs.
Analyze the dialogue transcripts, error codes, latency patterns, and user metadata to identify the primary technical failure.

Respond with ONLY valid JSON matching this exact shape (no markdown, no extra text):
{
  "primaryIssue": string,
  "affectedSubsystem": string,
  "technicalDebtLevel": "Critical" | "High" | "Medium" | "Low",
  "rootCauseDetail": string,
  "affectedApiPath": string,
  "remediationTimeEst": string,
  "engineeringOwner": string
}`;

function formatDialogueSamples(memberLogs: FrictionLog[], max = 4): string {
  return memberLogs.slice(0, max).map(l => {
    const turns = l.dialogue.map(t => `${t.role === 'customer' ? 'Customer' : 'Agent'}: ${t.text}`).join('\n');
    return `--- ${l.id} (HTTP ${l.systemContext.apiStatusCode}, ${l.systemContext.latencyMs}ms, ${l.userMetadata.tier}, retries:${l.systemContext.retryCount}, NPS:${l.userMetadata.nps}) ---\n${turns}`;
  }).join('\n\n');
}

export async function runAnalystAgentAI(cluster: FrictionCluster, logs: FrictionLog[]): Promise<AnalystAIResult> {
  const memberLogs = logs.filter(l => cluster.logIds.includes(l.id));
  const archetypes = [...new Set(memberLogs.map(l => l.archetype))].join(', ');
  const platCount = memberLogs.filter(l => l.userMetadata.tier === 'Platinum').length;
  const goldCount = memberLogs.filter(l => l.userMetadata.tier === 'Gold').length;

  const userContent = `Cluster ID: ${cluster.id}
Dominant Error Code: ${cluster.dominantErrorCode}
Average Latency: ${Math.round(cluster.avgLatencyMs)}ms
Average Friction Score: ${cluster.avgFrictionScore.toFixed(3)}
Tier Breakdown: Platinum ${platCount}, Gold ${goldCount}
Log Count: ${memberLogs.length}
Archetype Labels Present: ${archetypes}

Sample Dialogue Transcripts (${Math.min(4, memberLogs.length)} of ${memberLogs.length}):
${formatDialogueSamples(memberLogs)}

Perform root-cause analysis and return JSON.`;

  try {
    const { text, meta } = await callGemini(ANALYST_SYSTEM, userContent, 2048);
    const parsed = JSON.parse(extractJson(text)) as InsightCard;
    return { insightCard: { ...parsed, clusterId: cluster.id }, meta };
  } catch (err) {
    console.error('[Sierra Analyst] AI parse failed, using fallback:', err);
    return { insightCard: runAnalystAgent(cluster, logs), meta: null };
  }
}
