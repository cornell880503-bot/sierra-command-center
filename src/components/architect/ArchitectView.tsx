import ReactDOM from 'react-dom';
import { useState, useEffect, useRef } from 'react';
import { useAppStore } from '../../store/useAppStore';
import type { ChangeRequestPackage, ContextInjection, SyncPhase } from '../../types';

// ─── Terminal lines for deploy animation ─────────────────────────────────────
const VALIDATION_LINES = [
  '$ sierra validate --policy cross-border-handling.md',
  '  ✓ Schema validation passed',
  '  ✓ MAS Notice 626 compliance check passed',
  '  ✓ PDPA data handling requirements met',
  '  ✓ Conflict detection: no overlapping rules found',
  '  ✓ Rollback plan generated: rollback-cr-auto-20240329.json',
  '  → Governance approval: 3/3 required sign-offs present',
  '  ✓ All governance checks passed',
  '$ Proceeding to deployment...',
];

const DEPLOY_LINES = [
  '$ sierra deploy --env production --canary 10pct',
  '  → Connecting to Ghostwriter policy engine...',
  '  ✓ Connected to ghostwriter-prod-sg-01',
  '  → Uploading policy diff (14 lines changed)...',
  '  ✓ Policy diff applied to staging partition',
  '  → Activating canary rollout (10% traffic)...',
  '  ✓ Canary active · monitoring for 60s',
  '  → Running shadow comparison against control group...',
  '  ✓ Shadow test: 0 regressions detected',
  '  → Promoting to full rollout (100% traffic)...',
  '  ✓ Policy live in production',
  '  ✓ Context injections registered · 2 triggers active',
  '  ✓ Rollout complete · sierra-policy-v2.4.1-cr-001',
];

