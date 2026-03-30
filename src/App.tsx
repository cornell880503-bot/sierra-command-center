import { useEffect, useRef } from 'react';
import { getLogsForMode } from './data/logs';
import { runObserverAgent } from './engine/observerAgent';
import { runAnalystAgent, runAnalystAgentAI } from './engine/analystAgent';
import { runStrategistAgent, runStrategistAgentAI } from './engine/strategistAgent';
import { runArchitectAgent, runArchitectAgentAI } from './engine/architectAgent';
import { useAppStore } from './store/useAppStore';
import type { ImportResult, GeminiCallRecord } from './store/useAppStore';
import { GEMINI_MODEL } from './lib/aiClient';
import type { GeminiCallMeta } from './lib/aiClient';
import type { IntelligencePipeline, ChangeRequestPackage, FrictionLog, FrictionCluster } from './types';
import type { AppMode } from './types';

import { Header } from './components/layout/Header';
import { StatusBar } from './components/layout/StatusBar';
import { ImpactBanner } from './components/layout/ImpactBanner';
import { ClusterPanel } from './components/clusters/ClusterPanel';
import { FrictionHeatmap } from './components/heatmap/FrictionHeatmap';
import { LogDrawer } from './components/logs/LogDrawer';
import { ArchitectView } from './components/architect/ArchitectView';

// ─── Pipeline helpers ─────────────────────────────────────────────────────────
function clusterHasImportedLog(cluster: FrictionCluster, importedLogIds: Set<string>): boolean {
  return cluster.logIds.some(id => importedLogIds.has(id));
}

function makeCallRecord(
  agent: GeminiCallRecord['agent'],
  meta: GeminiCallMeta | null,
): GeminiCallRecord {
  return meta
    ? { agent, ...meta, status: 'success' }
    : { agent, model: GEMINI_MODEL, inputChars: 0, outputChars: 0, tookMs: 0, status: 'fallback' };
}

async function runPipelineForCluster(
  cluster: FrictionCluster,
  allLogs: FrictionLog[],
  importedLogIds: Set<string>,
  appMode: AppMode,
): Promise<{
  pipeline: IntelligencePipeline;
  cr: ChangeRequestPackage;
  geminiCalls: GeminiCallRecord[];
}> {
  const isImported = clusterHasImportedLog(cluster, importedLogIds);
  const geminiCalls: GeminiCallRecord[] = [];
  const t0 = performance.now();

  let insightCard, recommendation;

  if (isImported) {
    // Analyst
    const analystResult = await runAnalystAgentAI(cluster, allLogs, appMode);
    insightCard = analystResult.insightCard;
    geminiCalls.push(makeCallRecord('Analyst', analystResult.meta));

    // Strategist
    const strategistResult = await runStrategistAgentAI(cluster, allLogs, insightCard, appMode);
    recommendation = strategistResult.recommendation;
    geminiCalls.push(makeCallRecord('Strategist', strategistResult.meta));
  } else {
    insightCard = runAnalystAgent(cluster, allLogs, appMode);
    recommendation = runStrategistAgent(cluster, allLogs, insightCard, appMode);
  }

  const thinkingMs = Math.round(performance.now() - t0);
  const pipeline: IntelligencePipeline = { clusterId: cluster.id, insightCard, recommendation, thinkingMs };

  let cr: ChangeRequestPackage;
  if (isImported) {
    const archResult = await runArchitectAgentAI(recommendation, insightCard, appMode);
    cr = archResult.cr;
    geminiCalls.push(makeCallRecord('Architect', archResult.meta));
  } else {
    cr = runArchitectAgent(recommendation, insightCard, appMode);
  }

  return { pipeline, cr, geminiCalls };
}

