import { useEffect, useState } from 'react';
import type { IntelligencePipeline } from '../../types';
import { useAppStore } from '../../store/useAppStore';

interface Props {
  pipeline: IntelligencePipeline;
  thinking: boolean;
}

const DEBT_COLOR: Record<string, string> = {
  Critical: '#dc2626', High: '#f97316', Medium: '#ca8a04', Low: '#16a34a',
};
const PRIORITY_COLOR: Record<string, string> = {
  P0: '#dc2626', P1: '#f97316', P2: '#ca8a04', P3: '#6b7280',
};
const AGENT_STEPS = ['Observer', 'Analyst', 'Strategist', 'Architect'] as const;

export function IntelligenceTrace({ pipeline, thinking }: Props) {
  const [visibleStep, setVisibleStep] = useState(thinking ? 0 : 3);
  const openArchitectView = useAppStore(s => s.openArchitectView);
  const changeRequests = useAppStore(s => s.changeRequests);
  const syncStates = useAppStore(s => s.syncStates);

  const cr = changeRequests[pipeline.clusterId];
  const syncState = syncStates[pipeline.clusterId];
  const syncPhase = syncState?.phase;

  useEffect(() => {
    if (thinking) { setVisibleStep(0); return; }
    setVisibleStep(0);
    const t = [
      setTimeout(() => setVisibleStep(1), 100),
      setTimeout(() => setVisibleStep(2), 280),
      setTimeout(() => setVisibleStep(3), 460),
      setTimeout(() => setVisibleStep(4), cr ? 640 : 99999),
    ];
    return () => t.forEach(clearTimeout);
  }, [thinking, pipeline.clusterId, cr]);

  const { insightCard: insight, recommendation: reco } = pipeline;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '0' }}>
      {/* Agent pipeline breadcrumb */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: '6px',
        marginBottom: '14px',
      }}>
        {AGENT_STEPS.map((step, i) => {
          const done = visibleStep > i;
          const active = visibleStep === i && thinking;
          return (
            <div key={step} style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
              <div style={{
                display: 'flex', alignItems: 'center', gap: '5px',
                padding: '3px 8px', borderRadius: '20px',
                background: done ? '#f0fdf4' : active ? '#fefce8' : '#f9fafb',
                border: `1px solid ${done ? '#bbf7d0' : active ? '#fde68a' : '#e5e7eb'}`,
                transition: 'all 0.3s ease',
              }}>
                <div style={{
                  width: '5px', height: '5px', borderRadius: '50%',
                  background: done ? '#16a34a' : active ? '#ca8a04' : '#d1d5db',
                  transition: 'background 0.3s',
                }} />
                <span style={{
                  fontFamily: 'var(--font-mono)', fontSize: '9px',
                  fontWeight: 600,
                  color: done ? '#166534' : active ? '#92400e' : '#9ca3af',
                  textTransform: 'uppercase', letterSpacing: '0.06em',
                }}>
                  {step}
                </span>
                {active && thinking && <ThinkingDots small />}
              </div>
              {i < AGENT_STEPS.length - 1 && (
                <span style={{ color: '#e5e7eb', fontSize: '10px' }}>→</span>
              )}
            </div>
          );
        })}
      </div>

      {/* Step blocks */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>

        {/* Step 1: Observer */}
        <StepBlock
          visible={visibleStep >= 1} thinking={thinking && visibleStep === 0}
          label="Observer" tag="Clustering" color="#3b82f6" icon="◎" delay={0}
        >
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
            <Tag>k-means k=4</Tag>
            <Tag>7-dim features</Tag>
            <Tag>50 iter</Tag>
            <Tag color="#3b82f6">{pipeline.clusterId}</Tag>
            <Tag>{pipeline.thinkingMs}ms</Tag>
          </div>
        </StepBlock>

        {/* Step 2: Analyst */}
        <StepBlock
          visible={visibleStep >= 2} thinking={thinking && visibleStep === 1}
          label="Analyst" tag="Root Cause" color="#7c3aed" icon="⬡" delay={0.05}
        >
          <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
            <div style={{
              background: '#fafafa', border: '1px solid #f3f4f6',
              borderLeft: `2px solid ${DEBT_COLOR[insight.technicalDebtLevel] ?? '#6b7280'}`,
              borderRadius: '0 6px 6px 0', padding: '9px 12px',
            }}>
              <div style={{
                fontFamily: 'var(--font-mono)', fontSize: '9px',
                color: DEBT_COLOR[insight.technicalDebtLevel] ?? '#6b7280',
                textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: '3px',
              }}>
                {insight.technicalDebtLevel} Technical Debt
              </div>
              <div style={{
                fontFamily: 'var(--font-sans)', fontSize: '12px',
                fontWeight: 600, color: '#111827', lineHeight: '1.4',
              }}>
                {insight.primaryIssue}
              </div>
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '5px' }}>
              <InfoPill label="System" value={insight.affectedSubsystem.split('·')[0].trim()} />
              <InfoPill label="Owner" value={insight.engineeringOwner.split('·')[0].trim()} />
              <InfoPill label="ETA" value={insight.remediationTimeEst} />
            </div>
          </div>
        </StepBlock>

        {/* Step 3: Strategist */}
        <StepBlock
          visible={visibleStep >= 3} thinking={thinking && visibleStep === 2}
          label="Strategist" tag="Business Impact" color="#00a86b" icon="◈" delay={0.08}
        >
          <div style={{ display: 'flex', flexDirection: 'column', gap: '7px' }}>
            {/* Priority + scores */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <span style={{
                fontFamily: 'var(--font-mono)', fontSize: '11px', fontWeight: 700,
                color: PRIORITY_COLOR[reco.priority],
                background: `${PRIORITY_COLOR[reco.priority]}10`,
                border: `1px solid ${PRIORITY_COLOR[reco.priority]}25`,
                borderRadius: '5px', padding: '3px 8px',
                ...(reco.priority === 'P0' ? { animation: 'pulseCritical 2s ease-in-out infinite' } : {}),
                ...(reco.priority === 'P1' ? { animation: 'pulseHigh 2.5s ease-in-out infinite' } : {}),
              }}>
                {reco.priority}
              </span>
              <span style={{
                fontFamily: 'var(--font-mono)', fontSize: '10px', color: '#6b7280',
              }}>score {reco.priorityScore.toFixed(2)}</span>
              <div style={{ flex: 1, display: 'flex', gap: '8px' }}>
                <MiniBar label="Impact" value={reco.businessImpact} color="#3b82f6" />
                <MiniBar label="Frustration" value={reco.userFrustration} color="#f97316" />
              </div>
            </div>

            {/* Reco title */}
            <div style={{
              fontFamily: 'var(--font-sans)', fontSize: '11px',
              fontWeight: 600, color: '#111827', lineHeight: '1.4',
            }}>
              {reco.title}
            </div>

            {/* Value projection grid */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '5px' }}>
              <ValueCell label="Monthly Loss" value={`SGD ${reco.valueProjection.monthlyLossSGD.toLocaleString()}`} color="#dc2626" />
              <ValueCell
                label="Annual Exposure"
                value={reco.valueProjection.annualLossSGD >= 1_000_000
                  ? `SGD ${(reco.valueProjection.annualLossSGD / 1_000_000).toFixed(2)}M`
                  : `SGD ${reco.valueProjection.annualLossSGD.toLocaleString()}`}
                color="#f97316"
              />
            </div>

            {/* Quick wins */}
            <div>
              <div style={{
                fontFamily: 'var(--font-mono)', fontSize: '9px', color: '#9ca3af',
                textTransform: 'uppercase', letterSpacing: '0.07em', marginBottom: '5px',
              }}>Quick Wins</div>
              {reco.quickWins.map((w, i) => (
                <div key={i} style={{
                  display: 'flex', gap: '7px', alignItems: 'flex-start',
                  padding: '3px 0',
                  borderBottom: i < reco.quickWins.length - 1 ? '1px solid #f9fafb' : 'none',
                }}>
                  <span style={{ color: '#00a86b', flexShrink: 0, marginTop: '1px', fontSize: '11px' }}>›</span>
                  <span style={{
                    fontFamily: 'var(--font-mono)', fontSize: '10px',
                    color: '#4b5563', lineHeight: '1.5',
                  }}>{w}</span>
                </div>
              ))}
            </div>
          </div>
        </StepBlock>

        {/* Step 4: Architect */}
        {(visibleStep >= 4 || cr) && (
          <StepBlock
            visible={visibleStep >= 4 || !!cr} thinking={false}
            label="Architect" tag="Change Request" color="#0369a1" icon="◧" delay={0.1}
          >
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              {cr ? (
                <>
                  <div style={{
                    fontFamily: 'var(--font-sans)', fontSize: '11px',
                    fontWeight: 600, color: '#111827', lineHeight: '1.4',
                  }}>
                    {cr.title}
                  </div>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: '5px' }}>
                    <Tag color="#0369a1">{cr.id}</Tag>
                    <Tag>+{cr.policyDiff.filter(l => l.type === 'add').length} lines</Tag>
                    <Tag color="#16a34a">+{cr.estimatedRoiPct}% ROI</Tag>
                    <Tag>{cr.contextInjections.length} injections</Tag>
                  </div>
                  {/* Sync status badge */}
                  {syncPhase === 'success' ? (
                    <div style={{
                      display: 'flex', alignItems: 'center', gap: '6px',
                      background: '#f0fdf4', border: '1px solid #bbf7d0',
                      borderRadius: '6px', padding: '8px 12px',
                    }}>
                      <span style={{ fontSize: '14px' }}>✓</span>
                      <div>
                        <div style={{ fontFamily: 'var(--font-mono)', fontSize: '11px', fontWeight: 600, color: '#166534' }}>
                          Deployed to Production
                        </div>
                        <div style={{ fontFamily: 'var(--font-mono)', fontSize: '10px', color: '#4ade80' }}>
                          {syncState?.roiMessage}
                        </div>
                      </div>
                    </div>
                  ) : syncPhase === 'validating' || syncPhase === 'deploying' ? (
                    <div style={{
                      display: 'flex', alignItems: 'center', gap: '8px',
                      background: '#eff6ff', border: '1px solid #bfdbfe',
                      borderRadius: '6px', padding: '8px 12px',
                    }}>
                      <ThinkingDots small />
                      <span style={{ fontFamily: 'var(--font-mono)', fontSize: '10px', color: '#1d4ed8' }}>
                        {syncPhase === 'validating' ? 'Validating governance rules…' : 'Deploying to production…'}
                      </span>
                    </div>
                  ) : (
                    /* Draft Auto-Fix button */
                    <button
                      onClick={() => openArchitectView(pipeline.clusterId)}
                      style={{
                        background: '#111827', color: '#fff',
                        border: 'none', borderRadius: '7px',
                        padding: '8px 14px', cursor: 'pointer',
                        fontFamily: 'var(--font-sans)', fontSize: '11px',
                        fontWeight: 600,
                        display: 'flex', alignItems: 'center', gap: '7px',
                        width: '100%', justifyContent: 'center',
                        transition: 'background 0.15s',
                      }}
                      onMouseOver={e => (e.currentTarget.style.background = '#374151')}
                      onMouseOut={e => (e.currentTarget.style.background = '#111827')}
                    >
                      <span style={{ fontSize: '13px' }}>↑</span>
                      Draft Auto-Fix · View Change Request
                    </button>
                  )}
                </>
              ) : (
                <div style={{ display: 'flex', gap: '4px' }}>
                  {[0, 1, 2].map(i => (
                    <div key={i} className="shimmer-line" style={{ height: '10px', flex: 1 }} />
                  ))}
                </div>
              )}
            </div>
          </StepBlock>
        )}
      </div>
    </div>
  );
}

