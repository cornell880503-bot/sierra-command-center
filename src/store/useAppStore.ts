import { create } from 'zustand';
import type {
  FrictionLog, FrictionCluster, IntelligencePipeline,
  ChangeRequestPackage, SyncState,
} from '../types';

export type AiPipelineStatus = 'idle' | 'loading' | 'done' | 'error';

// ─── Import result — surfaced back to the Import modal after AI pipeline ──────
export interface GeminiCallRecord {
  agent: 'Analyst' | 'Strategist' | 'Architect';
  model: string;
  inputChars: number;
  outputChars: number;
  tookMs: number;
  status: 'success' | 'fallback';
}

export interface ImportResult {
  logId: string;
  clusterId: string;
  clusterLabel: string;
  isNewCluster: boolean;
  prevAnnualLossSGD: number;
  newAnnualLossSGD: number;
  primaryIssue: string;
  technicalDebtLevel: string;
  priority: string;
  geminiCalls: GeminiCallRecord[];
  agentReasoning: {
    analyst?: string;
    strategist?: string;
    architect?: string;
  };
}

interface AppState {
  logs: FrictionLog[];
  clusters: FrictionCluster[];
  pipelines: Record<string, IntelligencePipeline>;
  changeRequests: Record<string, ChangeRequestPackage>;
  syncStates: Record<string, SyncState>;
  activeArchitectClusterId: string | null;
  selectedClusterId: string | null;
  activeLogId: string | null;
  drawerOpen: boolean;
  thinkingClusterId: string | null;

  // Import feature
  importModalOpen: boolean;
  importedLogIds: Set<string>;
  aiPipelineStatus: Record<string, AiPipelineStatus>;
  importResults: Record<string, ImportResult>; // keyed by logId

  setData: (logs: FrictionLog[], clusters: FrictionCluster[]) => void;
  setPipelines: (pipelines: Record<string, IntelligencePipeline>) => void;
  setChangeRequests: (crs: Record<string, ChangeRequestPackage>) => void;
  setSyncState: (clusterId: string, state: SyncState) => void;
  openArchitectView: (clusterId: string) => void;
  closeArchitectView: () => void;
  selectCluster: (id: string | null) => void;
  openLog: (id: string) => void;
  closeDrawer: () => void;
  setThinking: (id: string | null) => void;

  // Import actions
  setImportModalOpen: (open: boolean) => void;
  addImportedLog: (log: FrictionLog) => void;
  setAiPipelineStatus: (clusterId: string, status: AiPipelineStatus) => void;
  setImportResult: (logId: string, result: ImportResult) => void;
}

export const useAppStore = create<AppState>((set) => ({
  logs: [],
  clusters: [],
  pipelines: {},
  changeRequests: {},
  syncStates: {},
  activeArchitectClusterId: null,
  selectedClusterId: null,
  activeLogId: null,
  drawerOpen: false,
  thinkingClusterId: null,

  importModalOpen: false,
  importedLogIds: new Set<string>(),
  aiPipelineStatus: {},
  importResults: {},

  setData: (logs, clusters) => set({ logs, clusters }),
  setPipelines: (pipelines) => set({ pipelines }),
  setChangeRequests: (changeRequests) => set({ changeRequests }),
  setSyncState: (clusterId, state) =>
    set(s => ({ syncStates: { ...s.syncStates, [clusterId]: state } })),
  openArchitectView: (clusterId) => set({ activeArchitectClusterId: clusterId }),
  closeArchitectView: () => set({ activeArchitectClusterId: null }),
  selectCluster: (id) => set((s) => ({
    selectedClusterId: s.selectedClusterId === id ? null : id,
  })),
  openLog: (id) => set({ activeLogId: id, drawerOpen: true }),
  closeDrawer: () => set({ drawerOpen: false, activeLogId: null }),
  setThinking: (id) => set({ thinkingClusterId: id }),

  setImportModalOpen: (open) => set({ importModalOpen: open }),
  addImportedLog: (log) => set(s => ({
    logs: [...s.logs, log],
    importedLogIds: new Set([...s.importedLogIds, log.id]),
  })),
  setAiPipelineStatus: (clusterId, status) =>
    set(s => ({ aiPipelineStatus: { ...s.aiPipelineStatus, [clusterId]: status } })),
  setImportResult: (logId, result) =>
    set(s => ({ importResults: { ...s.importResults, [logId]: result } })),
}));
