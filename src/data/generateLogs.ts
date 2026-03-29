import type { FrictionLog, ApiStatusCode, CustomerTier, DialogueTurn } from '../types';

// Seeded PRNG (mulberry32) for deterministic output
function mulberry32(seed: number) {
  return function () {
    seed |= 0; seed = seed + 0x6D2B79F5 | 0;
    let t = Math.imul(seed ^ seed >>> 15, 1 | seed);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}

const rng = mulberry32(0xDEADBEEF);
const rand = () => rng();
const randInt = (min: number, max: number) => Math.floor(rand() * (max - min + 1)) + min;
const pick = <T>(arr: T[]): T => arr[Math.floor(rand() * arr.length)];

// ─── Archetype definitions ────────────────────────────────────────────────────
type Archetype = {
  name: string;
  count: number;
  errorCodes: ApiStatusCode[];
  latencyRange: [number, number];
  retryRange: [number, number];
  tiers: CustomerTier[];
  npsRange: [number, number];
};

const ARCHETYPES: Archetype[] = [
  { name: 'Timeout Loop',       count: 22, errorCodes: [504],      latencyRange: [8000, 12000], retryRange: [2, 4], tiers: ['Platinum', 'Gold'],  npsRange: [-1, 1]  },
  { name: 'Auth Rejected',      count: 18, errorCodes: [402, 503], latencyRange: [1200, 4500],  retryRange: [0, 2], tiers: ['Gold'],              npsRange: [-2, -1] },
  { name: 'Silent Drop',        count: 20, errorCodes: [408],      latencyRange: [5000, 9000],  retryRange: [3, 4], tiers: ['Platinum'],          npsRange: [-2, 0]  },
  { name: 'Partial Process',    count: 25, errorCodes: [500],      latencyRange: [3000, 7000],  retryRange: [1, 3], tiers: ['Platinum', 'Gold'],  npsRange: [-1, 1]  },
  { name: 'Network Flap',       count: 15, errorCodes: [503],      latencyRange: [800, 2500],   retryRange: [3, 4], tiers: ['Gold'],              npsRange: [-2, -1] },
  // New archetypes
  { name: 'Duplicate Charge',   count: 10, errorCodes: [500, 408], latencyRange: [4000, 8000],  retryRange: [0, 1], tiers: ['Platinum'],          npsRange: [-2, -2] },
  { name: 'FX Rate Dispute',    count: 10, errorCodes: [402, 500], latencyRange: [1000, 3000],  retryRange: [0, 0], tiers: ['Gold', 'Platinum'],  npsRange: [-1, 0]  },
  { name: 'Wrong Recipient',    count: 10, errorCodes: [503, 500], latencyRange: [2000, 5000],  retryRange: [0, 2], tiers: ['Gold'],              npsRange: [-2, -2] },
];

// ─── Dialogue pools ───────────────────────────────────────────────────────────

// ── Timeout Loop ──────────────────────────────────────────────────────────────
const timeoutC1 = [
  "Hi, I initiated a PayNow transfer to a Malaysian DuitNow number about 40 minutes ago and it still hasn't gone through. The funds left my account but the recipient hasn't received anything.",
  "I'm trying to transfer SGD 2,800 via PayNow to a DuitNow account in Malaysia. The transaction status says 'pending' but it's been over an hour. Can you help?",
  "My PayNow to DuitNow cross-border payment is stuck. Transaction ID is TXN-8847261. It debited my account but the other side shows nothing received.",
  "I need urgent help. I sent money to a Malaysian DuitNow number and got a timeout error but my account was still debited. Is the payment going through or not?",
  "Good afternoon, I made a PayNow-to-DuitNow transfer for an urgent business payment. It's been 55 minutes and the status keeps showing 'processing'. This is critical.",
  "The cross-border transfer I made this morning hasn't cleared. My counterpart in KL is waiting. Can you check what's happening on the DuitNow side?",
];
const timeoutA1 = [
  "I understand your concern. Let me pull up the transaction. Could you provide your transaction reference number and the recipient's DuitNow proxy ID?",
  "Thank you for reaching out. I can see there's a cross-border processing issue today. Please share the transaction ID so I can investigate.",
  "I'll look into this right away. Cross-border PayNow transfers can sometimes take longer due to MAS and BNM reconciliation windows.",
  "Thank you for contacting us. Let me check the settlement status. Can you confirm the recipient's DuitNow registered phone number?",
];
const timeoutC2 = [
  "The reference is TXN-8847261. I've already tried refreshing the app twice. My account shows the debit but there's no confirmation receipt.",
  "Reference: PAY-DUI-993821. The recipient is waiting for the funds — this is for a time-sensitive supplier payment. Why is it taking this long?",
  "Transaction ID: XBDR-445-2291. I retried the payment twice already and both attempts show 'pending'. Now I'm worried about duplicate charges.",
  "Here's the reference: TXN-20240329-7731. The DuitNow proxy is +60-11-2345-6789. I've been waiting 50 minutes and the status hasn't changed.",
  "TXN-884-DBSSG-01. My recipient in KL says their bank shows no incoming transfer. Am I going to be charged twice if this fails?",
];
const timeoutA2 = [
  "Thank you. I can see the transaction entered our gateway but we received a 504 timeout response from the DuitNow network. Our system is retrying, but I cannot confirm an ETA at this time.",
  "I've located the transaction. It appears the cross-border gateway timed out during the routing phase. The funds are held in our settlement queue — I'm unable to confirm when they'll clear.",
  "I can see the transaction. The gateway returned a 504 error after the 8-second SLA window. Our system queued a retry but I don't have real-time visibility on the retry status.",
];
const timeoutC3 = [
  "So you're telling me my money is just... floating somewhere? When will I get a definitive answer? This is completely unacceptable for a DBS Platinum account.",
  "I need a resolution now, not an escalation. What's the latest ETA? My supplier is threatening to cancel the order if funds don't arrive in the next hour.",
  "I'm very frustrated. I've been a DBS customer for 8 years and this is the third time this month I've had issues with cross-border payments. Can someone senior look at this?",
  "Are my funds safe? Is there any risk of losing the money if the transaction fails? I need a clear yes or no answer.",
];
const timeoutA3 = [
  "I completely understand your frustration and I sincerely apologize. Your funds are held securely in our settlement buffer. However, I'm unable to provide a specific ETA for resolution — our gateway team would need to manually intervene, which I cannot initiate from my end.",
  "I hear you and I'm sorry for the experience. The funds won't be lost, but the timeout issue is at the network infrastructure level. I can only log a complaint — I don't have tools to expedite the gateway recovery.",
  "Your concern is completely valid. I can confirm the funds are safe, but the settlement window for cross-border payments can extend to 4 hours during peak periods. I cannot force-push the transaction.",
];
const timeoutC4 = [
  "So what exactly can you do right now? It sounds like you can't solve anything. I want to speak to a manager and I'm also going to file a formal complaint.",
  "This is completely unhelpful. I've been on this call for 20 minutes and nothing has been resolved. I'm going to switch banks. What's the complaint reference number?",
  "Fine. What's the ticket number? And how will I know when this is resolved — are you going to call me back or do I have to keep calling in?",
];
const timeoutA4 = [
  "I completely understand and I sincerely apologize. Your complaint reference is CMP-2024-88471. I'm unable to commit to a callback time or resolution window — that would be managed by our escalation team. I'm sorry I couldn't do more today.",
  "I'm very sorry for the frustration. I've logged everything under ticket INC-TML-9921. I cannot guarantee a 24-hour resolution as this depends on the DuitNow network restoring connectivity. I apologize that I cannot offer more certainty.",
  "I've raised ticket INC-TML-0041 with P2 priority. Someone from our payments operations team will follow up within 4 hours. I'm sorry I couldn't resolve this for you directly.",
];

// ── Auth Rejected ─────────────────────────────────────────────────────────────
const authC1 = [
  "My PayNow-to-DuitNow transfer just got blocked. I have sufficient funds and my account is in good standing. Why was it rejected?",
  "I tried to send SGD 3,500 to a Malaysian DuitNow number and the app showed a payment authorization error. My account is a Gold account — why is this being blocked?",
  "I'm getting an error saying my cross-border payment authorization failed. HTTP 402 is showing in the error log. I've never had this issue before.",
  "My transfer of SGD 2,100 to Malaysia was rejected without any explanation. Can you tell me what 'KYC verification required' means in this context?",
  "This is the second time this week my DuitNow transfer has been blocked. I'm trying to pay rent for my property in Johor Bahru.",
  "The DBS app says my cross-border transfer was declined due to an authorization policy. I don't understand why — I made the same transfer last month without any issues.",
];
const authA1 = [
  "I'll need to verify your identity before we proceed. Can you confirm your registered mobile number and the last 4 digits of your NRIC?",
  "For cross-border payment queries, I need to validate your account eligibility first. What's your account number?",
  "Thank you for reaching out. I can look into the rejection. Can you provide the transaction reference number?",
  "I'm sorry to hear about the issue. Cross-border authorization rejections can occur for several reasons. Let me pull up the details — what's your full name and account number?",
];
const authC2 = [
  "My NRIC ends in 123A and my mobile is +65-9XXX-XXXX. I've been a Gold member for 3 years. Why is my KYC suddenly not valid?",
  "Account number is DBS-XXXX-XXXX. The transaction ref is TXN-AUTH-3321. The recipient is a verified DuitNow number in Malaysia.",
  "TXN-DUI-AUTH-9987. The payment was for SGD 3,500. My KYC was done when I opened the account — why does it need to be re-done?",
  "Reference PAY-KYC-7731. I've been making transfers to this same DuitNow number for 6 months. Why is it suddenly requiring additional verification?",
];
const authA2 = [
  "I've checked your account. Unfortunately, this transaction was flagged under our cross-border payment policy — your account tier requires additional KYC verification for transfers above SGD 2,000 to Malaysia.",
  "I see the issue. The payment was rejected at the authorization layer. Your cross-border KYC token expired 12 days ago. Renewals are required every 90 days for Gold tier accounts.",
  "I can see the rejection. Your account has a cross-border transfer limit of SGD 2,000 per transaction for your current tier. The requested amount of SGD 3,500 exceeds this limit.",
  "The rejection was triggered by our compliance policy: your cross-border authorization credentials expired. This is a routine security requirement, not a reflection of your account standing.",
];
const authC3 = [
  "I'm very sorry for this experience. The rejection was system-initiated due to policy parameters I cannot override. You would need to visit a branch or submit a cross-border limit increase request, which takes 2–3 business days.",
  "Nobody told me there was a 90-day renewal requirement. This is a recurring payment — why wasn't I notified before it expired? This has caused real financial inconvenience.",
  "So you're saying I have to wait 2–3 business days to send money I've been sending for months? This process makes no sense. Why can't you just verify me right now over the call?",
  "I need to make this payment today. Is there any way to expedite this? I'm willing to do any verification needed.",
];
const authA3 = [
  "I completely understand your frustration. Unfortunately, I'm unable to perform identity verification through this channel or override the policy block. You can submit the KYC renewal form digitally via the DBS app, which typically processes in 1 business day.",
  "I hear you and I'm sorry for the inconvenience. In-call verification isn't permitted under our security policy. The fastest path is the in-app KYC uplift flow — it usually takes under 5 minutes to complete.",
  "I wish I could do more from my end, but the authorization layer requires formal re-verification. I can send you a direct link to the uplift form via SMS right now if that would help.",
];
const authC4 = [
  "5 minutes in the app? Then why wasn't I directed there immediately instead of waiting on this call? This is a waste of time. Send me the link.",
  "Fine. Send the link. But I want a formal complaint raised about the lack of notification before my credentials expired.",
  "Okay, I'll try the app. But this better work — I've already wasted 30 minutes on this. What's my complaint reference?",
];
const authA4 = [
  "I apologize for the poor experience. I've sent the uplift link to your registered mobile. Complaint reference: CMP-AUTH-2024-3312. Once the KYC is renewed, your transfer will go through immediately.",
  "Link sent. Complaint has been logged under CMP-KYC-7731. I've also flagged your account for a proactive renewal reminder 30 days before the next expiry. I'm sorry for today's experience.",
  "I've raised the complaint as CMP-AUTH-0041. The link is on its way. And I've personally escalated the notification gap issue to our product team — this shouldn't happen to customers who make recurring transfers.",
];

// ── Silent Drop ───────────────────────────────────────────────────────────────
const silentC1 = [
  "I made a PayNow transfer to a DuitNow number in Malaysia and my account was debited, but the recipient says they received nothing. The transaction just disappeared.",
  "Something very concerning happened — I transferred SGD 5,000 to my partner in Malaysia. My DBS account shows the debit but there's no record on the other side. Where did my money go?",
  "My cross-border payment went through on my end but the Malaysian bank is showing nothing. It's been 3 hours. I'm extremely worried. This is Platinum account level service?",
  "Transaction TXN-DROP-4421 was processed from my side but there's no acknowledgment anywhere. I checked the DuitNow status page — nothing. My funds are missing.",
  "I sent SGD 8,200 to a business contact in Kuala Lumpur 2 hours ago. My statement shows the debit as completed but the recipient has received nothing. I need answers.",
];
const silentA1 = [
  "I apologize for the inconvenience. Our PayNow-DuitNow corridor is experiencing intermittent connectivity. Can you share the transaction reference?",
  "I can see your concern. The cross-border gateway has been flagging some timeouts. Please provide the transaction details so I can investigate the settlement status.",
  "Thank you for flagging this. This type of discrepancy is unusual and we take it very seriously. Can you provide the transaction reference and recipient's DuitNow proxy ID?",
  "I understand how alarming this must be. Let me check the settlement queue immediately. What's the transaction reference?",
];
const silentC2 = [
  "Reference: TXN-DROP-4421. The recipient's DuitNow number is +60-12-XXX-XXXX. They've checked with their bank — absolutely nothing received.",
  "XBDR-SILNT-9920. Recipient is a DuitNow proxy email in Malaysia. I can provide their bank details. I retried twice but that didn't help — now I'm worried about triple charges.",
  "PAY-SD-20240329-771. The amount was SGD 8,200. My partner has confirmed with CIMB Bank that nothing was received. This is urgent.",
  "TXN-PLAT-DROP-0011. I only retried once because a friend told me retrying might cause duplicate charges. I don't know what to do.",
];
const silentA2 = [
  "I can see the transaction initiated but there's no acknowledgment from the DuitNow side. This is a silent drop scenario — our system sent the request but received no response. I'm escalating to our payment operations team.",
  "The transaction shows as dispatched from our end but the DuitNow network didn't confirm receipt. I'm logging a P2 incident. The funds are in a hold state — they haven't been lost.",
  "I can confirm the debit processed on our side. However, there's no acknowledgment in our settlement log from DuitNow. This is in our dead-letter queue — I'm escalating now.",
  "This is flagged in our system as an unacknowledged settlement. The good news: this doesn't mean the money is lost. Our ops team needs to manually reconcile this case.",
];
const silentC3 = [
  "I completely understand your concern. I've created incident ticket INC-20240329-8821. Unfortunately, I cannot provide a timeline — I don't have visibility into their queue.",
  "So my money is just stuck somewhere and you can't tell me when it'll be resolved? That's not good enough. How do I know the funds are actually safe?",
  "Give me something concrete. When will this be resolved? What if DuitNow never acknowledges? Will the money just be gone?",
  "I've been a DBS Platinum customer for 11 years. In all that time, I've never had money just disappear. What guarantee do I have that I'll get it back?",
];
const silentA3 = [
  "I completely understand your concern. I've created incident ticket INC-20240329-8821. The payment operations team will investigate, but I cannot provide a timeline from my end.",
  "Your funds are absolutely not lost. Our system holds them in a secure buffer. However, I'm being honest with you: I don't have the tools to push this through manually — it requires backend intervention.",
  "I can confirm with certainty that your funds are in our settlement buffer. They cannot leave DBS in an unresolved state. The worst outcome is a full auto-reversal within 3–5 business days.",
  "I hear the frustration and I take full responsibility for this experience. The funds are safe. What I cannot promise is a quick resolution — the reconciliation process involves both MAS and BNM systems.",
];
const silentC4 = [
  "3–5 business days is completely unacceptable for a payment of this size. I need written confirmation that my funds are safe and a commitment from DBS on the resolution timeline.",
  "I'm going to file a formal complaint with MAS about this. What's the reference number for my incident?",
  "I need a specific escalation point — not a ticket number. I want to know who is responsible for this and how to reach them directly.",
];
const silentA4 = [
  "I deeply apologize. Incident INC-SD-20240329-441 has been raised with P1 priority given the amount. I cannot issue formal written confirmation through this channel — please use DBS Secure Mailbox for official documentation.",
  "Your escalation is completely valid. Ticket INC-SD-8841 is at P2 priority. I'm unable to provide a direct contact within ops, but I can escalate the case and request a priority callback within 2 hours.",
  "I understand. Incident INC-SD-PLT-0011 has been raised. For written confirmation, please use the DBS Secure Message feature in the app — our team will respond with an official fund status letter within 4 business hours.",
];

// ── Partial Process ───────────────────────────────────────────────────────────
const partialC1 = [
  "I made a cross-border PayNow payment and my account was debited, but the status shows 'partially processed'. What does that mean exactly?",
  "My transaction went through the debit but the credit to the Malaysian DuitNow account is stuck on 'pending settlement'. This has been going on for 90 minutes.",
  "I see a transaction in partial state on my DBS app. SGD 4,800 was debited but the recipient says nothing was received. Is this normal?",
  "The payment status shows 'debit complete, credit pending'. I've never seen this before. What does it mean and when will it complete?",
  "I made a payment for my business invoice and it's showing as 'partially settled'. My Malaysian client is asking for confirmation and I don't know what to tell them.",
];
const partialA1 = [
  "Thank you for contacting us. I can see a transaction matching your description. Let me check the settlement status on our end.",
  "I'll look into this right away. Cross-border PayNow transfers can sometimes take longer due to MAS and BNM reconciliation windows.",
  "Thank you for raising this. 'Partially processed' is a specific state in our cross-border payment flow. Let me explain what's happening.",
  "I can see the transaction in our system. The partial state means the first leg of the payment completed but the second leg is pending. Can I get the transaction reference?",
];
const partialC2 = [
  "Reference TXN-PART-8821. The recipient has confirmed with their bank — they see no incoming transfer.",
  "XBDR-PP-20240329-0041. Amount was SGD 4,800. My client in KL needs this for a pending order.",
  "PAY-PARTIAL-7732. I retried once which might have been a mistake. Now I'm worried about being charged twice.",
  "TXN-PP-PLAT-9921. This is for an urgent business payment. My vendor is threatening to cancel the contract.",
];
const partialA2 = [
  "I can see the debit on your account was processed, but the credit instruction to DuitNow is still pending reconciliation. This sometimes happens during high-volume periods. I cannot force the settlement.",
  "Our system shows the transaction as 'partially settled' — the debit completed but the cross-border credit leg is pending. The Kafka event queue for this routing path is showing a delay.",
  "The partial state means step 1 (debit from your account) completed, and step 2 (credit to DuitNow) is queued but not yet confirmed by BNM's settlement system. I cannot manually push this.",
  "I can see this clearly: debit confirmed, credit leg in queue. The reconciliation system runs every 15 minutes — your next status check should be at [current time + 15 min].",
];
const partialC3 = [
  "Your funds are safe on our end. The partial settlement state means no money has been lost. However, I'm unable to manually push the credit instruction to DuitNow.",
  "So I have to wait 15 minutes? Or longer? My client needs confirmation NOW. Can you at least send them something official saying the payment is on its way?",
  "This is really frustrating. The invoice is overdue and now I have a partial settlement that I can't explain to my client. Can't you just cancel it and let me retry?",
  "I've made this exact same payment last month and it cleared in 3 minutes. Why is it taking this long today?",
];
const partialA3 = [
  "I understand the urgency. The partial processing state is frustrating — I can see it from my tools but cannot resolve it directly. I'd need to raise a request to our payment ops team which typically responds in 4–6 hours.",
  "I'm sorry I can't give you a better answer. I can't issue official letters through this channel, but I can create a payment status note that you can share with your client. Would that help?",
  "Cancellation isn't possible once the debit leg has processed — that would create a more complex reconciliation issue. The fastest path is to wait for the 15-minute reconciliation window.",
  "Today's processing delay is related to a higher-than-usual volume on the MAS-BNM corridor. I completely understand this is inconvenient — I've raised it as a priority case.",
];
const partialC4 = [
  "4–6 hours is way too long. I need this resolved today. What's the ticket number and can someone call me back?",
  "If this doesn't clear in 30 minutes I'm going to initiate a chargeback. What's the complaint reference?",
  "Fine. What's the ticket? I want a commitment that someone will update me before end of business.",
];
const partialA4 = [
  "I'm sorry for the unresolved status. Ticket INC-PS-20240329-992 has been raised. I cannot commit to 24 hours — partial settlement cases depend on the overnight reconciliation cycle between MAS and BNM systems.",
  "Complaint logged as CMP-PP-4421. I've flagged your case for priority callback — someone from our payments team will reach you within 2 hours. I'm very sorry I couldn't do more.",
  "Ticket INC-PP-BSNS-0044 raised. I've requested a priority status update by 6 PM today. I apologize for the inconvenience to your business.",
];

// ── Network Flap ──────────────────────────────────────────────────────────────
const netC1 = [
  "Hi, I'm trying to transfer money to Malaysia via PayNow-DuitNow and keep getting a service unavailable error. Is the network down?",
  "I've tried 4 times to send a payment to a DuitNow number and every attempt fails with 503. What's happening?",
  "My DuitNow transfer has been failing for the past hour with a network error. I'm a Gold customer — is there a priority support line for this?",
  "The PayNow cross-border transfer feature seems completely broken. I've been trying since this morning and keep getting 503 errors. Is there a known issue?",
  "I keep getting 'service unavailable' when trying to send to Malaysia. This has happened 3 times in the past 2 weeks. It's getting very unreliable.",
];
const netA1 = [
  "I'm sorry to hear that. We're currently experiencing some network instability on the DuitNow gateway. Let me check the status.",
  "Thanks for reaching out. The DuitNow routing layer has had some issues today. Can you share your transaction ID?",
  "I apologize for the disruption. There is a known intermittent connectivity issue with the PayNet Malaysia gateway. Can I get your account details?",
  "Thank you for contacting us. We're aware of some instability on the SG-MY cross-border corridor. Let me check if your specific transaction was affected.",
];
const netC2 = [
  "Transaction ID XBDR-NF-8821. I need to send SGD 2,500 to my supplier in Johor. They need it by today.",
  "TXN-NET-503-7731. I retried 4 times. Each time it fails at the same point. Is the money being deducted multiple times?",
  "PAY-NF-20240329-441. My recipient says their bank shows nothing incoming. When will this be fixed?",
  "TXN-503-GOLD-0092. This is urgent — it's a rental payment and my landlord is going to charge a late fee. Can you manually push it through?",
];
const netA2 = [
  "The DuitNow gateway returned a 503 error three times. Your transaction is in a retry queue. The network has been unstable for about 2 hours and I can't give you a resolution window.",
  "I can see 4 retry attempts on this transaction. You won't be charged multiple times — our deduplication system prevents that. The network is flapping between the SG and MY corridors.",
  "Your payment hasn't gone through yet and no money has been deducted for the failed attempts. The issue is on the Malaysian network side — I don't have the ability to manually push payments through.",
  "I can confirm: no deductions have occurred. Our system retries automatically. However, I cannot override the network routing — that's infrastructure-level and outside my tools.",
];
const netC3 = [
  "Can confirm you were only debited once. The retry attempts were system-level and wouldn't create additional charges. However, I cannot guarantee when the network instability will be resolved.",
  "So I just have to wait? How long has this been going on and when will it be fixed? I have a deadline today.",
  "Is there any alternative way to get money to Malaysia right now? Western Union? Anything?",
  "I'm going to file a formal complaint. This is the third time this month I've had issues with DuitNow. It's completely unreliable.",
];
const netA3 = [
  "I can confirm you were only debited once. The retry attempts were system-level. However, I cannot guarantee when the network instability will be resolved — that's outside my control.",
  "I completely understand the urgency. Unfortunately, I don't have a timeline for when the PayNet Malaysia connectivity will be restored. I'd suggest checking the DBS status page for live updates.",
  "For urgent transfers, you could try SWIFT-based wire transfer as an alternative — it uses a different routing path. However, that has a different fee structure and takes 1–2 business days.",
  "I hear your frustration. This is a third-party network issue we're actively monitoring. I can raise a formal complaint and request a fee waiver for the inconvenience.",
];
const netC4 = [
  "I'm genuinely sorry for this experience. Reference number: INC-NF-20240329-881. I cannot guarantee a 24-hour resolution as this is a bilateral network issue.",
  "Please raise the complaint. Reference number and an update by end of day is the minimum I expect.",
  "I'm not interested in a fee waiver — I want the service to work reliably. What's the complaint reference?",
];
const netA4 = [
  "I'm genuinely sorry for this experience. Reference number: INC-NF-20240329-881. I cannot guarantee a 24-hour resolution as this is a bilateral network issue between MAS and Bank Negara systems.",
  "Complaint raised as CMP-NF-7742. I've flagged the recurring pattern on your account for review. You'll receive an update by 6 PM today.",
  "Complaint reference CMP-NETFLAP-0082. I've also flagged this as a recurring issue and requested a service reliability review for your account.",
];

// ── Duplicate Charge ──────────────────────────────────────────────────────────
const dupC1 = [
  "I need urgent help — I'm seeing TWO debits on my account for the same DuitNow transfer. My statement shows SGD 5,400 debited twice. This is a serious error.",
  "My PayNow transfer to Malaysia failed with a timeout, so I retried it manually. Now I see two separate debits of SGD 3,200 each. This is a nightmare.",
  "I sent a PayNow-to-DuitNow payment and it showed an error, so I tried again. Now I'm showing two identical debits from my Platinum account. How is this possible?",
  "Something is very wrong. I retried a failed cross-border payment and now my account shows SGD 6,800 deducted twice — once for the original failed attempt and once for the retry.",
  "My account has been double-charged for a PayNow transfer to Malaysia. The first attempt showed a timeout error but the money was still taken, then I retried and was charged again.",
];
const dupA1 = [
  "I can see why you're alarmed. Double debits are extremely rare but do happen during retry scenarios. Can you provide both transaction references so I can investigate immediately?",
  "This is a serious issue and I want to resolve it for you right away. Please provide your transaction IDs for both debits so I can verify the status.",
  "I'm pulling up your account now. Can you confirm the exact amounts and dates of both debits? I want to get this escalated correctly.",
  "Thank you for flagging this urgently. I'll check your account for duplicate transactions right now. What's your account number?",
];
const dupC2 = [
  "First transaction: TXN-DUP-8821, SGD 5,400, showed timeout error. Second: TXN-DUP-8822, SGD 5,400, also shows pending. Both happened within 5 minutes.",
  "The references are PAY-ORIG-4421 and PAY-RETRY-4422. Both SGD 3,200. First one showed HTTP 504, then I waited 2 minutes and retried. Both are now 'pending'.",
  "XBDR-DUP-7731 and XBDR-DUP-7732. Identical amounts, SGD 6,800. Sent 4 minutes apart. First one never resolved but the money left my account.",
  "I have the transaction IDs: TXN-PLAT-DUP-001 (original) and TXN-PLAT-DUP-002 (retry). Both show 'processing'. My balance is down SGD 9,600 when it should only be SGD 4,800.",
];
const dupA2 = [
  "I can see both transactions in our system. I want to be transparent with you: I'm seeing that both debits have been processed, but I cannot confirm whether the recipient received two transfers or one. Our deduplication system should have caught this, but clearly something went wrong.",
  "I've located both transactions. I can see the first timed out at the gateway level, but the debit was still processed due to a race condition in our settlement system. I'm logging this as a P1 incident immediately.",
  "I can confirm both debits. I'm unable to reverse these myself — this requires a manual investigation by our payments operations team to determine which transaction should stand and which should be refunded.",
  "I see both charges. I'm going to be honest: this is a system error. Our retry flow should have detected the pending state of the first transaction before processing the second. I'm escalating this right now.",
];
const dupC3 = [
  "This is completely unacceptable. SGD 5,400 is a significant amount. You're telling me you can't even tell me where my money went? I'm considering legal action.",
  "Race condition? I'm a customer, not a developer. I need my money back within 24 hours. If DBS caused this error, DBS needs to fix it TODAY.",
  "I want a written commitment that the duplicate charge will be reversed. I'm not waiting for an investigation — I want the timeline in writing.",
  "How is it possible that a bank of DBS's calibre has a bug like this? This is fraudulent double-charging. I want to speak to a manager immediately.",
];
const dupA3 = [
  "I completely understand your frustration and I want to assure you: we will refund the duplicate charge. However, I need to escalate this to our payment ops team to confirm which transaction was successful before processing the refund. I cannot commit to 24 hours, but this is P1 priority.",
  "You're absolutely right to be upset. This is a system error and DBS is fully responsible. I'm escalating to our senior payments team right now. The duplicate amount will be reviewed for refund within 2 business days.",
  "I hear you. I'm raising this as a P0 incident given the amount. I cannot issue a refund directly from my end, but I can commit to a priority callback from our payments operations within 2 hours.",
  "I'm escalating to my supervisor right now. This is an unacceptable error. You will receive a formal response within 4 business hours with a resolution commitment.",
];
const dupC4 = [
  "2 business days is NOT acceptable. This is over SGD 5,000. I want same-day resolution or I'm filing a complaint with MAS.",
  "Get me a manager. Now. I'm not accepting a ticket number as a resolution.",
  "Fine. What's the incident reference? I'm going to follow up every hour until this is resolved.",
];
const dupA4 = [
  "I completely understand. I've raised this as P0 incident INC-DUP-PLAT-9921. I'm connecting you to my supervisor who has the authority to commit to a same-day review. Please hold.",
  "Complaint reference CMP-DUP-20240329-441. I'm escalating directly to our Payments Resolution team — they handle high-value cases and will contact you within 2 hours. I'm truly sorry for this experience.",
  "Ticket INC-DUP-PLAT-0011 is raised at P1 priority. You'll receive a direct call from our Payments Operations team within 1 hour. I've also flagged this for an immediate fee reversal for any charges incurred during the error period.",
];

// ── FX Rate Dispute ───────────────────────────────────────────────────────────
const fxC1 = [
  "I transferred SGD 3,000 to Malaysia and the recipient only received MYR 9,800. The rate at the time of transfer was supposed to be 3.38 — but they effectively got 3.27. That's a huge discrepancy.",
  "Can you explain why the FX rate applied to my DuitNow transfer was different from the rate shown in the app at the time of initiation? I lost about SGD 90 on the conversion.",
  "I made a SGD to MYR cross-border payment and the actual exchange rate was significantly worse than what was displayed. I feel misled by the app.",
  "The exchange rate for my PayNow-to-DuitNow transfer was not what was quoted. The app showed 3.38 but the actual settlement rate was 3.29. I want a clear explanation.",
  "I'm seeing a large difference between the indicative FX rate shown before I confirmed the transfer and the actual rate that was applied. Why wasn't I locked in at the quoted rate?",
];
const fxA1 = [
  "I understand your concern. Cross-border FX rates can fluctuate between the time a quote is shown and when the transaction settles. Can you provide the transaction reference?",
  "Thank you for raising this. The exchange rate applied to cross-border PayNow transfers is based on the prevailing rate at the time of settlement, which can differ from indicative rates. Let me pull up the details.",
  "I can look into the FX rate for your transaction. Cross-border rates are subject to change — the rate shown in the app is an indicative rate, not a locked rate. Can I get the transaction ID?",
  "I understand the concern. For cross-border transfers, the exchange rate is the mid-market rate at time of settlement plus our handling margin. Can you provide the transaction reference?",
];
const fxC2 = [
  "Reference TXN-FX-4421. I initiated the transfer at 10:15 AM. The rate shown was 3.38. Settlement happened at 10:17 AM but the rate applied was 3.29. How does the rate change 9 pips in 2 minutes?",
  "TXN-FX-GOLD-7731. SGD 3,000 sent. Expected MYR 10,140 at the quoted rate. Recipient received MYR 9,870. The discrepancy is MYR 270, which is about SGD 82.",
  "PAY-FX-0041. The app showed a rate, I clicked confirm, and then the money arrived at a different rate. Is this not a breach of the terms I agreed to at confirmation?",
  "XBDR-FX-PLAT-9921. I've done this transfer many times and the rate has never been this far off. Something changed.",
];
const fxA2 = [
  "I've pulled up the transaction. The indicative rate of 3.38 was displayed as a live estimate, but our terms specify that the final rate is locked at settlement, not at initiation. There was a 2-minute window between your initiation and settlement.",
  "I can see the rate difference. The 3.29 rate applied at settlement was the live mid-market rate at T+2 minutes, plus our standard 1.5% handling margin. The 3.38 shown was the spot rate at initiation.",
  "I understand the confusion. Our current product design shows an indicative rate — it is explicitly noted as an estimate in the fine print. However, I acknowledge this is not clear enough in the UI.",
  "The discrepancy comes from the settlement window. DuitNow cross-border payments settle asynchronously, which means the rate at settlement differs from the rate at initiation. This is consistent with our published terms.",
];
const fxC3 = [
  "So you're saying you showed me a rate, I agreed to send money at that rate, and then you applied a completely different rate? That feels like a bait-and-switch. How is that legal?",
  "I understand the technical explanation but it doesn't feel right. If I'm agreeing to a transaction at 3.38, I expect to get 3.38. Is there any recourse?",
  "I've read the terms — the rate shown was labeled as 'live rate', not 'indicative'. I want this investigated as a potential mis-statement.",
  "Fine. I accept that this is your current policy. But it's terrible UX and I'm formally requesting that DBS add a rate lock feature. Can I raise that as feedback?",
];
const fxA3 = [
  "I completely understand your frustration, and I want to be honest: the current UI design is a known pain point that our product team is actively working on. I cannot offer a refund for the rate difference as it falls within our published terms, but I've logged your feedback as a formal product complaint.",
  "I hear you. The 'live rate' label is technically accurate but misleading in this context — you're right that it should say 'indicative rate'. I'm raising this as a product feedback complaint and logging the specific UI wording as an issue.",
  "Your point is valid and I want you to know it's been noted. I cannot reverse the rate differential under current policy, but I can lodge a formal complaint about the rate disclosure and flag it for our compliance team.",
  "That's very reasonable feedback and yes, I'm logging it formally. You can also submit this through our official product feedback form which goes directly to the digital banking team. I apologize for the poor experience.",
];
const fxC4 = [
  "Please log the complaint and send me the reference. And I want a follow-up confirming that the feedback was received by your product team — not just acknowledged.",
  "What's the complaint reference? And is there any gesture of goodwill DBS can offer for the confusion caused?",
  "Fine. Reference number please. I'll be watching to see if anything actually changes.",
];
const fxA4 = [
  "Complaint reference CMP-FX-7742. I've raised it to both our product team and our compliance team for the rate disclosure review. I'm truly sorry for the experience and I assure you this feedback is taken seriously.",
  "CMP-FX-GOLD-4421 has been raised. As a gesture of goodwill, I'm crediting your account with a fee waiver equivalent to the discrepancy — SGD 82. You should see it within 2 business days.",
  "Complaint reference CMP-FX-0082. I've escalated it to our product director's office for follow-up. Someone from our digital banking team will reach you within 5 business days with an update on the rate display feature.",
];

// ── Wrong Recipient ───────────────────────────────────────────────────────────
const wrongC1 = [
  "I made a terrible mistake — I sent SGD 2,800 to the wrong DuitNow number. I fat-fingered the phone number. I need to recall this transfer immediately.",
  "I accidentally transferred money to the wrong person in Malaysia. I transposed two digits in the DuitNow proxy number. Is there any way to reverse this?",
  "I sent SGD 4,500 to the wrong DuitNow recipient by mistake. The transaction went through. I need to get that money back NOW. Please help.",
  "Critical issue: I made a PayNow transfer to an incorrect DuitNow number. I realized immediately after confirming. Is there a recall mechanism?",
  "I entered the wrong recipient for my cross-border DuitNow payment. The funds have been sent. I haven't been able to reach the recipient. What are my options?",
];
const wrongA1 = [
  "I understand the urgency. Wrong-recipient transfers are taken very seriously. To initiate a recall, I'll need the transaction reference, the intended recipient's details, and the actual recipient's details you sent to.",
  "Thank you for contacting us immediately — the sooner we act, the better the outcome. Can you provide the transaction ID and both the intended and actual DuitNow proxy numbers?",
  "I'll do my best to help. Wrong recipient recalls for cross-border payments involve DuitNow's cooperation. Can I get the transaction reference first?",
  "This is an urgent matter. I'm starting a recall request immediately. What's the transaction reference and the DuitNow proxy number you accidentally sent to?",
];
const wrongC2 = [
  "Transaction TXN-WRONG-8821. Intended: +60-11-2345-6789. Sent to: +60-11-2345-6798. SGD 2,800. I noticed about 3 minutes after confirming.",
  "Reference PAY-WR-4421. Intended recipient email is supplier@company.com. I accidentally entered supplier@company.co instead. SGD 4,500. How quickly can you reverse this?",
  "XBDR-WR-20240329-771. Sent to the wrong DuitNow number. I don't know who I sent it to. The transaction completed in 30 seconds — can it be reversed?",
  "TXN-GOLD-WR-0041. I sent SGD 3,300 to +60-12-XXX-9981 instead of +60-12-XXX-9891. I need this back — it was a one-digit mistake.",
];
const wrongA2 = [
  "I've located the transaction. I have to be honest with you: cross-border DuitNow recalls depend on the recipient's cooperation — we cannot unilaterally reverse a completed payment once DuitNow has processed it. I'm initiating a recall request, but I cannot guarantee its success.",
  "I can see the transaction. Unfortunately, once the payment clears DuitNow, the funds are in the recipient's account and we cannot force a reversal without their consent. I'm filing an urgent recall request with PayNet Malaysia now.",
  "I understand the urgency. The transaction has already settled on DuitNow's side. Our recall process requires us to contact the recipient's bank, which then contacts the account holder. This can take 3–7 business days.",
  "The transaction settled quickly because the DuitNow number was valid and active. I'm raising a formal payment recall with MAS and BNM inter-bank protocols. This is the official process, but I can't guarantee a timeline.",
];
const wrongC3 = [
  "3–7 business days is absolutely unacceptable. That person could spend my money by then. What happens if they refuse to return it?",
  "So you're telling me that because I made a one-digit mistake, I might lose SGD 4,500 permanently? That can't be right.",
  "I need you to escalate this to the highest level possible. This is not a dispute — it was a clear error and the money legally belongs to me.",
  "Is there any way to freeze the recipient's account? Can you contact PayNet Malaysia directly right now to halt the transaction?",
];
const wrongA3 = [
  "I completely understand your distress. Under MAS guidelines, if the recipient refuses to return the funds, DBS can escalate to civil recovery proceedings. However, the timeline for this depends on Malaysian regulatory processes.",
  "I hear you. I've flagged this as an urgent case. DBS will contact the receiving bank (via PayNet Malaysia) and formally request the recipient to return the funds. We'll also notify you of any response.",
  "I cannot freeze a DuitNow account from our end — that would require Malaysian regulatory authority. What I can do is file an urgent inter-bank recall at the highest priority level, which puts formal legal obligation on the recipient.",
  "You're absolutely right that this is a legally recoverable payment. The challenge is that cross-border recovery involves both Singapore and Malaysian banking regulators. I'm initiating the formal process immediately.",
];
const wrongC4 = [
  "Please do whatever you can. What's the ticket reference and what is the realistic timeline for me to expect a response?",
  "I'm going to file a police report as well. I understand that might help the case. Can you give me everything in writing?",
  "I accept that this will take time. But I need a formal acknowledgment from DBS that a recall was initiated. For my own records.",
];
const wrongA4 = [
  "I completely understand. Recall reference: RECALL-WR-20240329-8821. The inter-bank recall has been filed with PayNet Malaysia. Realistically, you'll have an initial response within 5–7 business days. I'm so sorry this happened.",
  "Formal recall reference RECALL-WR-4421 has been filed. A formal acknowledgment letter will be sent to your registered email within 1 business day. Filing a police report is strongly advisable — it significantly strengthens the recall case.",
  "Recall reference RECALL-WR-0041. I'm sending a formal acknowledgment to your registered email right now. I truly wish I could give you a faster resolution — the cross-border recovery process is genuinely constrained by bilateral banking agreements.",
];

// ─── Dialogue pool map ────────────────────────────────────────────────────────
type DialoguePool = {
  c1: string[]; a1: string[];
  c2: string[]; a2: string[];
  c3: string[]; a3: string[];
  c4: string[]; a4: string[];
};

const POOLS: Record<string, DialoguePool> = {
  'Timeout Loop':     { c1: timeoutC1, a1: timeoutA1, c2: timeoutC2, a2: timeoutA2, c3: timeoutC3, a3: timeoutA3, c4: timeoutC4, a4: timeoutA4 },
  'Auth Rejected':    { c1: authC1,    a1: authA1,    c2: authC2,    a2: authA2,    c3: authC3,    a3: authA3,    c4: authC4,    a4: authA4    },
  'Silent Drop':      { c1: silentC1,  a1: silentA1,  c2: silentC2,  a2: silentA2,  c3: silentC3,  a3: silentA3,  c4: silentC4,  a4: silentA4  },
  'Partial Process':  { c1: partialC1, a1: partialA1, c2: partialC2, a2: partialA2, c3: partialC3, a3: partialA3, c4: partialC4, a4: partialA4 },
  'Network Flap':     { c1: netC1,     a1: netA1,     c2: netC2,     a2: netA2,     c3: netC3,     a3: netA3,     c4: netC4,     a4: netA4     },
  'Duplicate Charge': { c1: dupC1,     a1: dupA1,     c2: dupC2,     a2: dupA2,     c3: dupC3,     a3: dupA3,     c4: dupC4,     a4: dupA4     },
  'FX Rate Dispute':  { c1: fxC1,      a1: fxA1,      c2: fxC2,      a2: fxA2,      c3: fxC3,      a3: fxA3,      c4: fxC4,      a4: fxA4      },
  'Wrong Recipient':  { c1: wrongC1,   a1: wrongA1,   c2: wrongC2,   a2: wrongA2,   c3: wrongC3,   a3: wrongA3,   c4: wrongC4,   a4: wrongA4   },
};

// ─── Error severity map ───────────────────────────────────────────────────────
const errorSeverity: Record<number, number> = { 402: 0.5, 408: 0.6, 500: 0.7, 503: 0.8, 504: 1.0 };

function computeFrictionScore(latencyMs: number, retryCount: number, statusCode: number, nps: number): number {
  const latencyNorm = Math.min(latencyMs / 12000, 1);
  const retryNorm = retryCount / 4;
  const severity = errorSeverity[statusCode] ?? 0.5;
  const npsNeg = nps <= -2 ? 1 : nps === -1 ? 0.7 : nps === 0 ? 0.4 : nps === 1 ? 0.1 : 0;
  return Math.min(latencyNorm * 0.35 + retryNorm * 0.25 + severity * 0.25 + npsNeg * 0.15, 1);
}

function generateSessionId(): string {
  const hex = () => Math.floor(rand() * 0xFFFF).toString(16).padStart(4, '0');
  return `${hex()}-${hex()}-${hex()}-${hex()}`;
}

function generateTimestamp(): string {
  const base = new Date('2024-03-29T08:00:00Z').getTime();
  const offset = Math.floor(rand() * 86400000);
  return new Date(base + offset).toISOString();
}

export function generateLogs(): FrictionLog[] {
  const logs: FrictionLog[] = [];
  let idx = 1;

  for (const archetype of ARCHETYPES) {
    const pool = POOLS[archetype.name] ?? POOLS['Timeout Loop'];

    for (let i = 0; i < archetype.count; i++) {
      const tier = pick(archetype.tiers);
      const statusCode = pick(archetype.errorCodes);
      const latencyMs = randInt(...archetype.latencyRange);
      const retryCount = randInt(...archetype.retryRange);
      const nps = randInt(...archetype.npsRange);
      const tenureMonths = tier === 'Platinum' ? randInt(36, 120) : randInt(6, 60);
      const creditScore = tier === 'Platinum' ? randInt(700, 820) : randInt(580, 750);

      const dialogue: DialogueTurn[] = [
        { role: 'customer', text: pick(pool.c1) },
        { role: 'agent',    text: pick(pool.a1), latencyMs: randInt(1200, 3000) },
        { role: 'customer', text: pick(pool.c2) },
        { role: 'agent',    text: pick(pool.a2), latencyMs: randInt(2000, 5000) },
        { role: 'customer', text: pick(pool.c3) },
        { role: 'agent',    text: pick(pool.a3), latencyMs: randInt(1500, 4000) },
        { role: 'customer', text: pick(pool.c4) },
        { role: 'agent',    text: pick(pool.a4), latencyMs: randInt(1000, 2500) },
      ];

      logs.push({
        id: `LOG-${String(idx).padStart(3, '0')}`,
        userMetadata: { tier, tenureMonths, creditScore, nps },
        systemContext: {
          apiStatusCode: statusCode,
          latencyMs,
          retryCount,
          sessionId: generateSessionId(),
          timestamp: generateTimestamp(),
        },
        dialogue,
        frictionScore: computeFrictionScore(latencyMs, retryCount, statusCode, nps),
        archetype: archetype.name,
      });
      idx++;
    }
  }

  return logs;
}
