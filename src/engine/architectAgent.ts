import type {
  StrategicRecommendation, InsightCard,
  ChangeRequestPackage, PolicyDiffLine, ContextInjection,
} from '../types';
import { callGemini, extractJson } from '../lib/aiClient';
import type { GeminiCallMeta } from '../lib/aiClient';

export interface ArchitectAIResult {
  cr: ChangeRequestPackage;
  meta: GeminiCallMeta | null;
}

// ─── Policy diff templates per archetype ─────────────────────────────────────
type ArchTemplate = {
  crTitle: string;
  policyFile: string;
  diff: PolicyDiffLine[];
  injections: ContextInjection[];
  roiPct: number;
  governanceNotes: string;
};

const ARCH_TEMPLATES: Record<string, ArchTemplate> = {
  'Timeout Loop': {
    crTitle: 'CR-001 · Gateway Resilience: Adaptive Timeout + Fallback for 504 Errors',
    policyFile: 'policies/payment-agent/cross-border-handling.md',
    diff: [
      { type: 'meta', content: '--- a/policies/payment-agent/cross-border-handling.md' },
      { type: 'meta', content: '+++ b/policies/payment-agent/cross-border-handling.md' },
      { type: 'header', content: '@@ -12,6 +12,28 @@ ## Cross-Border Payment Error Handling' },
      { type: 'context', content: ' ## Cross-Border Payment Error Handling' },
      { type: 'context', content: ' ' },
      { type: 'context', content: ' ### HTTP 5xx Gateway Errors' },
      { type: 'remove', content: '-If the agent receives a 504 Gateway Timeout, instruct the customer' },
      { type: 'remove', content: '-to retry the payment manually after 5 minutes.' },
      { type: 'add', content: '+### HTTP 504 · Adaptive Retry with User Transparency' },
      { type: 'add', content: '+' },
      { type: 'add', content: '+When a PayNow-to-DuitNow transfer returns HTTP 504:' },
      { type: 'add', content: '+' },
      { type: 'add', content: '+1. **DO NOT** tell the customer to retry manually.' },
      { type: 'add', content: '+2. Confirm: "Your payment instruction has been received and is queued.' },
      { type: 'add', content: '+   Our system will attempt up to 3 retries automatically over the next' },
      { type: 'add', content: '+   15 minutes with increasing wait intervals."' },
      { type: 'add', content: '+3. If latency > 8,000ms: acknowledge delay proactively before the' },
      { type: 'add', content: '+   customer asks. Use the empathy script in §4.2.' },
      { type: 'add', content: '+4. If all 3 retries fail: trigger auto-reversal and notify customer' },
      { type: 'add', content: '+   within 2 minutes via push notification.' },
      { type: 'add', content: '+5. Log incident under category: XBDR-TIMEOUT for ops escalation.' },
      { type: 'add', content: '+' },
      { type: 'add', content: '+**Retry-with-fallback logic (high-latency windows):**' },
      { type: 'add', content: '+```' },
      { type: 'add', content: '+IF status == 504 AND latency > 8000ms:' },
      { type: 'add', content: '+  attempt_1: wait 2s → retry primary gateway' },
      { type: 'add', content: '+  attempt_2: wait 6s → retry primary gateway' },
      { type: 'add', content: '+  attempt_3: wait 15s → route via SWIFT gpi fallback' },
      { type: 'add', content: '+  on_all_fail: initiate compensating_transaction(type=reversal)' },
      { type: 'add', content: '+```' },
      { type: 'context', content: ' ' },
      { type: 'context', content: ' ### Escalation Thresholds' },
    ],
    injections: [
      {
        trigger: 'PayNow transfer status shows timeout or pending > 5 minutes',
        condition: 'systemContext.apiStatusCode === 504 OR latency > 8000ms',
        instruction: 'Open with immediate acknowledgment of the delay. Do not wait for the customer to express frustration. Validate their concern before explaining technical cause.',
        tone: 'Calm, ownership-taking, solution-forward. Avoid passive phrases like "the system is experiencing issues."',
        example: '"I can see your transfer is taking longer than expected — I want to make sure you have full visibility on what\'s happening. Your funds are secure and queued. Here\'s exactly what our system is doing right now..."',
      },
      {
        trigger: 'Customer expresses anxiety about fund safety during timeout',
        condition: 'dialogue contains "lost" OR "missing" OR "where is my money"',
        instruction: 'Prioritize fund safety confirmation above all else. State clearly: funds are held in the settlement buffer and cannot be lost. Provide a specific reference number for the held transaction.',
        tone: 'Reassuring but precise. Use numbers and references, not vague reassurances.',
        example: '"Your SGD [amount] is confirmed held in our settlement buffer under reference [TXN-ID]. No funds have been lost — I can see this clearly on my end."',
      },
    ],
    roiPct: 14,
    governanceNotes: 'Requires sign-off from: Payments Compliance (MAS Notice 626), Platform Engineering lead. Shadow-test for 72h before full rollout.',
  },

  'Auth Rejected': {
    crTitle: 'CR-002 · KYC Policy Refresh: Self-Service Uplift Flow + Agent Empathy Layer',
    policyFile: 'policies/payment-agent/kyc-cross-border.md',
    diff: [
      { type: 'meta', content: '--- a/policies/payment-agent/kyc-cross-border.md' },
      { type: 'meta', content: '+++ b/policies/payment-agent/kyc-cross-border.md' },
      { type: 'header', content: '@@ -8,9 +8,31 @@ ## Cross-Border KYC Authorization' },
      { type: 'context', content: ' ## Cross-Border KYC Authorization' },
      { type: 'context', content: ' ' },
      { type: 'remove', content: '-When a payment is rejected with HTTP 402, inform the customer' },
      { type: 'remove', content: '-that their KYC credentials require update at a branch.' },
      { type: 'remove', content: '-Provide branch locations and operating hours.' },
      { type: 'add', content: '+### HTTP 402 · Actionable Self-Service Resolution Path' },
      { type: 'add', content: '+' },
      { type: 'add', content: '+When a payment is rejected with HTTP 402 (Payment Required):' },
      { type: 'add', content: '+' },
      { type: 'add', content: '+1. **NEVER** lead with "your KYC has expired." Frame as a system' },
      { type: 'add', content: '+   security step, not a customer failure.' },
      { type: 'add', content: '+2. Provide the deep link to self-service uplift:' },
      { type: 'add', content: '+   `digibank://kyc-uplift?flow=cross-border&tier={{customer_tier}}`' },
      { type: 'add', content: '+3. Estimated uplift time: "This usually takes under 5 minutes in the app."' },
      { type: 'add', content: '+4. If customer is Platinum tier: offer priority callback within 30 minutes' },
      { type: 'add', content: '+   as an alternative to self-service.' },
      { type: 'add', content: '+5. If customer has been blocked > 3 times in 30 days: flag for' },
      { type: 'add', content: '+   relationship manager review (tag: KYC-REPEAT-BLOCK).' },
      { type: 'add', content: '+' },
      { type: 'add', content: '+**Token refresh schedule (updated):**' },
      { type: 'add', content: '+- TTL extended from 90 days → 180 days' },
      { type: 'add', content: '+- 30-day warning notification: push + in-app banner' },
      { type: 'add', content: '+- 7-day warning: SMS to registered number' },
      { type: 'context', content: ' ' },
      { type: 'context', content: ' ### Tier-Specific Handling' },
    ],
    injections: [
      {
        trigger: 'Customer payment blocked by authorization failure (HTTP 402)',
        condition: 'systemContext.apiStatusCode === 402',
        instruction: 'Lead with empathy and a clear path forward. The customer has done nothing wrong — the block is a system policy gate. Give them agency by presenting the self-service path as the fastest resolution.',
        tone: 'Empowering, not apologetic. Position the uplift as a quick step they can complete immediately, not a bureaucratic hurdle.',
        example: '"Your payment was held at our security verification step — this is a routine check for cross-border transfers above a certain threshold. The good news: you can complete this in the app in about 5 minutes. Want me to send you the direct link?"',
      },
    ],
    roiPct: 11,
    governanceNotes: 'Requires: Identity & Compliance sign-off, Legal review of KYC TTL extension (MAS regulation alignment), UX review of deep-link flow.',
  },

  'Silent Drop': {
    crTitle: 'CR-003 · Settlement Integrity: Dead-Letter Queue + Proactive Fund Status Protocol',
    policyFile: 'policies/payment-agent/settlement-handling.md',
    diff: [
      { type: 'meta', content: '--- a/policies/payment-agent/settlement-handling.md' },
      { type: 'meta', content: '+++ b/policies/payment-agent/settlement-handling.md' },
      { type: 'header', content: '@@ -5,7 +5,29 @@ ## Settlement Status Handling' },
      { type: 'context', content: ' ## Settlement Status Handling' },
      { type: 'context', content: ' ' },
      { type: 'remove', content: '-If the payment status is unknown, log the case and inform the' },
      { type: 'remove', content: '-customer that the ops team will investigate within 24 hours.' },
      { type: 'add', content: '+### Silent Drop Protocol · Zero Fund Ambiguity' },
      { type: 'add', content: '+' },
      { type: 'add', content: '+When a payment is dispatched but no DuitNow ACK is received (HTTP 408):' },
      { type: 'add', content: '+' },
      { type: 'add', content: '+1. **CRITICAL**: Never tell the customer "we don\'t know" where their funds are.' },
      { type: 'add', content: '+   Use definitive language: "Your funds are held in our settlement buffer."' },
      { type: 'add', content: '+2. Provide transaction reference immediately: "Your reference is [TXN-ID]."' },
      { type: 'add', content: '+3. State the auto-resolution timeline: "If unconfirmed within 15 minutes,' },
      { type: 'add', content: '+   our system will automatically initiate a full reversal."' },
      { type: 'add', content: '+4. Set up a proactive callback: "I will personally follow up in 20 minutes' },
      { type: 'add', content: '+   with a confirmed status update." (Route to automated follow-up queue.)' },
      { type: 'add', content: '+5. If customer has been waiting > 30 minutes: escalate to P1 immediately.' },
      { type: 'add', content: '+' },
      { type: 'add', content: '+**Fund status language matrix:**' },
      { type: 'add', content: '+| Scenario          | Approved phrasing                              |' },
      { type: 'add', content: '+|-------------------|------------------------------------------------|' },
      { type: 'add', content: '+| ACK pending       | "Held securely in settlement buffer"           |' },
      { type: 'add', content: '+| ACK timeout       | "Auto-reversal initiated, funds returning"     |' },
      { type: 'add', content: '+| Confirmed credit  | "Successfully delivered to recipient"          |' },
      { type: 'context', content: ' ' },
      { type: 'context', content: ' ### Escalation Matrix' },
    ],
    injections: [
      {
        trigger: 'Customer asks where their money is after silent drop',
        condition: 'systemContext.apiStatusCode === 408 AND retryCount >= 3',
        instruction: 'Lead with certainty about fund location, not uncertainty about system state. The customer needs to know their money is safe before any technical explanation.',
        tone: 'Authoritative and reassuring. No hedging language. Use "I can confirm" not "I believe" or "it should be."',
        example: '"I can confirm your funds are held securely in our payment buffer — they have not left DBS and they cannot be lost. Here\'s what happens next: [specific timeline]."',
      },
    ],
    roiPct: 18,
    governanceNotes: 'High regulatory sensitivity. Requires: Risk & Compliance approval, Legal review of "auto-reversal" language commitments, Payments Ops sign-off on 15-min SLA.',
  },

  'Partial Process': {
    crTitle: 'CR-004 · Ledger Reconciliation: Partial Settlement UX + Saga Status Transparency',
    policyFile: 'policies/payment-agent/partial-settlement.md',
    diff: [
      { type: 'meta', content: '--- a/policies/payment-agent/partial-settlement.md' },
      { type: 'meta', content: '+++ b/policies/payment-agent/partial-settlement.md' },
      { type: 'header', content: '@@ -3,8 +3,26 @@ ## Partial Settlement Handling' },
      { type: 'context', content: ' ## Partial Settlement Handling' },
      { type: 'context', content: ' ' },
      { type: 'remove', content: '-Partial settlement cases require escalation to ops team.' },
      { type: 'remove', content: '-Response time: 4-6 hours. Inform customer to wait.' },
      { type: 'add', content: '+### Partial Settlement · Real-Time Status Protocol' },
      { type: 'add', content: '+' },
      { type: 'add', content: '+When the debit leg completes but credit leg is pending (HTTP 500):' },
      { type: 'add', content: '+' },
      { type: 'add', content: '+1. Explain the two-stage payment process in plain language:' },
      { type: 'add', content: '+   "Your payment has two steps: Step 1 (debit from your account) is' },
      { type: 'add', content: '+   complete. Step 2 (credit to recipient) is in our processing queue."' },
      { type: 'add', content: '+2. Provide the next reconciliation checkpoint time: every 15 minutes.' },
      { type: 'add', content: '+3. Commit to a maximum resolution window: "This will be resolved within' },
      { type: 'add', content: '+   90 minutes. If not, our system will trigger a full reversal."' },
      { type: 'add', content: '+4. For Platinum customers: offer proactive status SMS every 30 minutes.' },
      { type: 'add', content: '+5. Do NOT route to generic ops queue — use the PARTIAL-SETTLE priority lane.' },
      { type: 'add', content: '+' },
      { type: 'add', content: '+**Status update script (use verbatim):**' },
      { type: 'add', content: '+> "Your payment of SGD [amount] to [recipient] is currently in Step 2' },
      { type: 'add', content: '+> of processing. Our reconciliation system checks this every 15 minutes.' },
      { type: 'add', content: '+> Your next status update will arrive by [time + 15min]."' },
      { type: 'context', content: ' ' },
      { type: 'context', content: ' ### SLA Commitments' },
    ],
    injections: [
      {
        trigger: 'Customer asks about partial debit — why was money taken but recipient not paid',
        condition: 'systemContext.apiStatusCode === 500 AND frictionScore > 0.6',
        instruction: 'Make the two-step payment process legible and non-threatening. The customer needs to understand this is a normal (if delayed) state, not an error that puts their money at risk.',
        tone: 'Educational and precise. Draw a clear analogy: "Like a cheque being issued but not yet cashed."',
        example: '"Think of this as a two-stage transfer: we\'ve issued the payment instruction from your account (Step 1 ✓), and the receiving bank is processing the credit (Step 2, in progress). Your funds are allocated — the recipient will see this within [time]."',
      },
    ],
    roiPct: 12,
    governanceNotes: 'Requires: Core Banking team review of "90 minute SLA" commitment, Legal sign-off on proactive status SMS consent (PDPA compliance).',
  },

  'Network Flap': {
    crTitle: 'CR-005 · Provider Resilience: Exponential Backoff Policy + Network Degradation UX',
    policyFile: 'policies/payment-agent/network-resilience.md',
    diff: [
      { type: 'meta', content: '--- a/policies/payment-agent/network-resilience.md' },
      { type: 'meta', content: '+++ b/policies/payment-agent/network-resilience.md' },
      { type: 'header', content: '@@ -6,7 +6,28 @@ ## Network Error Handling' },
      { type: 'context', content: ' ## Network Error Handling' },
      { type: 'context', content: ' ' },
      { type: 'remove', content: '-On receiving HTTP 503, retry the payment after 2 minutes.' },
      { type: 'remove', content: '-If still failing, advise customer to try again later.' },
      { type: 'add', content: '+### HTTP 503 · Network Degradation Protocol' },
      { type: 'add', content: '+' },
      { type: 'add', content: '+When DuitNow gateway returns HTTP 503 (Service Unavailable):' },
      { type: 'add', content: '+' },
      { type: 'add', content: '+1. **DO NOT** tell customer to "try again later" — this erodes trust.' },
      { type: 'add', content: '+2. Set expectation: "The Malaysia payment network is experiencing brief' },
      { type: 'add', content: '+   instability. Our system is automatically retrying with a smarter' },
      { type: 'add', content: '+   schedule to avoid overloading the network."' },
      { type: 'add', content: '+3. Provide a status URL: "You can track live network status at' },
      { type: 'add', content: '+   [DBS Status Page URL]."' },
      { type: 'add', content: '+4. For retryCount >= 3: activate the secondary routing path and inform' },
      { type: 'add', content: '+   customer: "We\'re now routing via our backup payment corridor."' },
      { type: 'add', content: '+' },
      { type: 'add', content: '+**Exponential backoff schedule:**' },
      { type: 'add', content: '+```' },
      { type: 'add', content: '+retry_1: 2s   (primary route)' },
      { type: 'add', content: '+retry_2: 6s   (primary route)' },
      { type: 'add', content: '+retry_3: 18s  (switch to secondary: ASEAN Payment Network bridge)' },
      { type: 'add', content: '+retry_4: 54s  (secondary route, alert ops if still failing)' },
      { type: 'add', content: '+on_fail: notify_ops(priority=P2) + user_message(type=degraded_service)' },
      { type: 'add', content: '+```' },
      { type: 'context', content: ' ' },
      { type: 'context', content: ' ### Provider SLA Monitoring' },
    ],
    injections: [
      {
        trigger: 'Network instability causing multiple 503 failures for customer payment',
        condition: 'systemContext.apiStatusCode === 503 AND retryCount >= 2',
        instruction: 'Own the external dependency failure on behalf of DBS. Do not blame the Malaysian network — it reflects on DBS. Present the retry intelligence as DBS actively working for the customer.',
        tone: 'Proactive and confident. "We are on it" energy, not "sorry, external issue."',
        example: '"I can see our system has been working hard to push this through — we\'ve already tried multiple routes. We\'re now switching to our backup payment corridor which should resolve this within the next [timeframe]."',
      },
    ],
    roiPct: 9,
    governanceNotes: 'Requires: External Partnerships review (PayNet SLA addendum), Network Engineering sign-off on secondary route activation triggers.',
  },
};

