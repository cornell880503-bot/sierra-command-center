import type { FrictionCluster, FrictionLog, InsightCard, TechnicalDebtLevel, AppMode } from '../types';
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

const RCA_MAP_RECOMMERCE: Record<string, RcaTemplate> = {
  'Listing Rejected': {
    primaryIssue: 'Policy Engine False-Positive Rejection',
    affectedSubsystem: 'Listing Moderation API · Policy Enforcement Layer',
    technicalDebtLevel: 'High',
    rootCauseDetail: 'The listing policy engine is triggering false-positive rejections on valid listings due to overfitted keyword matching rules that flag common product terms as violations.',
    affectedApiPath: 'POST /api/v3/listings/create · GET /api/v3/listings/validate',
    remediationTimeEst: '2-3 sprints',
    engineeringOwner: 'Trust & Safety Engineering · Listing Integrity Team',
  },
  'Photo Moderation': {
    primaryIssue: 'CV Pipeline Queue Saturation',
    affectedSubsystem: 'Computer Vision Pipeline · Image Compliance Service',
    technicalDebtLevel: 'Critical',
    rootCauseDetail: 'The image moderation CV pipeline has no SLA enforcement — queues saturate during peak upload periods, causing 48-72 hour moderation delays that kill listing momentum and seller trust.',
    affectedApiPath: 'POST /api/v3/listings/photos · GET /api/v3/moderation/status',
    remediationTimeEst: '3-4 sprints',
    engineeringOwner: 'Computer Vision · Marketplace Safety Team',
  },
  'Price Sync Failure': {
    primaryIssue: 'Listing Price Cache Staleness',
    affectedSubsystem: 'Pricing Sync Service · Listing Display Layer',
    technicalDebtLevel: 'High',
    rootCauseDetail: 'Price updates are propagated asynchronously through a message queue that has no retry-on-failure logic. When the queue consumer falls behind, displayed prices become stale for hours, causing buyer confusion and lost conversions.',
    affectedApiPath: 'PATCH /api/v3/listings/:id/price · GET /api/v3/listings/:id',
    remediationTimeEst: '1-2 sprints',
    engineeringOwner: 'Listing Infrastructure · Pricing Team',
  },
  'Boost Not Applied': {
    primaryIssue: 'Boost Disbursement-Application Race Condition',
    affectedSubsystem: 'Seller Boost Service · Listing Promotion Engine',
    technicalDebtLevel: 'Critical',
    rootCauseDetail: 'The boost payment confirmation and listing promotion application run as independent async jobs with no transactional coordination. If the promotion job fails silently, the payment is captured but the boost is never applied — no refund or retry is triggered.',
    affectedApiPath: 'POST /api/v3/boosts/purchase · POST /api/v3/listings/:id/boost',
    remediationTimeEst: '2 sprints',
    engineeringOwner: 'Monetization Engineering · Seller Growth Team',
  },
  'Offer Ghosted': {
    primaryIssue: 'Offer Notification Delivery Failure',
    affectedSubsystem: 'Offer Notification Service · Push Delivery Layer',
    technicalDebtLevel: 'High',
    rootCauseDetail: 'Offer notifications are sent via a push service that has no delivery confirmation or fallback channel. When push tokens are stale or delivery fails, buyers receive no acknowledgment and sellers are never notified — the offer expires silently.',
    affectedApiPath: 'POST /api/v3/offers/send · GET /api/v3/offers/:id/status',
    remediationTimeEst: '2-3 sprints',
    engineeringOwner: 'Notifications Platform · Buyer-Seller Engagement Team',
  },
  'Payout Delayed': {
    primaryIssue: 'Disbursement Queue Deadlock',
    affectedSubsystem: 'Seller Payout Service · Bank Disbursement Gateway',
    technicalDebtLevel: 'Critical',
    rootCauseDetail: 'Seller payout disbursements are batched and processed via a third-party banking gateway that has no SLA visibility. When the gateway experiences delays, payouts queue indefinitely with no seller notification and no automatic escalation trigger.',
    affectedApiPath: 'POST /api/v3/payouts/initiate · GET /api/v3/payouts/:id/status',
    remediationTimeEst: '3 sprints',
    engineeringOwner: 'Financial Infrastructure · Seller Payments Team',
  },
  'Category Mismatch': {
    primaryIssue: 'ML Categorization Model Drift',
    affectedSubsystem: 'Item Classification Service · Category Taxonomy Engine',
    technicalDebtLevel: 'Medium',
    rootCauseDetail: 'The category prediction model has not been retrained since Q2. New product categories and seasonal item patterns are being misclassified, reducing discoverability and causing sellers to manually re-categorize listings multiple times.',
    affectedApiPath: 'POST /api/v3/listings/categorize · PATCH /api/v3/listings/:id/category',
    remediationTimeEst: '1 sprint',
    engineeringOwner: 'ML Platform · Item Intelligence Team',
  },
  'Sold Item Dispute': {
    primaryIssue: 'Resolution Queue SLA Breach',
    affectedSubsystem: 'Dispute Resolution Service · Trust & Safety Ops Layer',
    technicalDebtLevel: 'High',
    rootCauseDetail: 'Sold item disputes are assigned to a shared ops queue with no priority weighting by seller tier or transaction value. High-value disputes from Power Sellers sit behind low-value cases for days, breaching resolution SLAs and creating churn risk.',
    affectedApiPath: 'POST /api/v3/disputes/create · GET /api/v3/disputes/:id',
    remediationTimeEst: '2 sprints',
    engineeringOwner: 'Trust & Safety Engineering · Dispute Resolution Team',
  },
};