// ─── Sub-components ───────────────────────────────────────────────────────────
function StepBlock({ visible, thinking, label, tag, color, icon, delay, children }: {
  visible: boolean; thinking: boolean; label: string; tag: string;
  color: string; icon: string; delay: number; children: React.ReactNode;
}) {
  return (
    <div style={{
      background: '#ffffff',
      border: '1px solid #f3f4f6',
      borderRadius: '8px',
      overflow: 'hidden',
      opacity: visible ? 1 : 0,
      transform: visible ? 'none' : 'translateY(4px)',
      transition: `opacity 0.3s ease ${delay}s, transform 0.3s ease ${delay}s`,
    }}>
      {/* Step header */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: '8px',
        padding: '8px 12px',
        background: '#fafafa', borderBottom: '1px solid #f3f4f6',
      }}>
        <div style={{
          width: '6px', height: '6px', borderRadius: '50%',
          background: visible ? color : '#e5e7eb',
          boxShadow: visible ? `0 0 5px ${color}60` : 'none',
          transition: 'all 0.3s ease',
        }} />
        <span style={{
          fontFamily: 'var(--font-mono)', fontSize: '10px',
          fontWeight: 700, color: '#111827',
        }}>{icon} {label}</span>
        <span style={{
          fontFamily: 'var(--font-mono)', fontSize: '9px',
          color: '#9ca3af', textTransform: 'uppercase', letterSpacing: '0.06em',
        }}>{tag}</span>
        {thinking && <ThinkingDots small />}
      </div>
      {/* Body */}
      <div style={{ padding: '10px 12px' }}>
        {thinking ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
            {[70, 50, 85].map((w, i) => (
              <div key={i} className="shimmer-line" style={{ height: '10px', width: `${w}%` }} />
            ))}
          </div>
        ) : children}
      </div>
    </div>
  );
}

