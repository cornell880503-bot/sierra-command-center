import ReactDOM from 'react-dom';
import { useAppStore } from '../../store/useAppStore';
import type { FrictionLog, FrictionCluster, IntelligencePipeline } from '../../types';

const DEBT_COLOR: Record<string, string> = {
  Critical: '#dc2626', High: '#f97316', Medium: '#ca8a04', Low: '#16a34a',
};
const PRIORITY_COLOR: Record<string, string> = {
  P0: '#dc2626', P1: '#f97316', P2: '#ca8a04', P3: '#6b7280',
};

export function LogDrawer() {
  const logs = useAppStore(s => s.logs);
  const activeLogId = useAppStore(s => s.activeLogId);
  const drawerOpen = useAppStore(s => s.drawerOpen);
  const closeDrawer = useAppStore(s => s.closeDrawer);
  const clusters = useAppStore(s => s.clusters);
  const pipelines = useAppStore(s => s.pipelines);

  const log = logs.find(l => l.id === activeLogId) ?? null;
  const cluster = log ? clusters.find(c => c.logIds.includes(log.id)) : undefined;
  const pipeline = cluster ? pipelines[cluster.id] : undefined;

  if (!drawerOpen || !log) return null;

  return ReactDOM.createPortal(
    <>
      <div
        style={{
          position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.25)',
          zIndex: 200, animation: 'fadeIn 0.2s ease', backdropFilter: 'blur(2px)',
        }}
        onClick={closeDrawer}
      />
      <div style={{
        position: 'fixed', top: 0, right: 0, bottom: 0, width: '520px',
        background: '#ffffff', borderLeft: '1px solid #e5e7eb',
        zIndex: 201, display: 'flex', flexDirection: 'column',
        animation: 'slideInRight 0.22s ease', overflowY: 'auto',
        boxShadow: '-8px 0 24px rgba(0,0,0,0.08)',
      }}>
        <DrawerContent log={log} cluster={cluster} pipeline={pipeline} onClose={closeDrawer} />
      </div>
    </>,
    document.body,
  );
}