const FALLBACK_RCA_RECOMMERCE: RcaTemplate = {
  primaryIssue: 'Unclassified Marketplace Seller Friction',
  affectedSubsystem: 'Marketplace Platform',
  technicalDebtLevel: 'Medium',
  rootCauseDetail: 'Cluster pattern does not map to a known archetype. Manual investigation required.',
  affectedApiPath: '/api/v3/*',
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
export function runAnalystAgent(cluster: FrictionCluster, logs: FrictionLog[], mode: AppMode = 'FINTECH'): InsightCard {
  const memberLogs = logs.filter(l => cluster.logIds.includes(l.id));
  const archetype = dominantArchetype(memberLogs);
  const rcaMap = mode === 'RECOMMERCE' ? RCA_MAP_RECOMMERCE : RCA_MAP;
  const fallback = mode === 'RECOMMERCE' ? FALLBACK_RCA_RECOMMERCE : FALLBACK_RCA;
  const rca = rcaMap[archetype] ?? fallback;

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
const ANALYST_SYSTEM_RECOMMERCE = `You are the Analyst agent in Sierra, an AI governance platform for Carousell, Southeast Asia's leading recommerce marketplace.
Your job is to perform root-cause analysis on a cluster of seller friction logs from the Carousell marketplace.
Analyze the error codes, latency patterns, seller tier data (Power Seller / Individual), and dialogue samples to identify the primary technical or operational failure.

Return a JSON object with exactly these keys:
- reasoning: 2-3 sentences explaining your analysis logic before concluding
- primaryIssue: a short label for the main failure (e.g. "CV Pipeline Queue Saturation")
- affectedSubsystem: the system component affected (e.g. "Listing Moderation API")
- technicalDebtLevel: one of "Critical", "High", "Medium", or "Low"
- rootCauseDetail: a detailed paragraph explaining the root cause in marketplace/recommerce context
- affectedApiPath: the API endpoint(s) affected (e.g. "POST /api/v3/listings/create")
- remediationTimeEst: engineering effort estimate (e.g. "2-3 sprints")
- engineeringOwner: the team responsible (e.g. "Trust & Safety Engineering · Listing Integrity Team")`;

const ANALYST_SYSTEM = `You are the Analyst agent in Sierra, a fintech operations intelligence platform for DBS Bank.
Your job is to perform root-cause analysis on a cluster of PayNow-to-DuitNow cross-border payment friction logs.
Analyze the error codes, latency patterns, tier data, and dialogue samples to identify the primary technical failure.

Return a JSON object with exactly these keys:
- reasoning: 2-3 sentences explaining your analysis logic before concluding
- primaryIssue: a short label for the main failure (e.g. "Regional Gateway Latency")
- affectedSubsystem: the system component affected (e.g. "Cross-Border Payment Gateway")
- technicalDebtLevel: one of "Critical", "High", "Medium", or "Low"
- rootCauseDetail: a detailed paragraph explaining the root cause
- affectedApiPath: the API endpoint(s) affected (e.g. "POST /api/v3/payments/cross-border/initiate")
- remediationTimeEst: engineering effort estimate (e.g. "2-3 sprints")
- engineeringOwner: the team responsible (e.g. "Payments Infrastructure · Gateway Team")`;

function formatDialogueSamples(memberLogs: FrictionLog[], max = 3): string {
  // Limit to 3 logs, 2 turns each, 100 chars per turn — keeps total input under 3k chars
  return memberLogs.slice(0, max).map(l => {
    const turns = l.dialogue.slice(0, 2).map(t => {
      const role = t.role === 'customer' ? 'C' : 'A';
      const text = t.text.slice(0, 100);
      return `${role}: ${text}`;
    }).join(' | ');
    return `[${l.id} HTTP:${l.systemContext.apiStatusCode} ${l.systemContext.latencyMs}ms ${l.userMetadata.tier} NPS:${l.userMetadata.nps}] ${turns}`;
  }).join('\n');
}

export async function runAnalystAgentAI(cluster: FrictionCluster, logs: FrictionLog[], mode: AppMode = 'FINTECH'): Promise<AnalystAIResult> {
  const memberLogs = logs.filter(l => cluster.logIds.includes(l.id));
  const archetypes = [...new Set(memberLogs.map(l => l.archetype))].join(', ');
  const topTierLabel = mode === 'FINTECH' ? 'Platinum' : 'Power Seller';
  const lowerTierLabel = mode === 'FINTECH' ? 'Gold' : 'Individual';
  const platCount = memberLogs.filter(l => l.userMetadata.tier === topTierLabel).length;
  const goldCount = memberLogs.filter(l => l.userMetadata.tier === lowerTierLabel).length;
  const systemPrompt = mode === 'RECOMMERCE' ? ANALYST_SYSTEM_RECOMMERCE : ANALYST_SYSTEM;

  const userContent = `Cluster ID: ${cluster.id}
Dominant Error Code: ${cluster.dominantErrorCode}
Average Latency: ${Math.round(cluster.avgLatencyMs)}ms
Average Friction Score: ${cluster.avgFrictionScore.toFixed(3)}
Tier Breakdown: ${topTierLabel} ${platCount}, ${lowerTierLabel} ${goldCount}
Log Count: ${memberLogs.length}
Archetype Labels Present: ${archetypes}

Sample Dialogue Transcripts (${Math.min(3, memberLogs.length)} of ${memberLogs.length}):
${formatDialogueSamples(memberLogs)}

Perform root-cause analysis and return JSON.`;

  try {
    const { text, meta } = await callGemini(systemPrompt, userContent, 4096);
    const parsed = JSON.parse(extractJson(text)) as InsightCard;
    return { insightCard: { ...parsed, clusterId: cluster.id }, meta };
  } catch (err) {
    console.error('[Sierra Analyst] AI parse failed, using fallback:', err);
    return { insightCard: runAnalystAgent(cluster, logs, mode), meta: null };
  }
}