export default function App() {
  const setData = useAppStore(s => s.setData);
  const setPipelines = useAppStore(s => s.setPipelines);
  const setChangeRequests = useAppStore(s => s.setChangeRequests);
  const setThinking = useAppStore(s => s.setThinking);
  const setAiPipelineStatus = useAppStore(s => s.setAiPipelineStatus);
  const setImportResult = useAppStore(s => s.setImportResult);
  const logs = useAppStore(s => s.logs);
  const importedLogIds = useAppStore(s => s.importedLogIds);
  const appMode = useAppStore(s => s.appMode);
  const prevMode = useRef<AppMode | null>(null);

  // ── Initial load: deterministic pipeline for base logs ──────────────────────
  useEffect(() => {
    if (prevMode.current === appMode) return;
    prevMode.current = appMode;

    const baseLogs = getLogsForMode(appMode);
    const clusters = runObserverAgent(baseLogs, 4, appMode);
    setData(baseLogs, clusters);

    const pipelines: Record<string, IntelligencePipeline> = {};
    const changeRequests: Record<string, ChangeRequestPackage> = {};

    const runNext = (i: number) => {
      if (i >= clusters.length) {
        setThinking(null);
        setPipelines(pipelines);
        setTimeout(() => {
          clusters.forEach(cluster => {
            const p = pipelines[cluster.id];
            if (p) changeRequests[cluster.id] = runArchitectAgent(p.recommendation, p.insightCard, appMode);
          });
          setChangeRequests({ ...changeRequests });
        }, 400);
        return;
      }

      const cluster = clusters[i];
      setThinking(cluster.id);

      setTimeout(() => {
        const t0 = performance.now();
        const insightCard = runAnalystAgent(cluster, baseLogs, appMode);
        const recommendation = runStrategistAgent(cluster, baseLogs, insightCard, appMode);
        const thinkingMs = Math.round(performance.now() - t0);

        pipelines[cluster.id] = { clusterId: cluster.id, insightCard, recommendation, thinkingMs };
        setPipelines({ ...pipelines });
        runNext(i + 1);
      }, 480 + i * 120);
    };

    setTimeout(() => runNext(0), 600);
  }, [appMode, setData, setPipelines, setChangeRequests, setThinking, setAiPipelineStatus, setImportResult]);

  // ── Re-run pipeline when new logs are imported ───────────────────────────────
  const prevLogCount = useRef(0);
  useEffect(() => {
    if (logs.length <= prevLogCount.current) return;

    // Capture which logs are newly imported
    const newlyAddedLogs = logs.slice(prevLogCount.current);
    prevLogCount.current = logs.length;

    // Snapshot previous annual loss per cluster BEFORE re-clustering
    const prevPipelines = useAppStore.getState().pipelines;
    const prevLossMap: Record<string, number> = {};
    Object.entries(prevPipelines).forEach(([cid, p]) => {
      prevLossMap[cid] = p.recommendation.valueProjection.annualLossSGD;
    });
    const prevClusterIds = new Set(Object.keys(prevPipelines));

    // Re-cluster with full log set
    const clusters = runObserverAgent(logs, 4, appMode);
    setData(logs, clusters);

    const importedClusters = clusters.filter(c => clusterHasImportedLog(c, importedLogIds));
    if (importedClusters.length === 0) return;

    const currentPipelines = useAppStore.getState().pipelines;
    const currentCRs = useAppStore.getState().changeRequests;
    const accPipelines: Record<string, IntelligencePipeline> = { ...currentPipelines };
    const accCRs: Record<string, ChangeRequestPackage> = { ...currentCRs };

    (async () => {
      for (const cluster of importedClusters) {
        setAiPipelineStatus(cluster.id, 'loading');
        setThinking(cluster.id);
        try {
          const { pipeline, cr, geminiCalls } = await runPipelineForCluster(cluster, logs, importedLogIds, appMode);
          accPipelines[cluster.id] = pipeline;
          accCRs[cluster.id] = cr;
          setPipelines({ ...accPipelines });
          setChangeRequests({ ...accCRs });
          setAiPipelineStatus(cluster.id, 'done');

          // Build ImportResult for each newly imported log placed in this cluster
          const isNewCluster = !prevClusterIds.has(cluster.id);
          const prevLoss = prevLossMap[cluster.id] ?? 0;
          const newLoss = pipeline.recommendation.valueProjection.annualLossSGD;

          for (const newLog of newlyAddedLogs) {
            if (cluster.logIds.includes(newLog.id)) {
              const result: ImportResult = {
                logId: newLog.id,
                clusterId: cluster.id,
                clusterLabel: cluster.label,
                isNewCluster,
                prevAnnualLossSGD: prevLoss,
                newAnnualLossSGD: newLoss,
                primaryIssue: pipeline.insightCard.primaryIssue,
                technicalDebtLevel: pipeline.insightCard.technicalDebtLevel,
                priority: pipeline.recommendation.priority,
                geminiCalls,
                agentReasoning: {
                  analyst: pipeline.insightCard.reasoning,
                  strategist: pipeline.recommendation.reasoning,
                  architect: cr.reasoning,
                },
              };
              setImportResult(newLog.id, result);
            }
          }
        } catch {
          setAiPipelineStatus(cluster.id, 'error');
        }
      }

      setThinking(null);
    })();
  }, [logs, importedLogIds, appMode, setData, setPipelines, setChangeRequests, setThinking, setAiPipelineStatus, setImportResult]);

  return (
    <div style={{
      height: '100vh', display: 'flex', flexDirection: 'column',
      background: 'var(--color-bg, #f6f5f3)', overflow: 'hidden',
    }}>
      <Header />
      <ImpactBanner />

      <div style={{ flex: 1, display: 'flex', overflow: 'hidden' }}>
        <ClusterPanel />
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'auto', minWidth: 0 }}>
          <FrictionHeatmap />
        </div>
      </div>

      <StatusBar />
      <LogDrawer />
      <ArchitectView />
    </div>
  );
}
