export type CustomerTier = 'Platinum' | 'Gold';

export type ApiStatusCode = 402 | 408 | 500 | 503 | 504;

export interface UserMetadata {
  tier: CustomerTier;
  tenureMonths: number;
  creditScore: number;
  nps: number; // -2 to 2
}

export interface SystemContext {
  apiStatusCode: ApiStatusCode;
  latencyMs: number;
  retryCount: number;
  sessionId: string;
  timestamp: string;
}

export interface DialogueTurn {
  role: 'customer' | 'agent';
  text: string;
  latencyMs?: number;
}

export interface FrictionLog {
  id: string;
  userMetadata: UserMetadata;
  systemContext: SystemContext;
  dialogue: DialogueTurn[];
  frictionScore: number;
  archetype: string;
}

export interface FrictionCluster {
  id: string;
  label: string;
  coreSentiment: string;
  businessFrequency: number;
  logIds: string[];
  dominantErrorCode: ApiStatusCode;
  avgFrictionScore: number;
  avgLatencyMs: number;
  avgCreditScore: number;
  tierBreakdown: { Platinum: number; Gold: number };
  color: string;
}

// ─── Layer 2: Intelligence & Strategy ────────────────────────────────────────

export type TechnicalDebtLevel = 'Critical' | 'High' | 'Medium' | 'Low';
export type Priority = 'P0' | 'P1' | 'P2' | 'P3';

export interface InsightCard {
  clusterId: string;
  primaryIssue: string;
  affectedSubsystem: string;
  technicalDebtLevel: TechnicalDebtLevel;
  rootCauseDetail: string;
  affectedApiPath: string;
  remediationTimeEst: string;
  engineeringOwner: string;
}

export interface ValueProjection {
  avgTransactionValueSGD: number;
  clusterFrequencyPerMonth: number;
  tierMultiplier: number;
  monthlyLossSGD: number;
  annualLossSGD: number;
  platformAtRiskPct: number;
}

export interface StrategicRecommendation {
  clusterId: string;
  title: string;
  rationale: string;
  action: string;
  priorityScore: number;
  priority: Priority;
  businessImpact: number;
  userFrustration: number;
  valueProjection: ValueProjection;
  quickWins: string[];
  longTermFix: string;
}

export interface IntelligencePipeline {
  clusterId: string;
  insightCard: InsightCard;
  recommendation: StrategicRecommendation;
  thinkingMs: number;
}

// ─── Layer 3: Architect & Governance ─────────────────────────────────────────

export interface PolicyDiffLine {
  type: 'context' | 'add' | 'remove' | 'header' | 'meta';
  content: string;
}

export interface ContextInjection {
  trigger: string;
  condition: string;
  instruction: string;
  tone: string;
  example: string;
}

export interface ChangeRequestPackage {
  clusterId: string;
  id: string;
  title: string;
  policyDiff: PolicyDiffLine[];
  contextInjections: ContextInjection[];
  estimatedRoiPct: number;
  affectedPolicyFile: string;
  governanceNotes: string;
  generatedAt: string;
}

export type SyncPhase =
  | 'idle'
  | 'validating'
  | 'deploying'
  | 'success'
  | 'error';

export interface SyncState {
  clusterId: string;
  phase: SyncPhase;
  terminalLines: string[];
  roiMessage: string;
}