function ThinkingDots({ small }: { small?: boolean }) {
  const size = small ? '3px' : '4px';
  return (
    <div style={{ display: 'flex', gap: '3px', alignItems: 'center' }}>
      {[0, 1, 2].map(i => (
        <div key={i} className="thinking-dot" style={{
          width: size, height: size,
          background: '#ca8a04',
          animationDelay: `${i * 0.16}s`,
        }} />
      ))}
    </div>
  );
}

function Tag({ children, color }: { children: React.ReactNode; color?: string }) {
  return (
    <span style={{
      fontFamily: 'var(--font-mono)', fontSize: '9px',
      padding: '2px 6px', borderRadius: '3px',
      background: color ? `${color}10` : '#f3f4f6',
      border: `1px solid ${color ? `${color}25` : '#e5e7eb'}`,
      color: color ?? '#4b5563',
    }}>
      {children}
    </span>
  );
}

function InfoPill({ label, value }: { label: string; value: string }) {
  return (
    <span style={{
      fontFamily: 'var(--font-mono)', fontSize: '9px',
      color: '#6b7280', background: '#f9fafb',
      border: '1px solid #e5e7eb', borderRadius: '3px',
      padding: '2px 6px',
    }}>
      <span style={{ color: '#9ca3af' }}>{label} </span>
      {value}
    </span>
  );
}

