import { useAppStore } from '../../store/useAppStore';
import { THEMES } from '../../lib/theme';
import { ImportModal } from '../import/ImportModal';

export function Header() {
  const logs = useAppStore(s => s.logs);
  const clusters = useAppStore(s => s.clusters);
  const pipelines = useAppStore(s => s.pipelines);
  const syncStates = useAppStore(s => s.syncStates);
  const appMode = useAppStore(s => s.appMode);
  const setAppMode = useAppStore(s => s.setAppMode);

  const setImportModalOpen = useAppStore(s => s.setImportModalOpen);
  const importedLogIds = useAppStore(s => s.importedLogIds);
  const criticalCount = Object.values(pipelines)
    .filter(p => p.recommendation.priority === 'P0').length;
  const deployedCount = Object.values(syncStates)
    .filter(s => s.phase === 'success').length;

  const theme = THEMES[appMode];

  return (
    <>
    <ImportModal />
    <header style={{
      borderBottom: '1px solid #e5e7eb',
      background: '#ffffff',
      padding: '0 20px',
      height: '48px',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between',
      position: 'sticky', top: 0, zIndex: 50, flexShrink: 0,
      boxShadow: '0 1px 3px rgba(0,0,0,0.04)',
    }}>
      {/* Left */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '14px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '7px' }}>
          <div style={{
            width: '22px', height: '22px', borderRadius: '6px',
            background: theme.logoGradient,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            boxShadow: `0 1px 3px ${theme.accent}4d`,
          }}>
            <span style={{
              fontFamily: 'var(--font-sans)', fontSize: '10px',
              fontWeight: 800, color: '#fff',
            }}>S</span>
          </div>
          <span style={{
            fontFamily: 'var(--font-sans)', fontSize: '14px',
            fontWeight: 700, color: '#111827', letterSpacing: '-0.02em',
          }}>Sierra</span>
        </div>

        <div style={{ width: '1px', height: '16px', background: '#e5e7eb' }} />

        <span style={{
          fontFamily: 'var(--font-sans)', fontSize: '13px',
          fontWeight: 500, color: '#6b7280',
        }}>
          Strategy Command Center
        </span>

        {/* Mode toggle */}
        <div style={{ display: 'flex', borderRadius: '6px', border: '1px solid #e5e7eb', overflow: 'hidden', marginRight: '8px' }}>
          {(['FINTECH', 'RECOMMERCE'] as const).map(m => (
            <button key={m} onClick={() => setAppMode(m)} style={{
              padding: '4px 10px',
              fontFamily: 'var(--font-mono)', fontSize: '9px', fontWeight: 700,
              border: 'none', cursor: 'pointer',
              background: appMode === m ? THEMES[m].accent : 'transparent',
              color: appMode === m ? '#ffffff' : '#9ca3af',
              transition: 'background 0.15s, color 0.15s',
              letterSpacing: '0.04em',
            }}>
              {m === 'FINTECH' ? 'FinTech' : 'Recommerce'}
            </button>
          ))}
        </div>

        <div style={{
          background: '#f9fafb', border: '1px solid #e5e7eb',
          borderRadius: '20px', padding: '3px 10px',
          fontFamily: 'var(--font-mono)', fontSize: '10px', color: '#6b7280',
          display: 'flex', alignItems: 'center', gap: '5px',
        }}>
          <div style={{
            width: '5px', height: '5px', borderRadius: '50%',
            background: theme.accent,
            animation: 'liveBlip 1.8s ease-in-out infinite',
          }} />
          {theme.contextLabel}
        </div>
      </div>

      {/* Right */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
        <button
          onClick={() => setImportModalOpen(true)}
          style={{
            display: 'flex', alignItems: 'center', gap: '5px',
            padding: '4px 12px', borderRadius: '6px', cursor: 'pointer',
            fontFamily: 'var(--font-mono)', fontSize: '11px', fontWeight: 600,
            background: theme.accentLight, color: theme.accentDark,
            border: `1px solid ${theme.accentBorder}`,
            transition: 'all 0.12s',
            marginRight: '6px',
          }}
          onMouseOver={e => {
            (e.currentTarget as HTMLElement).style.background = theme.accentBorder;
          }}
          onMouseOut={e => {
            (e.currentTarget as HTMLElement).style.background = theme.accentLight;
          }}
        >
          + Import
          {importedLogIds.size > 0 && (
            <span style={{
              background: theme.accent, color: '#fff', borderRadius: '10px',
              padding: '0 5px', fontSize: '9px', fontWeight: 700,
            }}>{importedLogIds.size}</span>
          )}
        </button>
        <Metric label="Logs" value={String(logs.length)} />
        <Sep />
        <Metric label="Clusters" value={String(clusters.length)} />
        <Sep />
        <Metric label="Agents" value={`${Object.keys(pipelines).length * 3}`} />

        {deployedCount > 0 && (
          <>
            <Sep />
            <div style={{
              display: 'flex', alignItems: 'center', gap: '5px',
              background: theme.accentLight, border: `1px solid ${theme.accentBorder}`,
              borderRadius: '20px', padding: '3px 10px',
            }}>
              <span style={{ fontSize: '10px' }}>✓</span>
              <span style={{ fontFamily: 'var(--font-mono)', fontSize: '10px', color: theme.accentDark, fontWeight: 600 }}>
                {deployedCount} deployed
              </span>
            </div>
          </>
        )}

        {criticalCount > 0 && (
          <>
            <Sep />
            <div className="priority-critical" style={{
              display: 'flex', alignItems: 'center', gap: '5px',
              background: '#fef2f2', border: '1px solid #fecaca',
              borderRadius: '20px', padding: '3px 10px',
            }}>
              <div style={{ width: '5px', height: '5px', borderRadius: '50%', background: '#dc2626' }} />
              <span style={{ fontFamily: 'var(--font-mono)', fontSize: '10px', color: '#dc2626', fontWeight: 600 }}>
                {criticalCount} critical
              </span>
            </div>
          </>
        )}

        <Sep />
        <div style={{
          display: 'flex', alignItems: 'center', gap: '5px',
          background: theme.accentLight, border: `1px solid ${theme.accentBorder}`,
          borderRadius: '20px', padding: '3px 10px',
        }}>
          <div style={{
            width: '5px', height: '5px', borderRadius: '50%',
            background: theme.accent, animation: 'liveBlip 1.5s ease-in-out infinite',
          }} />
          <span style={{ fontFamily: 'var(--font-mono)', fontSize: '10px', color: theme.accentDark }}>live</span>
        </div>
      </div>
    </header>
    </>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ padding: '0 6px', display: 'flex', flexDirection: 'column', gap: '0', alignItems: 'flex-end' }}>
      <span style={{ fontFamily: 'var(--font-mono)', fontSize: '12px', fontWeight: 600, color: '#111827', lineHeight: 1.2 }}>
        {value}
      </span>
      <span style={{ fontFamily: 'var(--font-mono)', fontSize: '9px', color: '#9ca3af', lineHeight: 1.2 }}>
        {label}
      </span>
    </div>
  );
}

function Sep() {
  return <div style={{ width: '1px', height: '16px', background: '#e5e7eb', margin: '0 2px' }} />;
}
