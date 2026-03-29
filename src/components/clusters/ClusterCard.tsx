import { useAppStore } from '../../store/useAppStore';
import type { FrictionCluster } from '../../types';
import { IntelligenceTrace } from '../intelligence/IntelligenceTrace';

interface Props {
  cluster: FrictionCluster;
  selected: boolean;
  onSelect: () => void;
}

const PRIORITY_COLOR: Record<string, string> = {
  P0: '#dc2626', P1: '#f97316', P2: '#ca8a04', P3: '#6b7280',
};

export function ClusterCard({ cluster, selected, onSelect }: Props) {
  const pipelines = useAppStore(s => s.pipelines);
  const thinkingClusterId = useAppStore(s => s.thinkingClusterId);
  const openLog = useAppStore(s => s.openLog);
  const logs = useAppStore(s => s.logs);

  const pipeline = pipelines[cluster.id];
  const isThinking = thinkingClusterId === cluster.id;
  const priority = pipeline?.recommendation.priority;
  const priorityColor = priority ? PRIORITY_COLOR[priority] : cluster.color;
  const memberLogs = logs.filter(l => cluster.logIds.includes(l.id));

  return (
    <div style={{
      background: selected ? '#fafafa' : '#ffffff',
      border: selected
        ? `1px solid ${cluster.color}35`
        : '1px solid #f3f4f6',
      borderRadius: '8px',
      marginBottom: '5px',
      transition: 'all 0.2s ease',
      overflow: 'hidden',
      boxShadow: selected ? `0 2px 8px ${cluster.color}15` : '0 1px 2px rgba(0,0,0,0.04)',
    }}>

      {/* Card header */}
      <div
        style={{ padding: '11px 13px', cursor: 'pointer' }}
        onClick={onSelect}
      >
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: '8px' }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '7px', marginBottom: '3px' }}>
              <div style={{
                width: '7px', height: '7px', borderRadius: '50%',
                background: cluster.color, flexShrink: 0,
                boxShadow: selected ? `0 0 6px ${cluster.color}60` : 'none',
                transition: 'box-shadow 0.2s',
              }} />
              <span style={{
                fontFamily: 'var(--font-sans)', fontSize: '12px', fontWeight: 600,
                color: '#111827', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
              }}>
                {cluster.label}
              </span>
              {priority && (
                <span
                  className={priority === 'P0' ? 'priority-critical' : priority === 'P1' ? 'priority-high' : ''}
                  style={{
                    fontFamily: 'var(--font-mono)', fontSize: '9px', fontWeight: 700,
                    color: priorityColor,
                    background: `${priorityColor}10`,
                    border: `1px solid ${priorityColor}25`,
                    borderRadius: '3px', padding: '1px 5px', flexShrink: 0,
                  }}>
                  {priority}
                </span>
              )}
            </div>
            <p style={{
              fontFamily: 'var(--font-mono)', fontSize: '10px',
              color: '#6b7280', lineHeight: '1.5', margin: 0,
            }}>
              {cluster.coreSentiment}
            </p>
          </div>
          <div style={{
            fontFamily: 'var(--font-mono)', fontSize: '10px', color: '#9ca3af',
            flexShrink: 0, textAlign: 'right',
          }}>
            <div style={{ color: cluster.color, fontWeight: 700, fontSize: '13px' }}>
              {Math.round(cluster.businessFrequency * 100)}%
            </div>
            <div>{cluster.logIds.length} logs</div>
          </div>
        </div>

        {/* Frequency bar */}
        <div style={{ marginTop: '9px', height: '2px', borderRadius: '1px', background: '#f3f4f6' }}>
          <div style={{
            height: '100%', borderRadius: '1px',
            width: `${cluster.businessFrequency * 100}%`,
            background: cluster.color,
            boxShadow: selected ? `0 0 3px ${cluster.color}80` : 'none',
            transition: 'width 0.4s ease',
          }} />
        </div>

        {/* Stats */}
        <div style={{
          marginTop: '8px', display: 'flex', gap: '10px', flexWrap: 'wrap',
          fontFamily: 'var(--font-mono)', fontSize: '10px',
        }}>
          <Kv label="HTTP" value={String(cluster.dominantErrorCode)} color={cluster.color} />
          <Kv label="avg lat" value={`${(cluster.avgLatencyMs / 1000).toFixed(1)}s`} />
          <Kv label="friction" value={cluster.avgFrictionScore.toFixed(2)} color="#f97316" />
          <div style={{ marginLeft: 'auto', display: 'flex', gap: '5px' }}>
            <TierBadge tier="Platinum" count={cluster.tierBreakdown.Platinum} />
            <TierBadge tier="Gold" count={cluster.tierBreakdown.Gold} />
          </div>
        </div>

        {/* Monthly loss */}
        {pipeline && (
          <div style={{
            marginTop: '7px', display: 'flex', alignItems: 'center', gap: '5px',
            opacity: isThinking ? 0.4 : 1, transition: 'opacity 0.3s',
          }}>
            <span style={{ fontFamily: 'var(--font-mono)', fontSize: '9px', color: '#d1d5db' }}>est. loss</span>
            <span style={{ fontFamily: 'var(--font-mono)', fontSize: '11px', fontWeight: 700, color: '#dc2626' }}>
              SGD {pipeline.recommendation.valueProjection.monthlyLossSGD.toLocaleString()}/mo
            </span>
            <span style={{ fontFamily: 'var(--font-mono)', fontSize: '9px', color: '#d1d5db' }}>
              · {pipeline.recommendation.valueProjection.annualLossSGD >= 1_000_000
                ? `${(pipeline.recommendation.valueProjection.annualLossSGD / 1_000_000).toFixed(2)}M/yr`
                : `${pipeline.recommendation.valueProjection.annualLossSGD.toLocaleString()}/yr`}
            </span>
          </div>
        )}
      </div>

      {/* Intelligence Trace */}
      {selected && (
        <div style={{
          borderTop: '1px solid #f3f4f6',
          padding: '14px 13px',
          animation: 'fadeUp 0.25s ease both',
          background: '#fafafa',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '12px' }}>
            <span style={{
              fontFamily: 'var(--font-mono)', fontSize: '9px',
              color: '#9ca3af', textTransform: 'uppercase', letterSpacing: '0.1em',
            }}>
              Intelligence Trace
            </span>
            <div style={{ flex: 1, height: '1px', background: '#f3f4f6' }} />
            {isThinking && (
              <div style={{ display: 'flex', gap: '3px' }}>
                {[0, 1, 2].map(i => (
                  <div key={i} className="thinking-dot" style={{ animationDelay: `${i * 0.16}s` }} />
                ))}
              </div>
            )}
          </div>

          {pipeline ? (
            <IntelligenceTrace pipeline={pipeline} thinking={isThinking} />
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '7px' }}>
              {[80, 60, 90, 50].map((w, i) => (
                <div key={i} className="shimmer-line" style={{ height: '10px', width: `${w}%` }} />
              ))}
            </div>
          )}
        </div>
      )}

      {/* Representative logs */}
      {selected && memberLogs.length > 0 && (
        <div style={{
          borderTop: '1px solid #f3f4f6', padding: '10px 13px',
          animation: 'fadeUp 0.3s ease 0.05s both',
          background: '#ffffff',
        }}>
          <div style={{
            fontFamily: 'var(--font-mono)', fontSize: '9px',
            color: '#9ca3af', textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: '7px',
          }}>
            Representative Logs
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '3px' }}>
            {memberLogs.slice(0, 4).map(log => (
              <div
                key={log.id}
                onClick={() => openLog(log.id)}
                style={{
                  display: 'flex', alignItems: 'center', gap: '8px',
                  padding: '6px 8px',
                  background: '#ffffff', border: '1px solid #f3f4f6',
                  borderRadius: '5px', cursor: 'pointer',
                  transition: 'border-color 0.12s, box-shadow 0.12s',
                }}
                onMouseOver={e => {
                  (e.currentTarget as HTMLElement).style.borderColor = `${cluster.color}40`;
                  (e.currentTarget as HTMLElement).style.boxShadow = `0 1px 4px ${cluster.color}10`;
                }}
                onMouseOut={e => {
                  (e.currentTarget as HTMLElement).style.borderColor = '#f3f4f6';
                  (e.currentTarget as HTMLElement).style.boxShadow = 'none';
                }}
              >
                <span style={{ fontFamily: 'var(--font-mono)', fontSize: '10px', color: '#374151', flexShrink: 0 }}>
                  {log.id}
                </span>
                <span style={{
                  fontFamily: 'var(--font-mono)', fontSize: '10px', color: '#9ca3af',
                  flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                }}>
                  {log.dialogue[0].text.slice(0, 50)}…
                </span>
                <span style={{ fontFamily: 'var(--font-mono)', fontSize: '10px', color: '#dc2626', flexShrink: 0 }}>
                  {log.systemContext.apiStatusCode}
                </span>
              </div>
            ))}
            {memberLogs.length > 4 && (
              <div style={{ fontFamily: 'var(--font-mono)', fontSize: '9px', color: '#d1d5db', textAlign: 'center', padding: '3px' }}>
                +{memberLogs.length - 4} more in heatmap
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function Kv({ label, value, color = '#6b7280' }: { label: string; value: string; color?: string }) {
  return (
    <span>
      <span style={{ color: '#9ca3af' }}>{label} </span>
      <span style={{ color }}>{value}</span>
    </span>
  );
}

function TierBadge({ tier, count }: { tier: 'Platinum' | 'Gold'; count: number }) {
  const color = tier === 'Platinum' ? '#7c3aed' : '#b45309';
  return (
    <span style={{
      fontFamily: 'var(--font-mono)', fontSize: '9px', padding: '1px 5px',
      borderRadius: '3px', background: `${color}08`, color,
      border: `1px solid ${color}20`,
    }}>
      {tier[0]} {count}
    </span>
  );
}