function dominantArchetype(recommendation: StrategicRecommendation): string {
  // Infer archetype from recommendation title keywords
  if (recommendation.title.includes('Timeout') || recommendation.title.includes('Circuit'))
    return 'Timeout Loop';
  if (recommendation.title.includes('KYC') || recommendation.title.includes('Auth'))
    return 'Auth Rejected';
  if (recommendation.title.includes('Dead-Letter') || recommendation.title.includes('ACK'))
    return 'Silent Drop';
  if (recommendation.title.includes('Saga') || recommendation.title.includes('Settlement'))
    return 'Partial Process';
  if (recommendation.title.includes('Failover') || recommendation.title.includes('Network'))
    return 'Network Flap';
  return 'Timeout Loop';
}

let crCounter = 0;

export function runArchitectAgent(
  recommendation: StrategicRecommendation,
  _insightCard: InsightCard,
): ChangeRequestPackage {
  const archetype = dominantArchetype(recommendation);
  const template = ARCH_TEMPLATES[archetype] ?? ARCH_TEMPLATES['Timeout Loop'];
  crCounter++;

  return {
    clusterId: recommendation.clusterId,
    id: `CR-${String(crCounter).padStart(3, '0')}-${recommendation.clusterId}`,
    title: template.crTitle,
    policyDiff: template.diff,
    contextInjections: template.injections,
    estimatedRoiPct: template.roiPct,
    affectedPolicyFile: template.policyFile,
    governanceNotes: template.governanceNotes,
    generatedAt: new Date().toISOString(),
  };
}