function DrawerContent({ log, cluster, pipeline, onClose }: {
  log: FrictionLog; cluster: FrictionCluster | undefined;
  pipeline: IntelligencePipeline | undefined; onClose: () => void;
}) {
  const tierColor = log.userMetadata.tier === 'Platinum' ? '#7c3aed' : '#b45309';

  return (
    <>
      {/* Header */}
      <div style={{
        padding: '16px 20px', borderBottom: '1px solid #f3f4f6', flexShrink: 0,
        display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between',
        background: '#fafafa',
      }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap', marginBottom: '3px' }}>
            <span style={{ fontFamily: 'var(--font-mono)', fontSize: '14px', fontWeight: 700, color: '#111827' }}>
              {log.id}
            </span>
            {cluster && (
              <span style={{
                fontFamily: 'var(--font-mono)', fontSize: '10px',
                padding: '2px 8px', borderRadius: '20px',
                background: `${cluster.color}12`, border: `1px solid ${cluster.color}30`, color: cluster.color,
              }}>
                {cluster.label}
              </span>
            )}
            {pipeline && (
              <span style={{
                fontFamily: 'var(--font-mono)', fontSize: '10px', fontWeight: 700,
                padding: '2px 8px', borderRadius: '4px',
                background: `${PRIORITY_COLOR[pipeline.recommendation.priority]}10`,
                border: `1px solid ${PRIORITY_COLOR[pipeline.recommendation.priority]}25`,
                color: PRIORITY_COLOR[pipeline.recommendation.priority],
              }}>
                {pipeline.recommendation.priority}
              </span>
            )}
          </div>
          <div style={{ fontFamily: 'var(--font-mono)', fontSize: '10px', color: '#9ca3af' }}>
            {new Date(log.systemContext.timestamp).toLocaleString('en-SG', { timeZone: 'Asia/Singapore' })} SGT
          </div>
        </div>
        <button
          onClick={onClose}
          style={{
            background: 'none', border: '1px solid #e5e7eb', borderRadius: '5px',
            color: '#6b7280', cursor: 'pointer', padding: '4px 10px',
            fontFamily: 'var(--font-mono)', fontSize: '11px', transition: 'all 0.12s',
          }}
          onMouseOver={e => {
            (e.currentTarget as HTMLElement).style.borderColor = '#d1d5db';
            (e.currentTarget as HTMLElement).style.color = '#374151';
          }}
          onMouseOut={e => {
            (e.currentTarget as HTMLElement).style.borderColor = '#e5e7eb';
            (e.currentTarget as HTMLElement).style.color = '#6b7280';
          }}
        >
          esc
        </button>
      </div>

      <div style={{ padding: '18px 20px', display: 'flex', flexDirection: 'column', gap: '18px' }}>

        {/* Metadata */}
        <Section title="Context">
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '6px' }}>
            <Meta label="Tier" value={log.userMetadata.tier} valueColor={tierColor} />
            <Meta label="Tenure" value={`${log.userMetadata.tenureMonths}mo`} />
            <Meta label="Credit Score" value={String(log.userMetadata.creditScore)} />
            <Meta label="NPS"
              value={`${log.userMetadata.nps > 0 ? '+' : ''}${log.userMetadata.nps}`}
              valueColor={log.userMetadata.nps < 0 ? '#dc2626' : log.userMetadata.nps > 0 ? '#16a34a' : '#6b7280'} />
            <Meta label="HTTP Status" value={String(log.systemContext.apiStatusCode)} valueColor="#dc2626" />
            <Meta label="Latency" value={`${log.systemContext.latencyMs.toLocaleString()}ms`} valueColor="#ca8a04" />
            <Meta label="Retries" value={String(log.systemContext.retryCount)} />
            <Meta label="Archetype" value={log.archetype} />
            <Meta label="Friction" value={log.frictionScore.toFixed(4)} valueColor="#f97316" />
            <Meta label="Session" value={log.systemContext.sessionId} mono valueColor="#6b7280" style={{ gridColumn: 'span 2' }} />
          </div>
        </Section>

        {/* Friction bar */}
        <div>
          <div style={{
            display: 'flex', justifyContent: 'space-between', marginBottom: '5px',
            fontFamily: 'var(--font-mono)', fontSize: '9px', color: '#9ca3af',
          }}>
            <span>FRICTION INTENSITY</span>
            <span style={{ color: '#f97316' }}>{log.frictionScore.toFixed(4)}</span>
          </div>
          <div style={{ height: '3px', borderRadius: '2px', background: '#f3f4f6' }}>
            <div style={{
              height: '100%', borderRadius: '2px',
              width: `${log.frictionScore * 100}%`,
              background: 'linear-gradient(to right, #fbbf24, #f97316, #dc2626)',
              transition: 'width 0.4s ease',
            }} />
          </div>
        </div>

        {/* Intelligence summary */}
        {pipeline && (
          <Section title="Intelligence Summary">
            <div style={{ display: 'flex', flexDirection: 'column', gap: '7px' }}>
              <div style={{
                background: '#fafafa',
                border: '1px solid #f3f4f6',
                borderLeft: `2px solid ${DEBT_COLOR[pipeline.insightCard.technicalDebtLevel] ?? '#6b7280'}`,
                borderRadius: '0 6px 6px 0', padding: '9px 12px',
              }}>
                <div style={{
                  fontFamily: 'var(--font-mono)', fontSize: '9px',
                  color: DEBT_COLOR[pipeline.insightCard.technicalDebtLevel] ?? '#6b7280',
                  textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: '3px',
                }}>
                  {pipeline.insightCard.technicalDebtLevel} debt
                </div>
                <div style={{ fontFamily: 'var(--font-sans)', fontSize: '12px', fontWeight: 600, color: '#111827', lineHeight: '1.4' }}>
                  {pipeline.insightCard.primaryIssue}
                </div>
              </div>
              <div style={{
                background: '#f0fdf4', border: '1px solid #bbf7d0',
                borderLeft: '2px solid #00a86b',
                borderRadius: '0 6px 6px 0', padding: '9px 12px',
              }}>
                <div style={{ fontFamily: 'var(--font-mono)', fontSize: '9px', color: '#00a86b', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: '3px' }}>
                  Recommendation · {pipeline.recommendation.priority}
                </div>
                <div style={{ fontFamily: 'var(--font-sans)', fontSize: '12px', fontWeight: 600, color: '#111827', lineHeight: '1.4' }}>
                  {pipeline.recommendation.title}
                </div>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '6px' }}>
                <LossCell label="Monthly Loss" value={`SGD ${pipeline.recommendation.valueProjection.monthlyLossSGD.toLocaleString()}`} color="#dc2626" />
                <LossCell
                  label="Annual Exposure"
                  value={pipeline.recommendation.valueProjection.annualLossSGD >= 1_000_000
                    ? `SGD ${(pipeline.recommendation.valueProjection.annualLossSGD / 1_000_000).toFixed(2)}M`
                    : `SGD ${pipeline.recommendation.valueProjection.annualLossSGD.toLocaleString()}`}
                  color="#f97316"
                />
              </div>
            </div>
          </Section>
        )}

        {/* Dialogue */}
        <Section title="Transcript">
          <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
            {log.dialogue.map((turn, i) => (
              <div key={i} style={{
                display: 'flex',
                flexDirection: turn.role === 'customer' ? 'row-reverse' : 'row',
                gap: '9px', alignItems: 'flex-start',
              }}>
                <div style={{
                  width: '26px', height: '26px', borderRadius: '50%',
                  background: turn.role === 'customer' ? '#eff6ff' : '#f0fdf4',
                  border: `1px solid ${turn.role === 'customer' ? '#bfdbfe' : '#bbf7d0'}`,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  fontFamily: 'var(--font-mono)', fontSize: '8px', fontWeight: 700,
                  color: turn.role === 'customer' ? '#1d4ed8' : '#16a34a', flexShrink: 0,
                }}>
                  {turn.role === 'customer' ? 'CX' : 'AG'}
                </div>
                <div style={{ maxWidth: '82%' }}>
                  <div style={{
                    display: 'flex', alignItems: 'center', gap: '7px', marginBottom: '4px',
                    flexDirection: turn.role === 'customer' ? 'row-reverse' : 'row',
                  }}>
                    <span style={{
                      fontFamily: 'var(--font-mono)', fontSize: '9px',
                      color: turn.role === 'customer' ? '#1d4ed8' : '#16a34a',
                      textTransform: 'uppercase', letterSpacing: '0.05em',
                    }}>
                      {turn.role === 'customer' ? 'Customer' : 'Agent'}
                    </span>
                    {turn.latencyMs && (
                      <span style={{
                        fontFamily: 'var(--font-mono)', fontSize: '9px', color: '#9ca3af',
                        background: '#f9fafb', border: '1px solid #e5e7eb',
                        padding: '0 4px', borderRadius: '3px',
                      }}>
                        {turn.latencyMs.toLocaleString()}ms
                      </span>
                    )}
                  </div>
                  <div style={{
                    background: turn.role === 'customer' ? '#eff6ff' : '#f9fafb',
                    border: `1px solid ${turn.role === 'customer' ? '#dbeafe' : '#f3f4f6'}`,
                    borderRadius: turn.role === 'customer' ? '10px 2px 10px 10px' : '2px 10px 10px 10px',
                    padding: '9px 12px',
                    fontFamily: 'var(--font-sans)', fontSize: '12px',
                    color: '#374151', lineHeight: '1.55',
                  }}>
                    {turn.text}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </Section>

        {/* Unresolved flag */}
        <div style={{
          padding: '9px 12px', background: '#fef2f2',
          border: '1px solid #fecaca', borderRadius: '6px',
          display: 'flex', alignItems: 'center', gap: '8px',
        }}>
          <div style={{ width: '5px', height: '5px', borderRadius: '50%', background: '#dc2626', flexShrink: 0 }} />
          <span style={{ fontFamily: 'var(--font-mono)', fontSize: '10px', color: '#dc2626' }}>
            UNRESOLVED — Agent failed to confirm fund status or provide resolution window
          </span>
        </div>
      </div>
    </>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <div style={{
        fontFamily: 'var(--font-mono)', fontSize: '9px', color: '#9ca3af',
        textTransform: 'uppercase', letterSpacing: '0.1em',
        marginBottom: '9px', paddingBottom: '5px', borderBottom: '1px solid #f3f4f6',
      }}>{title}</div>
      {children}
    </div>
  );
}

function Meta({ label, value, valueColor = '#111827', mono = false, style: extra }: {
  label: string; value: string; valueColor?: string; mono?: boolean; style?: React.CSSProperties;
}) {
  return (
    <div style={{ background: '#f9fafb', border: '1px solid #f3f4f6', borderRadius: '5px', padding: '7px 9px', ...extra }}>
      <div style={{ fontFamily: 'var(--font-mono)', fontSize: '9px', color: '#9ca3af', marginBottom: '2px' }}>{label}</div>
      <div style={{
        fontFamily: mono ? 'var(--font-mono)' : 'var(--font-sans)', fontSize: '12px',
        fontWeight: 600, color: valueColor, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
      }}>{value}</div>
    </div>
  );
}

function LossCell({ label, value, color }: { label: string; value: string; color: string }) {
  return (
    <div style={{ background: '#f9fafb', border: '1px solid #f3f4f6', borderRadius: '5px', padding: '7px 9px' }}>
      <div style={{ fontFamily: 'var(--font-mono)', fontSize: '9px', color: '#9ca3af', marginBottom: '2px' }}>{label}</div>
      <div style={{ fontFamily: 'var(--font-mono)', fontSize: '12px', fontWeight: 700, color }}>{value}</div>
    </div>
  );
}
