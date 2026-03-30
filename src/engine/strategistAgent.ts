import type {
  FrictionCluster,
  FrictionLog,
  InsightCard,
  StrategicRecommendation,
  ValueProjection,
  Priority,
  AppMode,
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

// ─── RECOMMERCE transaction value estimates ───────────────────────────────────
const AVG_TXN_VALUE_RECOMMERCE: Record<string, number> = {
  'Listing Rejected':   85,
  'Photo Moderation':   120,
  'Price Sync Failure': 95,
  'Boost Not Applied':  200,
  'Offer Ghosted':      110,
  'Payout Delayed':     150,
  'Category Mismatch':  75,
  'Sold Item Dispute':  180,
};

const TIER_MULTIPLIER_RECOMMERCE: Record<string, number> = {
  'Power Seller': 2.2,
  'Individual':   1.0,
};

const RECO_MAP_RECOMMERCE: Record<string, RecoTemplate> = {
  'Listing Rejected': {
    title: 'Deploy Listing Pre-Validation API with Explainable Rejection Reasons',
    rationale: 'Silent policy rejections are the single largest source of Power Seller churn. Every rejected listing represents lost GMV and erodes platform trust.',
    action: 'Build a pre-validation endpoint that sellers can call before submission. Return structured rejection reasons with specific fix suggestions. Add a self-service appeal flow for borderline cases.',
    quickWins: ['Add rejection reason codes to current API response (immediate)', 'Email sellers with fix suggestions when listing is rejected', 'Create "Listing Health" dashboard in seller portal'],
    longTermFix: 'Migrate to an ML-based policy engine with continuous seller feedback loops, reducing false-positive rate below 2%.',
    baseBizImpact: 0.82, baseFrustration: 0.78,
  },
  'Photo Moderation': {
    title: 'Implement Priority Lane CV Moderation with SLA Enforcement',
    rationale: 'A 48-72 hour photo moderation queue kills listing momentum — 70% of buyer interest occurs in the first 24 hours after a listing goes live.',
    action: 'Introduce a priority moderation lane for Power Sellers with a 2-hour SLA. Add auto-approval for sellers with >95% historical compliance. Deploy queue depth monitoring with automatic capacity scaling.',
    quickWins: ['Set 4-hour SLA for Power Seller photo moderation (ops change)', 'Add moderation status push notifications to seller app', 'Auto-approve photos from sellers with clean 90-day history'],
    longTermFix: 'Build real-time edge-based CV screening that approves 80% of photos instantly at upload, reserving the queue only for edge cases.',
    baseBizImpact: 0.88, baseFrustration: 0.84,
  },
  'Price Sync Failure': {
    title: 'Replace Async Price Queue with Synchronous Write-Through Cache',
    rationale: 'Stale prices cause buyer confusion and abandoned transactions. Sellers updating prices to compete in real-time are undercut by display lag.',
    action: 'Replace the async price propagation queue with a synchronous write-through to the listing display cache. Add optimistic UI in the seller app showing confirmed vs pending price states.',
    quickWins: ['Add "Price update pending" indicator in seller app (1 sprint)', 'Reduce queue consumer polling interval from 5 min to 30 sec (config change)', 'Alert ops team when price sync lag exceeds 30 minutes'],
    longTermFix: 'Event-driven listing state architecture where all listing mutations are atomic and immediately consistent across all display surfaces.',
    baseBizImpact: 0.72, baseFrustration: 0.68,
  },
  'Boost Not Applied': {
    title: 'Implement Saga Pattern for Boost Purchase-Application Atomicity',
    rationale: 'Sellers paying for boosts that silently fail destroys trust and monetization. Every failed boost is both a direct revenue refund liability and a churn trigger.',
    action: 'Wrap boost purchase and application in a Saga orchestration pattern. If application fails, trigger automatic refund and notify seller within 5 minutes. Add idempotency keys to prevent double-charging.',
    quickWins: ['Add boost application status to seller app with retry button (immediate)', 'Daily audit job to detect paid-but-not-applied boosts and auto-refund', 'PagerDuty alert when boost failure rate exceeds 1%'],
    longTermFix: 'Transactional boost system where payment and application are atomic — charge only occurs after listing confirmation of boost activation.',
    baseBizImpact: 0.95, baseFrustration: 0.92,
  },
  'Offer Ghosted': {
    title: 'Add Multi-Channel Offer Notification with Delivery Confirmation',
    rationale: 'Every ghosted offer represents a buyer who was willing to transact. Re-engaging them after a failed notification window is nearly impossible.',
    action: 'Add SMS and email fallback channels for offer notifications when push delivery fails. Implement delivery receipts so buyers know if their offer was seen. Add offer expiry extension if notification was not delivered.',
    quickWins: ['Add email fallback for offer notifications (1 sprint)', 'Show "Offer delivered/not yet seen" status to buyer', 'Auto-extend offer expiry by 24h if notification undelivered'],
    longTermFix: 'Real-time bidirectional messaging for offer negotiation, replacing the current async notification-poll model entirely.',
    baseBizImpact: 0.78, baseFrustration: 0.85,
  },
  'Payout Delayed': {
    title: 'Implement Real-Time Payout Status Tracking with Automatic Escalation',
    rationale: 'Delayed payouts are the highest-severity trust failure for sellers. A seller who does not know where their money is will churn to a competitor platform.',
    action: 'Integrate real-time disbursement status webhooks from the banking gateway. Push status updates to sellers at each processing stage. Trigger automatic customer support escalation if payout exceeds SLA by 25%.',
    quickWins: ['Add payout status page with real-time updates in seller portal', 'SMS notification when payout is initiated and when it arrives', 'Daily payout SLA breach report for ops team'],
    longTermFix: 'Instant payout capability for Power Sellers using platform float, with batch settlement to banking partners in the background.',
    baseBizImpact: 0.92, baseFrustration: 0.96,
  },
  'Category Mismatch': {
    title: 'Retrain Category Model and Add Seller-Override Self-Service',
    rationale: 'Misclassified listings receive 60% less organic search traffic. Sellers who cannot fix their category lose discoverability and attribution.',
    action: 'Retrain the category model on Q4 inventory data. Add a "Suggest Category Override" feature for sellers with a fast-track review queue. Show category confidence score to sellers at listing time.',
    quickWins: ['Enable seller category override in listing edit (1 sprint)', 'Show "Category: X (auto-detected)" with edit link in listing preview', 'Quarterly model retraining schedule with performance benchmarks'],
    longTermFix: 'Hybrid categorization system combining ML prediction with seller-provided signals and buyer search behavior to continuously self-correct.',
    baseBizImpact: 0.62, baseFrustration: 0.58,
  },
  'Sold Item Dispute': {
    title: 'Introduce Tiered Dispute Resolution with Power Seller Priority Queue',
    rationale: 'Unresolved disputes destroy seller confidence and expose the platform to regulatory risk. Power Sellers with high GMV require faster resolution SLAs.',
    action: 'Segment the dispute queue by seller tier and transaction value. Power Sellers get a 24-hour resolution SLA with a dedicated ops agent. Add an AI-assisted evidence review to pre-triage clear-cut cases.',
    quickWins: ['Create Power Seller priority queue in ops tooling (ops config change)', 'Add dispute status tracking page visible to both buyer and seller', 'Auto-close disputes where evidence is one-sided after 48 hours'],
    longTermFix: 'AI-native dispute resolution that handles 80% of cases automatically using listing data, communication history, and transaction records.',
    baseBizImpact: 0.75, baseFrustration: 0.88,
  },
};

const FALLBACK_RECO_RECOMMERCE: RecoTemplate = {
  title: 'Conduct Manual Root Cause Investigation',
  rationale: 'Unclassified seller friction pattern requires manual engineering triage.',
  action: 'Assign a senior engineer to review raw logs and identify the root cause.',
  quickWins: ['Schedule triage session with marketplace engineering team'],
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

function effectiveTierMultiplier(cluster: FrictionCluster, mode: AppMode = 'FINTECH'): number {
  const total = cluster.tierBreakdown.Platinum + cluster.tierBreakdown.Gold;
  if (total === 0) return 1.0;
  const topFrac = cluster.tierBreakdown.Platinum / total;
  const lowerFrac = cluster.tierBreakdown.Gold / total;
  if (mode === 'RECOMMERCE') {
    return topFrac * TIER_MULTIPLIER_RECOMMERCE['Power Seller'] + lowerFrac * TIER_MULTIPLIER_RECOMMERCE['Individual'];
  }
  return topFrac * TIER_MULTIPLIER.Platinum + lowerFrac * TIER_MULTIPLIER.Gold;
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
  mode: AppMode = 'FINTECH',
): StrategicRecommendation {
  const memberLogs = logs.filter(l => cluster.logIds.includes(l.id));
  const archetype = dominantArchetype(memberLogs);
  const recoMap = mode === 'RECOMMERCE' ? RECO_MAP_RECOMMERCE : RECO_MAP;
  const fallback = mode === 'RECOMMERCE' ? FALLBACK_RECO_RECOMMERCE : FALLBACK_RECO;
  const reco = recoMap[archetype] ?? fallback;

  // Value Projection Engine
  const txnValueMap = mode === 'RECOMMERCE' ? AVG_TXN_VALUE_RECOMMERCE : AVG_TXN_VALUE;
  const avgTxnValue = txnValueMap[archetype] ?? DEFAULT_TXN_VALUE;
  const clusterFreqPerMonth = Math.round(cluster.logIds.length * 4.3); // weekly → monthly
  const tierMult = effectiveTierMultiplier(cluster, mode);
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
const STRATEGIST_SYSTEM_RECOMMERCE = `You are the Strategist agent in Sierra, an AI governance platform for Carousell recommerce marketplace.
Given analyst insight and cluster data, produce a strategic recommendation with GMV impact quantification.

Return a JSON object with exactly these keys:
- reasoning: 2-3 sentences explaining your strategic thinking before concluding
- title: short action-oriented recommendation title
- rationale: why this seller friction problem matters to Carousell GMV and seller retention
- action: concrete engineering/product steps to resolve the issue
- priorityScore: float 0-1, calculated as (businessImpact * 0.6) + (userFrustration * 0.4)
- priority: "P0" if priorityScore >= 0.85, "P1" if >= 0.70, "P2" if >= 0.50, else "P3"
- businessImpact: float 0-1 representing GMV and revenue severity
- userFrustration: float 0-1 representing seller/buyer frustration
- valueProjection: object with keys avgTransactionValueSGD (number, avg listing value USD 50-300), clusterFrequencyPerMonth (integer), tierMultiplier (float), monthlyLossSGD (integer, represents monthly GMV at risk in USD), annualLossSGD (integer, annual GMV at risk), platformAtRiskPct (float)
- quickWins: array of exactly 3 strings
- longTermFix: string

Use marketplace/recommerce terminology: "GMV", "listing conversion", "seller tier", "Power Seller", "buyer engagement".`;

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
  mode: AppMode = 'FINTECH',
): Promise<StrategistAIResult> {
  const memberLogs = logs.filter(l => cluster.logIds.includes(l.id));
  const avgNps = (memberLogs.reduce((s, l) => s + l.userMetadata.nps, 0) / memberLogs.length).toFixed(2);
  const topTierLabel = mode === 'FINTECH' ? 'Platinum' : 'Power Seller';
  const lowerTierLabel = mode === 'FINTECH' ? 'Gold' : 'Individual';
  const platCount = memberLogs.filter(l => l.userMetadata.tier === topTierLabel).length;
  const goldCount = memberLogs.filter(l => l.userMetadata.tier === lowerTierLabel).length;
  const systemPrompt = mode === 'RECOMMERCE' ? STRATEGIST_SYSTEM_RECOMMERCE : STRATEGIST_SYSTEM;

  const userContent = `Cluster ID: ${cluster.id}
Analyst Insight: ${JSON.stringify(insightCard)}

Cluster Stats:
  Log count: ${memberLogs.length}
  Avg friction: ${cluster.avgFrictionScore.toFixed(3)}
  Tier: ${topTierLabel} ${platCount}, ${lowerTierLabel} ${goldCount}
  Avg latency: ${Math.round(cluster.avgLatencyMs)}ms
  Business frequency: ${(cluster.businessFrequency * 100).toFixed(1)}% of total traffic
  Avg NPS: ${avgNps}
  clusterFrequencyPerMonth estimate: ${Math.round(cluster.logIds.length * 4.3)}

Produce the strategic recommendation JSON.`;

  try {
    const { text, meta } = await callGemini(systemPrompt, userContent, 4096);
    const parsed = JSON.parse(extractJson(text)) as StrategicRecommendation;
    return { recommendation: { ...parsed, clusterId: cluster.id }, meta };
  } catch (err) {
    console.error('[Sierra Strategist] AI parse failed, using fallback:', err);
    return { recommendation: runStrategistAgent(cluster, logs, insightCard, mode), meta: null };
  }
}