// ─── AI-powered path ──────────────────────────────────────────────────────────
const ARCHITECT_SYSTEM = `You are the Architect agent in Sierra, a fintech operations intelligence platform for DBS Bank.
Given a strategic recommendation and analyst insight, produce a Change Request Package including a git-style policy diff and context injections for a conversational AI agent.

Respond with ONLY valid JSON (no markdown, no extra text):
{
  "title": string,
  "policyDiff": [{"type": "context"|"add"|"remove"|"header"|"meta", "content": string}],
  "contextInjections": [{"trigger": string, "condition": string, "instruction": string, "tone": string, "example": string}],
  "estimatedRoiPct": number,
  "affectedPolicyFile": string,
  "governanceNotes": string
}
policyDiff must include: 2 "meta" lines (--- a/... and +++ b/...), 1 "header" line (@@ ...), 2-3 "context" lines, 2-3 "remove" lines (the old bad policy), 8-14 "add" lines (the new improved policy).
contextInjections: 1-3 items, each with specific trigger conditions and verbatim example dialogue.
estimatedRoiPct: integer between 5 and 25.
affectedPolicyFile: path like "policies/payment-agent/[topic].md".`;

export async function runArchitectAgentAI(
  recommendation: StrategicRecommendation,
  insightCard: InsightCard,
): Promise<ArchitectAIResult> {
  crCounter++;
  const crId = `CR-${String(crCounter).padStart(3, '0')}-${recommendation.clusterId}`;

  const userContent = `Cluster ID: ${recommendation.clusterId}
Recommendation: ${JSON.stringify(recommendation)}
InsightCard: ${JSON.stringify(insightCard)}

Generate the Change Request Package JSON.`;

  try {
    const { text, meta } = await callGemini(ARCHITECT_SYSTEM, userContent, 4096);
    const parsed = JSON.parse(extractJson(text)) as Omit<ChangeRequestPackage, 'clusterId' | 'id' | 'generatedAt'>;
    return {
      cr: { ...parsed, clusterId: recommendation.clusterId, id: crId, generatedAt: new Date().toISOString() },
      meta,
    };
  } catch (err) {
    console.error('[Sierra Architect] AI parse failed, using fallback:', err);
    return { cr: runArchitectAgent(recommendation, insightCard), meta: null };
  }
}