function MiniBar({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: '2px' }}>
      <div style={{
        display: 'flex', justifyContent: 'space-between',
        fontFamily: 'var(--font-mono)', fontSize: '9px', color: '#9ca3af',
      }}>
        <span>{label}</span>
        <span style={{ color }}>{Math.round(value * 100)}%</span>
      </div>
      <div style={{ height: '2px', borderRadius: '1px', background: '#f3f4f6', overflow: 'hidden' }}>
        <div style={{
          height: '100%', borderRadius: '1px',
          width: `${value * 100}%`, background: color,
          transition: 'width 0.5s ease 0.2s',
        }} />
      </div>
    </div>
  );
}

function ValueCell({ label, value, color }: { label: string; value: string; color: string }) {
  return (
    <div style={{
      background: '#f9fafb', border: '1px solid #e5e7eb',
      borderRadius: '5px', padding: '7px 9px',
    }}>
      <div style={{
        fontFamily: 'var(--font-mono)', fontSize: '9px', color: '#9ca3af',
        marginBottom: '2px', textTransform: 'uppercase', letterSpacing: '0.06em',
      }}>{label}</div>
      <div style={{
        fontFamily: 'var(--font-mono)', fontSize: '12px',
        fontWeight: 700, color,
      }}>{value}</div>
    </div>
  );
}
