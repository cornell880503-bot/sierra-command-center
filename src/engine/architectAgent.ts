import type {
  StrategicRecommendation, InsightCard,
  ChangeRequestPackage, PolicyDiffLine, ContextInjection,
  AppMode,
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

const ARCH_TEMPLATES_RECOMMERCE: Record<string, ArchTemplate> = {
  'Boost Not Applied': {
    crTitle: 'CR-R001 · Boost Saga: Atomic Purchase-Application with Auto-Refund',
    policyFile: 'policies/seller-agent/boost-handling.md',
    diff: [
      { type: 'meta',    content: '--- a/policies/seller-agent/boost-handling.md' },
      { type: 'meta',    content: '+++ b/policies/seller-agent/boost-handling.md' },
      { type: 'header',  content: '@@ -8,6 +8,26 @@ ## Boost Purchase Handling' },
      { type: 'context', content: ' ## Boost Purchase Handling' },
      { type: 'context', content: ' ' },
      { type: 'remove',  content: '-If a seller reports their boost is not showing, ask them to wait 24 hours.' },
      { type: 'remove',  content: '-If still not applied after 24 hours, escalate to ops team manually.' },
      { type: 'add',     content: '+### Boost Application Failure Protocol' },
      { type: 'add',     content: '+' },
      { type: 'add',     content: '+When a seller reports a paid boost that is not applied to their listing:' },
      { type: 'add',     content: '+' },
      { type: 'add',     content: '+1. Check boost status: GET /api/v3/boosts/:id/status' },
      { type: 'add',     content: '+2. If status is PAYMENT_CAPTURED but APPLICATION_FAILED:' },
      { type: 'add',     content: '+   - Initiate immediate auto-refund via POST /api/v3/refunds/initiate' },
      { type: 'add',     content: '+   - Notify seller: "Your boost payment has been refunded automatically."' },
      { type: 'add',     content: '+   - Offer a complimentary retry boost of equal value' },
      { type: 'add',     content: '+3. If status is PENDING > 2 hours: escalate to Monetization Engineering' },
      { type: 'add',     content: '+4. NEVER tell a seller to "wait and see" for a paid feature failure.' },
      { type: 'add',     content: '+5. Log all boost failures under category: BOOST-APPLY-FAIL' },
      { type: 'context', content: ' ' },
      { type: 'context', content: ' ### Escalation Thresholds' },
    ],
    injections: [
      {
        trigger: 'Seller reports paid boost not showing increased impressions',
        condition: 'systemContext.apiStatusCode === 500 AND listing has active boost payment',
        instruction: 'Acknowledge the payment immediately. Do not ask the seller to wait. Verify boost status via API and trigger refund if application failed. Offer a complimentary boost.',
        tone: 'Accountable and solution-forward. A seller paying for a feature that silently fails is a trust-breaking moment — own it.',
        example: '"I can confirm your boost payment was received. I can also see the boost was not applied to your listing — this is our error. I\'ve initiated an automatic refund and will apply a complimentary boost within the next 30 minutes."',
      },
    ],
    roiPct: 19,
    governanceNotes: 'Requires: Monetization Engineering sign-off, Finance approval for auto-refund policy, Legal review of "complimentary boost" liability.',
  },
  'Payout Delayed': {
    crTitle: 'CR-R002 · Payout Transparency: Real-Time Disbursement Status + Escalation SLA',
    policyFile: 'policies/seller-agent/payout-handling.md',
    diff: [
      { type: 'meta',    content: '--- a/policies/seller-agent/payout-handling.md' },
      { type: 'meta',    content: '+++ b/policies/seller-agent/payout-handling.md' },
      { type: 'header',  content: '@@ -5,6 +5,27 @@ ## Seller Payout Handling' },
      { type: 'context', content: ' ## Seller Payout Handling' },
      { type: 'context', content: ' ' },
      { type: 'remove',  content: '-For payout delays, tell sellers to wait 5-7 business days.' },
      { type: 'remove',  content: '-If still pending, create a support ticket for the finance team.' },
      { type: 'add',     content: '+### Payout Delay Response Protocol' },
      { type: 'add',     content: '+' },
      { type: 'add',     content: '+When a seller reports a payout delay exceeding 3 business days:' },
      { type: 'add',     content: '+' },
      { type: 'add',     content: '+1. Pull real-time payout status: GET /api/v3/payouts/:id/status' },
      { type: 'add',     content: '+2. If status shows BANK_VERIFICATION_PENDING > 48h: auto-escalate to Finance' },
      { type: 'add',     content: '+3. Communicate exact status to seller: "Your payout is at [STAGE]."' },
      { type: 'add',     content: '+4. For Power Sellers: 24-hour resolution SLA. Assign dedicated case owner.' },
      { type: 'add',     content: '+5. NEVER say "please wait" without providing a specific resolution date.' },
      { type: 'add',     content: '+6. Log delay under: PAYOUT-DELAY-[BANK_CODE] for infrastructure tracking' },
      { type: 'add',     content: '+' },
      { type: 'add',     content: '+**Power Seller escalation matrix:**' },
      { type: 'add',     content: '+| Delay       | Action                          |' },
      { type: 'add',     content: '+|-------------|--------------------------------|' },
      { type: 'add',     content: '+| > 3 days    | Proactive status push + case owner assigned |' },
      { type: 'add',     content: '+| > 5 days    | Finance team escalation + seller compensation review |' },
      { type: 'context', content: ' ' },
      { type: 'context', content: ' ### Bank Partner SLA Matrix' },
    ],
    injections: [
      {
        trigger: 'Power Seller reports payout not received after sale completed',
        condition: 'systemContext.apiStatusCode === 504 AND seller tier === Power Seller',
        instruction: 'Lead with a specific status update, not a vague timeline. Pull the actual payout record, tell the seller exactly what stage it is at and the expected resolution date.',
        tone: 'Precise and ownership-taking. "I can confirm" language, not "I believe" or "it should be".',
        example: '"I can confirm your payout of $[amount] from [sale date] is currently at the bank verification stage — reference [PAYOUT-ID]. For Power Sellers, our SLA is 24 hours from this point. I\'ve flagged your case to our Finance team and will personally follow up by [time] tomorrow."',
      },
    ],
    roiPct: 22,
    governanceNotes: 'Requires: Finance team sign-off on 24h Power Seller SLA, Legal review of compensation language, Banking partner notification for SLA benchmarking.',
  },
  'Offer Ghosted': {
    crTitle: 'CR-R003 · Offer Delivery: Multi-Channel Notification with Buyer Visibility',
    policyFile: 'policies/seller-agent/offer-handling.md',
    diff: [
      { type: 'meta',    content: '--- a/policies/seller-agent/offer-handling.md' },
      { type: 'meta',    content: '+++ b/policies/seller-agent/offer-handling.md' },
      { type: 'header',  content: '@@ -3,5 +3,23 @@ ## Offer Notification Handling' },
      { type: 'context', content: ' ## Offer Notification Handling' },
      { type: 'context', content: ' ' },
      { type: 'remove',  content: '-If buyer reports seller did not respond to offer, advise buyer to message seller directly.' },
      { type: 'add',     content: '+### Offer Notification Failure Protocol' },
      { type: 'add',     content: '+' },
      { type: 'add',     content: '+When a buyer reports their offer was ignored or not seen by the seller:' },
      { type: 'add',     content: '+' },
      { type: 'add',     content: '+1. Check notification delivery status: GET /api/v3/offers/:id/delivery' },
      { type: 'add',     content: '+2. If delivery_status === FAILED: resend via email fallback immediately' },
      { type: 'add',     content: '+3. Tell buyer: "We can confirm your offer was [delivered/not yet delivered]."' },
      { type: 'add',     content: '+4. If offer was not delivered: extend offer expiry by 48 hours automatically' },
      { type: 'add',     content: '+5. NEVER advise buyers to "message the seller directly" for system failures.' },
      { type: 'add',     content: '+6. Log under: OFFER-NOTIF-FAIL-[CHANNEL] for notification team tracking' },
      { type: 'context', content: ' ' },
      { type: 'context', content: ' ### Escalation Thresholds' },
    ],
    injections: [
      {
        trigger: 'Buyer reports no response from seller after sending offer',
        condition: 'offer delivery_status === FAILED OR offer age > 24h with no seller action',
        instruction: 'Check notification delivery before blaming seller inaction. If notification failed, resend immediately and extend offer. Give buyer a definitive status.',
        tone: 'Empowering for the buyer. Make them feel their offer is being actively advocated for, not dismissed.',
        example: '"I can see your offer was sent but our notification system failed to deliver it to the seller. I\'ve resent the notification now and extended your offer by 48 hours so the seller has time to respond. You\'ll receive a confirmation once they\'ve seen it."',
      },
    ],
    roiPct: 15,
    governanceNotes: 'Requires: Notifications Platform sign-off, Product approval for offer expiry extension policy, Legal review of buyer communication commitments.',
  },
  'Listing Rejected': {
    crTitle: 'CR-R004 · Listing Policy: Explainable Rejections + Self-Service Appeal Flow',
    policyFile: 'policies/seller-agent/listing-rejection.md',
    diff: [
      { type: 'meta',    content: '--- a/policies/seller-agent/listing-rejection.md' },
      { type: 'meta',    content: '+++ b/policies/seller-agent/listing-rejection.md' },
      { type: 'header',  content: '@@ -4,5 +4,22 @@ ## Listing Rejection Handling' },
      { type: 'context', content: ' ## Listing Rejection Handling' },
      { type: 'context', content: ' ' },
      { type: 'remove',  content: '-When a listing is rejected, inform the seller to review our community guidelines.' },
      { type: 'remove',  content: '-Direct them to the help center for more information.' },
      { type: 'add',     content: '+### Listing Rejection — Explainable Response Protocol' },
      { type: 'add',     content: '+' },
      { type: 'add',     content: '+When a seller contacts regarding a rejected listing:' },
      { type: 'add',     content: '+' },
      { type: 'add',     content: '+1. Pull rejection reason code: GET /api/v3/listings/:id/rejection-reason' },
      { type: 'add',     content: '+2. Provide the SPECIFIC reason, not a generic policy link' },
      { type: 'add',     content: '+3. Give actionable fix instructions: "Change [specific field] from [X] to [Y]"' },
      { type: 'add',     content: '+4. For Power Sellers: offer fast-track human review within 2 hours' },
      { type: 'add',     content: '+5. If reason code is KEYWORD_MATCH: flag for policy team review (likely false positive)' },
      { type: 'add',     content: '+6. NEVER send sellers to generic help center for a rejection they did not cause.' },
      { type: 'context', content: ' ' },
      { type: 'context', content: ' ### Category-Specific Rejection Codes' },
    ],
    injections: [
      {
        trigger: 'Seller frustrated that valid listing was rejected without clear reason',
        condition: 'rejection_reason_code === KEYWORD_MATCH OR seller has > 95% compliance history',
        instruction: 'Acknowledge that this may be a false positive. Do not defend the policy engine. Give a specific reason and a clear path to resolution or appeal.',
        tone: 'Empathetic and specific. A seller who played by the rules and was rejected needs validation, not a policy lecture.',
        example: '"I can see your listing for [item] was rejected by our automated policy check. Looking at the details, this appears to be a false positive triggered by the keyword [X]. I\'ve submitted this for human review — you should have a decision within 2 hours. I\'m sorry for the inconvenience."',
      },
    ],
    roiPct: 13,
    governanceNotes: 'Requires: Trust & Safety Engineering sign-off, Policy team review of false-positive threshold, Product approval for fast-track review SLA for Power Sellers.',
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

export function resetCrCounter(): void {
  crCounter = 0;
}

function dominantArchetypeRecommerce(recommendation: StrategicRecommendation): string {
  if (recommendation.title.includes('Boost') || recommendation.title.includes('Saga'))
    return 'Boost Not Applied';
  if (recommendation.title.includes('Payout') || recommendation.title.includes('Disbursement'))
    return 'Payout Delayed';
  if (recommendation.title.includes('Offer') || recommendation.title.includes('Notification'))
    return 'Offer Ghosted';
  if (recommendation.title.includes('Listing') || recommendation.title.includes('Rejection'))
    return 'Listing Rejected';
  return 'Boost Not Applied';
}

export function runArchitectAgent(
  recommendation: StrategicRecommendation,
  _insightCard: InsightCard,
  mode: AppMode = 'FINTECH',
): ChangeRequestPackage {
  let archetype: string;
  let template: ArchTemplate;
  if (mode === 'RECOMMERCE') {
    archetype = dominantArchetypeRecommerce(recommendation);
    template = ARCH_TEMPLATES_RECOMMERCE[archetype] ?? ARCH_TEMPLATES_RECOMMERCE['Boost Not Applied'];
  } else {
    archetype = dominantArchetype(recommendation);
    template = ARCH_TEMPLATES[archetype] ?? ARCH_TEMPLATES['Timeout Loop'];
  }
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
const ARCHITECT_SYSTEM_RECOMMERCE = `You are the Architect agent in Sierra, an AI governance platform for Carousell recommerce marketplace.
Given a strategic recommendation and analyst insight, produce a Change Request Package including a git-style policy diff and seller agent context injections.

Return a JSON object with exactly these keys:
- reasoning: 2-3 sentences explaining your architectural decisions
- title: the change request title (e.g. "CR-R001 · Fix: ...")
- policyDiff: array of objects, each with "type" (one of "meta", "header", "context", "add", "remove") and "content" (string). Must include 2 meta lines (--- a/... and +++ b/...), 1 header line (@@ ...), 2-3 context lines, 2-3 remove lines showing the old policy, and 8-14 add lines showing the new improved policy
- contextInjections: array of 1-3 objects, each with "trigger" (string), "condition" (string), "instruction" (string), "tone" (string), and "example" (string with verbatim seller agent dialogue)
- estimatedRoiPct: integer between 8 and 25
- affectedPolicyFile: file path like "policies/seller-agent/topic-name.md"
- governanceNotes: string listing required approvals from marketplace teams (Trust & Safety, Monetization, Finance, etc.)`;

const ARCHITECT_SYSTEM = `You are the Architect agent in Sierra, a fintech operations intelligence platform for DBS Bank.
Given a strategic recommendation and analyst insight, produce a Change Request Package including a git-style policy diff and context injections for a conversational AI agent.

Return a JSON object with exactly these keys:
- reasoning: 2-3 sentences explaining your architectural decisions
- title: the change request title (e.g. "CR-001 · Fix: ...")
- policyDiff: array of objects, each with "type" (one of "meta", "header", "context", "add", "remove") and "content" (string). Must include 2 meta lines (--- a/... and +++ b/...), 1 header line (@@ ...), 2-3 context lines, 2-3 remove lines showing the old policy, and 8-14 add lines showing the new improved policy
- contextInjections: array of 1-3 objects, each with "trigger" (string), "condition" (string), "instruction" (string), "tone" (string), and "example" (string with verbatim agent dialogue)
- estimatedRoiPct: integer between 5 and 25
- affectedPolicyFile: file path like "policies/payment-agent/topic-name.md"
- governanceNotes: string listing required approvals and compliance considerations`;

export async function runArchitectAgentAI(
  recommendation: StrategicRecommendation,
  insightCard: InsightCard,
  mode: AppMode = 'FINTECH',
): Promise<ArchitectAIResult> {
  crCounter++;
  const crId = `CR-${String(crCounter).padStart(3, '0')}-${recommendation.clusterId}`;
  const systemPrompt = mode === 'RECOMMERCE' ? ARCHITECT_SYSTEM_RECOMMERCE : ARCHITECT_SYSTEM;

  const userContent = `Cluster ID: ${recommendation.clusterId}
Recommendation title: ${recommendation.title}
Recommended action: ${recommendation.action}
Priority: ${recommendation.priority} (score: ${recommendation.priorityScore})
Primary issue: ${insightCard.primaryIssue}
Affected subsystem: ${insightCard.affectedSubsystem}
Technical debt: ${insightCard.technicalDebtLevel}
Root cause: ${insightCard.rootCauseDetail}
Affected API path: ${insightCard.affectedApiPath}

Generate the Change Request Package JSON.`;

  try {
    const { text, meta } = await callGemini(systemPrompt, userContent, 8192);
    const parsed = JSON.parse(extractJson(text)) as Omit<ChangeRequestPackage, 'clusterId' | 'id' | 'generatedAt'>;
    return {
      cr: { ...parsed, clusterId: recommendation.clusterId, id: crId, generatedAt: new Date().toISOString() },
      meta,
    };
  } catch (err) {
    console.error('[Sierra Architect] AI parse failed, using fallback:', err);
    return { cr: runArchitectAgent(recommendation, insightCard, mode), meta: null };
  }
}