export function ArchitectView() {
  const activeArchitectClusterId = useAppStore(s => s.activeArchitectClusterId);
  const closeArchitectView = useAppStore(s => s.closeArchitectView);
  const changeRequests = useAppStore(s => s.changeRequests);
  const syncStates = useAppStore(s => s.syncStates);
  const setSyncState = useAppStore(s => s.setSyncState);

  const cr = activeArchitectClusterId ? changeRequests[activeArchitectClusterId] : null;
  const syncState = activeArchitectClusterId ? syncStates[activeArchitectClusterId] : null;

  if (!activeArchitectClusterId || !cr) return null;

  const phase = syncState?.phase ?? 'idle';

  const handleSync = () => {
    if (phase !== 'idle') return;
    runSyncWorkflow(cr, setSyncState);
  };

  return ReactDOM.createPortal(
    <>
      {/* Backdrop */}
      <div
        style={{
          position: 'fixed', inset: 0, zIndex: 300,
          background: 'rgba(0,0,0,0.55)',
          backdropFilter: 'blur(3px)',
          animation: 'fadeIn 0.2s ease',
        }}
        onClick={phase === 'idle' || phase === 'success' || phase === 'error' ? closeArchitectView : undefined}
      />

      {/* Modal */}
      <div style={{
        position: 'fixed',
        top: '50%', left: '50%',
        transform: 'translate(-50%, -50%)',
        zIndex: 301,
        width: 'min(860px, 94vw)',
        maxHeight: '88vh',
        background: '#ffffff',
        borderRadius: '12px',
        border: '1px solid #e5e7eb',
        boxShadow: '0 24px 64px rgba(0,0,0,0.18), 0 4px 12px rgba(0,0,0,0.08)',
        display: 'flex', flexDirection: 'column',
        overflow: 'hidden',
        animation: 'fadeIn 0.22s ease',
      }}>
        <ModalHeader cr={cr} phase={phase} onClose={closeArchitectView} />

        <div style={{ flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column' }}>
          {phase === 'idle' && <IdleView cr={cr} onSync={handleSync} />}
          {(phase === 'validating' || phase === 'deploying') && (
            <TerminalView syncState={syncState} />
          )}
          {phase === 'success' && <SuccessView syncState={syncState} onClose={closeArchitectView} />}
        </div>
      </div>
    </>,
    document.body,
  );
}

// ─── Sync workflow orchestrator ───────────────────────────────────────────────
function runSyncWorkflow(
  cr: ChangeRequestPackage,
  setSyncState: ReturnType<typeof useAppStore.getState>['setSyncState'],
) {
  const lines: string[] = [];

  setSyncState(cr.clusterId, { clusterId: cr.clusterId, phase: 'validating', terminalLines: [], roiMessage: '' });

  // Stream validation lines
  VALIDATION_LINES.forEach((line, i) => {
    setTimeout(() => {
      lines.push(line);
      setSyncState(cr.clusterId, {
        clusterId: cr.clusterId, phase: 'validating',
        terminalLines: [...lines], roiMessage: '',
      });
    }, 200 + i * 280);
  });

  const deployStart = 200 + VALIDATION_LINES.length * 280 + 400;

  setSyncState(cr.clusterId, {
    clusterId: cr.clusterId, phase: 'deploying',
    terminalLines: [...lines], roiMessage: '',
  });

  DEPLOY_LINES.forEach((line, i) => {
    setTimeout(() => {
      lines.push(line);
      setSyncState(cr.clusterId, {
        clusterId: cr.clusterId, phase: 'deploying',
        terminalLines: [...lines], roiMessage: '',
      });
    }, deployStart + i * 260);
  });

  const successAt = deployStart + DEPLOY_LINES.length * 260 + 500;
  setTimeout(() => {
    setSyncState(cr.clusterId, {
      clusterId: cr.clusterId, phase: 'success',
      terminalLines: [...lines],
      roiMessage: `Agent logic updated. Estimated ROI: +${cr.estimatedRoiPct}% Recovery Rate`,
    });
  }, successAt);
}

// ─── Sub-views ────────────────────────────────────────────────────────────────
function ModalHeader({ cr, phase, onClose }: {
  cr: ChangeRequestPackage; phase: SyncPhase; onClose: () => void;
}) {
  const phaseLabel: Record<SyncPhase, string> = {
    idle: 'Draft Ready',
    validating: 'Validating…',
    deploying: 'Deploying…',
    success: 'Deployed',
    error: 'Failed',
  };
  const phaseColor: Record<SyncPhase, string> = {
    idle: '#6b7280', validating: '#f59e0b',
    deploying: '#3b82f6', success: '#00a86b', error: '#ef4444',
  };

  return (
    <div style={{
      padding: '18px 24px 14px',
      borderBottom: '1px solid #f3f4f6',
      display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between',
      background: '#fafafa',
      flexShrink: 0,
    }}>
      <div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '3px' }}>
          <div style={{
            width: '18px', height: '18px', borderRadius: '4px',
            background: 'linear-gradient(135deg, #00a86b 0%, #005c3b 100%)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}>
            <span style={{ color: '#fff', fontSize: '9px', fontWeight: 800 }}>S</span>
          </div>
          <span style={{
            fontFamily: 'var(--font-mono)', fontSize: '11px',
            fontWeight: 600, color: '#111827',
          }}>
            Architect Agent · Change Request Package
          </span>
          <span style={{
            fontFamily: 'var(--font-mono)', fontSize: '10px',
            color: phaseColor[phase],
            background: `${phaseColor[phase]}15`,
            border: `1px solid ${phaseColor[phase]}30`,
            borderRadius: '20px', padding: '2px 8px',
          }}>
            {phaseLabel[phase]}
          </span>
        </div>
        <div style={{
          fontFamily: 'var(--font-sans)', fontSize: '13px',
          fontWeight: 600, color: '#111827', marginBottom: '2px',
        }}>
          {cr.title}
        </div>
        <div style={{
          fontFamily: 'var(--font-mono)', fontSize: '10px', color: '#9ca3af',
          display: 'flex', gap: '12px',
        }}>
          <span>{cr.id}</span>
          <span>·</span>
          <span>{cr.affectedPolicyFile}</span>
          <span>·</span>
          <span>+{cr.estimatedRoiPct}% est. ROI</span>
        </div>
      </div>
      {(phase === 'idle' || phase === 'success' || phase === 'error') && (
        <button
          onClick={onClose}
          style={{
            background: 'none', border: '1px solid #e5e7eb', borderRadius: '6px',
            color: '#6b7280', cursor: 'pointer', padding: '4px 12px',
            fontFamily: 'var(--font-mono)', fontSize: '11px',
            transition: 'all 0.15s',
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
          Close
        </button>
      )}
    </div>
  );
}

function IdleView({ cr, onSync }: { cr: ChangeRequestPackage; onSync: () => void }) {
  const [activeTab, setActiveTab] = useState<'diff' | 'injection' | 'governance'>('diff');

  return (
    <div style={{ display: 'flex', flexDirection: 'column', flex: 1 }}>
      {/* Tabs */}
      <div style={{
        display: 'flex', gap: '0', padding: '0 24px',
        borderBottom: '1px solid #f3f4f6',
        background: '#fff',
        flexShrink: 0,
      }}>
        {(['diff', 'injection', 'governance'] as const).map(tab => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            style={{
              background: 'none',
              border: 'none',
              borderBottom: activeTab === tab ? '2px solid #111827' : '2px solid transparent',
              color: activeTab === tab ? '#111827' : '#9ca3af',
              cursor: 'pointer',
              padding: '10px 14px 8px',
              fontFamily: 'var(--font-mono)', fontSize: '11px',
              fontWeight: activeTab === tab ? 600 : 400,
              transition: 'color 0.15s',
            }}
          >
            {tab === 'diff' ? 'Policy Diff' : tab === 'injection' ? 'Context Injections' : 'Governance Notes'}
          </button>
        ))}
      </div>

      {/* Tab content */}
      <div style={{ flex: 1, overflowY: 'auto' }}>
        {activeTab === 'diff' && <PolicyDiffView lines={cr.policyDiff} policyFile={cr.affectedPolicyFile} />}
        {activeTab === 'injection' && <ContextInjectionView injections={cr.contextInjections} />}
        {activeTab === 'governance' && <GovernanceView cr={cr} />}
      </div>

      {/* Footer with sync button */}
      <div style={{
        padding: '14px 24px',
        borderTop: '1px solid #f3f4f6',
        display: 'flex', justifyContent: 'space-between', alignItems: 'center',
        background: '#fff', flexShrink: 0,
      }}>
        <div style={{ fontFamily: 'var(--font-mono)', fontSize: '10px', color: '#9ca3af' }}>
          {cr.policyDiff.filter(l => l.type === 'add').length} additions ·{' '}
          {cr.policyDiff.filter(l => l.type === 'remove').length} deletions ·{' '}
          {cr.contextInjections.length} context injections
        </div>
        <button
          onClick={onSync}
          style={{
            background: '#111827',
            color: '#fff',
            border: 'none',
            borderRadius: '8px',
            padding: '9px 20px',
            fontFamily: 'var(--font-sans)', fontSize: '12px',
            fontWeight: 600, cursor: 'pointer',
            display: 'flex', alignItems: 'center', gap: '8px',
            transition: 'background 0.15s',
          }}
          onMouseOver={e => (e.currentTarget.style.background = '#1f2937')}
          onMouseOut={e => (e.currentTarget.style.background = '#111827')}
        >
          <span style={{ fontSize: '13px' }}>↑</span>
          Sync to Ghostwriter
        </button>
      </div>
    </div>
  );
}

function PolicyDiffView({ lines, policyFile }: {
  lines: ChangeRequestPackage['policyDiff']; policyFile: string;
}) {
  const lineColor = {
    add: { bg: '#f0fdf4', text: '#166534', gutter: '#86efac' },
    remove: { bg: '#fef2f2', text: '#991b1b', gutter: '#fca5a5' },
    header: { bg: '#eff6ff', text: '#1e40af', gutter: '#93c5fd' },
    meta: { bg: '#f9fafb', text: '#6b7280', gutter: '#e5e7eb' },
    context: { bg: '#ffffff', text: '#374151', gutter: '#e5e7eb' },
  };

  const prefix = { add: '+', remove: '-', header: '@@', meta: '', context: ' ' };

  return (
    <div style={{ padding: '16px 24px' }}>
      {/* File header */}
      <div style={{
        background: '#f8fafc', border: '1px solid #e5e7eb',
        borderRadius: '6px 6px 0 0', padding: '8px 12px',
        fontFamily: 'var(--font-mono)', fontSize: '11px', color: '#4b5563',
        borderBottom: '1px solid #e5e7eb',
      }}>
        📄 {policyFile}
      </div>

      {/* Diff lines */}
      <div style={{
        border: '1px solid #e5e7eb', borderTop: 'none',
        borderRadius: '0 0 6px 6px', overflow: 'hidden',
        fontFamily: 'var(--font-mono)', fontSize: '12px',
      }}>
        {lines.map((line, i) => {
          const s = lineColor[line.type];
          return (
            <div key={i} style={{
              display: 'flex', background: s.bg,
              borderBottom: i < lines.length - 1 ? '1px solid rgba(0,0,0,0.03)' : 'none',
            }}>
              {/* Gutter */}
              <div style={{
                width: '32px', minWidth: '32px',
                background: s.gutter + '40',
                borderRight: `1px solid ${s.gutter}`,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontSize: '11px', color: s.text, opacity: 0.7,
                fontWeight: line.type === 'add' || line.type === 'remove' ? 700 : 400,
              }}>
                {prefix[line.type]}
              </div>
              {/* Content */}
              <div style={{
                padding: '3px 12px',
                color: s.text,
                lineHeight: '1.6',
                whiteSpace: 'pre-wrap', wordBreak: 'break-all',
                flex: 1,
              }}>
                {line.content}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function ContextInjectionView({ injections }: { injections: ContextInjection[] }) {
  return (
    <div style={{ padding: '16px 24px', display: 'flex', flexDirection: 'column', gap: '16px' }}>
      {injections.map((inj, i) => (
        <div key={i} style={{
          border: '1px solid #e5e7eb', borderRadius: '8px', overflow: 'hidden',
          animation: `fadeUp 0.3s ease ${i * 0.08}s both`,
        }}>
          {/* Header */}
          <div style={{
            background: '#f8fafc', padding: '10px 14px',
            borderBottom: '1px solid #e5e7eb',
          }}>
            <div style={{
              fontFamily: 'var(--font-mono)', fontSize: '10px',
              color: '#6b7280', marginBottom: '3px', textTransform: 'uppercase', letterSpacing: '0.06em',
            }}>
              Injection #{i + 1} · Trigger
            </div>
            <div style={{
              fontFamily: 'var(--font-sans)', fontSize: '12px',
              fontWeight: 600, color: '#111827',
            }}>
              {inj.trigger}
            </div>
          </div>
          <div style={{ padding: '14px', display: 'flex', flexDirection: 'column', gap: '10px' }}>
            <InjField label="Condition" value={inj.condition} mono />
            <InjField label="Instruction" value={inj.instruction} />
            <InjField label="Tone" value={inj.tone} />
            {/* Example — highlighted */}
            <div>
              <div style={{
                fontFamily: 'var(--font-mono)', fontSize: '10px',
                color: '#9ca3af', marginBottom: '5px',
                textTransform: 'uppercase', letterSpacing: '0.06em',
              }}>Example Response</div>
              <div style={{
                background: '#f0fdf4',
                border: '1px solid #bbf7d0',
                borderLeft: '3px solid #00a86b',
                borderRadius: '0 6px 6px 0',
                padding: '10px 13px',
                fontFamily: 'var(--font-sans)', fontSize: '12px',
                color: '#166534', lineHeight: '1.55',
                fontStyle: 'italic',
              }}>
                {inj.example}
              </div>
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

function InjField({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div>
      <div style={{
        fontFamily: 'var(--font-mono)', fontSize: '10px',
        color: '#9ca3af', marginBottom: '3px',
        textTransform: 'uppercase', letterSpacing: '0.06em',
      }}>{label}</div>
      <div style={{
        fontFamily: mono ? 'var(--font-mono)' : 'var(--font-sans)',
        fontSize: mono ? '11px' : '12px',
        color: mono ? '#374151' : '#4b5563',
        background: mono ? '#f8fafc' : 'transparent',
        padding: mono ? '6px 10px' : '0',
        borderRadius: mono ? '4px' : '0',
        border: mono ? '1px solid #e5e7eb' : 'none',
        lineHeight: '1.55',
      }}>{value}</div>
    </div>
  );
}

function GovernanceView({ cr }: { cr: ChangeRequestPackage }) {
  return (
    <div style={{ padding: '16px 24px', display: 'flex', flexDirection: 'column', gap: '12px' }}>
      <div style={{
        background: '#fffbeb', border: '1px solid #fde68a',
        borderLeft: '3px solid #f59e0b',
        borderRadius: '0 6px 6px 0', padding: '12px 14px',
      }}>
        <div style={{
          fontFamily: 'var(--font-mono)', fontSize: '10px',
          color: '#92400e', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: '5px',
        }}>
          Governance Requirements
        </div>
        <div style={{
          fontFamily: 'var(--font-sans)', fontSize: '12px',
          color: '#78350f', lineHeight: '1.55',
        }}>
          {cr.governanceNotes}
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
        <GovCell label="Change Request ID" value={cr.id} mono />
        <GovCell label="Policy File" value={cr.affectedPolicyFile} mono />
        <GovCell label="Estimated ROI" value={`+${cr.estimatedRoiPct}% Recovery Rate`} accent="#00a86b" />
        <GovCell label="Generated At" value={new Date(cr.generatedAt).toLocaleString('en-SG')} />
        <GovCell
          label="Lines Added"
          value={String(cr.policyDiff.filter(l => l.type === 'add').length)}
          accent="#16a34a"
        />
        <GovCell
          label="Lines Removed"
          value={String(cr.policyDiff.filter(l => l.type === 'remove').length)}
          accent="#dc2626"
        />
      </div>

      <div style={{
        background: '#f0f9ff', border: '1px solid #bae6fd',
        borderRadius: '6px', padding: '12px 14px',
      }}>
        <div style={{
          fontFamily: 'var(--font-mono)', fontSize: '10px',
          color: '#0369a1', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: '5px',
        }}>
          Rollback Plan
        </div>
        <div style={{
          fontFamily: 'var(--font-mono)', fontSize: '11px', color: '#0c4a6e',
        }}>
          rollback-{cr.id.toLowerCase()}-{cr.generatedAt.slice(0, 10)}.json
        </div>
        <div style={{
          fontFamily: 'var(--font-sans)', fontSize: '11px', color: '#075985', marginTop: '4px',
        }}>
          Canary deploy at 10% traffic for 60s before full promotion. Auto-rollback on error rate &gt; 0.5%.
        </div>
      </div>
    </div>
  );
}

function GovCell({ label, value, mono, accent }: {
  label: string; value: string; mono?: boolean; accent?: string;
}) {
  return (
    <div style={{
      background: '#f9fafb', border: '1px solid #e5e7eb',
      borderRadius: '6px', padding: '8px 10px',
    }}>
      <div style={{
        fontFamily: 'var(--font-mono)', fontSize: '9px', color: '#9ca3af',
        marginBottom: '3px', textTransform: 'uppercase', letterSpacing: '0.06em',
      }}>{label}</div>
      <div style={{
        fontFamily: mono ? 'var(--font-mono)' : 'var(--font-sans)',
        fontSize: '11px', fontWeight: 600,
        color: accent ?? '#111827',
        overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
      }}>{value}</div>
    </div>
  );
}

function TerminalView({ syncState }: { syncState: ReturnType<typeof useAppStore.getState>['syncStates'][string] | null }) {
  const endRef = useRef<HTMLDivElement>(null);
  const lines = syncState?.terminalLines ?? [];
  const phase = syncState?.phase ?? 'validating';

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [lines.length]);

  const phaseLabel = phase === 'validating' ? 'Validating against Governance Rules' : 'Deploying to Production';
  const phaseColor = phase === 'validating' ? '#f59e0b' : '#3b82f6';

  return (
    <div style={{ padding: '20px 24px', display: 'flex', flexDirection: 'column', gap: '12px', flex: 1 }}>
      {/* Phase header */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: '10px',
        padding: '10px 14px',
        background: `${phaseColor}08`, border: `1px solid ${phaseColor}25`,
        borderRadius: '8px',
      }}>
        <div style={{
          display: 'flex', gap: '4px', alignItems: 'center',
        }}>
          {[0, 1, 2].map(i => (
            <div key={i} className="thinking-dot" style={{
              background: phaseColor,
              animationDelay: `${i * 0.16}s`,
            }} />
          ))}
        </div>
        <span style={{
          fontFamily: 'var(--font-mono)', fontSize: '12px',
          fontWeight: 600, color: phaseColor,
        }}>{phaseLabel}</span>
      </div>

      {/* Terminal */}
      <div style={{
        background: '#0d1117', borderRadius: '8px',
        border: '1px solid #30363d', flex: 1, minHeight: '280px',
        padding: '16px', overflow: 'auto',
        fontFamily: 'var(--font-mono)', fontSize: '12px', lineHeight: '1.7',
      }}>
        {lines.map((line, i) => (
          <div key={i} style={{
            color: line.startsWith('  ✓') ? '#3fb950' :
              line.startsWith('  →') ? '#79c0ff' :
              line.startsWith('  !') ? '#f85149' :
              line.startsWith('$') ? '#e6edf3' :
              '#8b949e',
            animation: `fadeIn 0.15s ease both`,
          }}>
            {line}
          </div>
        ))}
        <div style={{
          display: 'inline-block', width: '8px', height: '14px',
          background: phaseColor, opacity: 0.8,
          animation: 'liveBlip 0.8s ease-in-out infinite',
          verticalAlign: 'middle',
        }} />
        <div ref={endRef} />
      </div>
    </div>
  );
}

function SuccessView({ syncState, onClose }: {
  syncState: ReturnType<typeof useAppStore.getState>['syncStates'][string] | null;
  onClose: () => void;
}) {
  return (
    <div style={{
      padding: '32px 24px', display: 'flex', flexDirection: 'column',
      alignItems: 'center', gap: '20px', flex: 1,
    }}>
      {/* Success icon */}
      <div style={{
        width: '64px', height: '64px', borderRadius: '50%',
        background: 'linear-gradient(135deg, #00a86b, #005c3b)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        boxShadow: '0 0 0 8px rgba(0,168,107,0.12)',
        animation: 'fadeIn 0.4s ease',
      }}>
        <span style={{ color: '#fff', fontSize: '28px' }}>✓</span>
      </div>

      {/* Toast message */}
      <div style={{ textAlign: 'center' }}>
        <div style={{
          fontFamily: 'var(--font-sans)', fontSize: '18px',
          fontWeight: 700, color: '#111827', marginBottom: '6px',
        }}>
          Deployed to Production
        </div>
        <div style={{
          fontFamily: 'var(--font-sans)', fontSize: '14px',
          color: '#00a86b', fontWeight: 600,
        }}>
          {syncState?.roiMessage ?? 'Agent logic updated successfully'}
        </div>
      </div>

      {/* Final terminal (scrolled to end) */}
      <div style={{
        background: '#0d1117', borderRadius: '8px',
        border: '1px solid #30363d', width: '100%', maxHeight: '220px',
        padding: '14px', overflow: 'auto',
        fontFamily: 'var(--font-mono)', fontSize: '11px', lineHeight: '1.7',
      }}>
        {syncState?.terminalLines.slice(-8).map((line, i) => (
          <div key={i} style={{
            color: line.startsWith('  ✓') ? '#3fb950' :
              line.startsWith('  →') ? '#79c0ff' :
              line.startsWith('$') ? '#e6edf3' : '#8b949e',
          }}>
            {line}
          </div>
        ))}
      </div>

      <button
        onClick={onClose}
        style={{
          background: '#111827', color: '#fff', border: 'none',
          borderRadius: '8px', padding: '10px 28px',
          fontFamily: 'var(--font-sans)', fontSize: '13px',
          fontWeight: 600, cursor: 'pointer',
        }}
      >
        Done
      </button>
    </div>
  );
}
