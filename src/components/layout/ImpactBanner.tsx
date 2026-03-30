import { useAppStore } from '../../store/useAppStore';
import { THEMES } from '../../lib/theme';

export function ImpactBanner() {
  const pipelines = useAppStore(s => s.pipelines);
  const changeRequests = useAppStore(s => s.changeRequests);
  const clusters = useAppStore(s => s.clusters);
  const appMode = useAppStore(s => s.appMode);

  const theme = THEMES[appMode];

  const pipelineList = Object.values(pipelines);
  if (pipelineList.length === 0) return null;

  const totalMonthly = pipelineList.reduce(
    (s, p) => s + p.recommendation.valueProjection.monthlyLossSGD, 0,
  );
  const totalAnnual = pipelineList.reduce(
    (s, p) => s + p.recommendation.valueProjection.annualLossSGD, 0,
  );
  const avgRoi = Object.values(changeRequests).length > 0
    ? Math.round(Object.values(changeRequests).reduce((s, cr) => s + cr.estimatedRoiPct, 0) / Object.values(changeRequests).length)
    : 12;

  const p0Count = pipelineList.filter(p => p.recommendation.priority === 'P0').length;
  const p1Count = pipelineList.filter(p => p.recommendation.priority === 'P1').length;
  const deployedCount = Object.values(useAppStore.getState().syncStates)
    .filter(s => s.phase === 'success').length;

  const fmtCurrency = (n: number) => {
    const sym = theme.currencySymbol;
    return n >= 1_000_000
      ? `${sym}${(n / 1_000_000).toFixed(2)}M`
      : `${sym}${n.toLocaleString()}`;
  };

  return (
    <div style={{
      background: '#ffffff',
      borderBottom: '1px solid #e5e7eb',
      padding: '12px 20px',
      display: 'flex',
      alignItems: 'center',
      gap: '0',
      flexShrink: 0,
    }}>
      {/* Left: label */}
      <div style={{ marginRight: '20px' }}>
        <div style={{
          fontFamily: 'var(--font-mono)', fontSize: '9px',
          color: '#9ca3af', textTransform: 'uppercase', letterSpacing: '0.1em',
          marginBottom: '2px',
        }}>
          {theme.impactLabel}
        </div>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: '6px' }}>
          <span style={{
            fontFamily: 'var(--font-mono)', fontSize: '18px',
            fontWeight: 700, color: '#dc2626', lineHeight: 1,
          }}>
            {fmtCurrency(totalMonthly)}
          </span>
          <span style={{
            fontFamily: 'var(--font-mono)', fontSize: '11px',
            color: '#9ca3af',
          }}>
            /month at risk
          </span>
        </div>
      </div>

      <div style={{ width: '1px', height: '32px', background: '#f3f4f6', margin: '0 20px' }} />

      {/* Annual */}
      <Metric label="Annual Exposure" value={fmtCurrency(totalAnnual)} color="#dc2626" />
      <Sep />
      <Metric label="Clusters Identified" value={String(clusters.length)} color="#111827" />
      <Sep />
      <Metric label="Critical Issues" value={String(p0Count)} color={p0Count > 0 ? '#dc2626' : '#9ca3af'} />
      <Sep />
      <Metric label="High Priority" value={String(p1Count)} color={p1Count > 0 ? '#f97316' : '#9ca3af'} />
      <Sep />
      <Metric label="Est. Avg ROI" value={`+${avgRoi}%`} color={theme.accent} sub="if all CRs deployed" />

      {/* Right: deployed count / call to action */}
      <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: '10px' }}>
        {deployedCount > 0 && (
          <div style={{
            display: 'flex', alignItems: 'center', gap: '6px',
            background: theme.accentLight, border: `1px solid ${theme.accentBorder}`,
            borderRadius: '20px', padding: '4px 12px',
          }}>
            <span style={{ fontSize: '11px' }}>✓</span>
            <span style={{
              fontFamily: 'var(--font-mono)', fontSize: '10px',
              color: theme.accentDark, fontWeight: 600,
            }}>
              {deployedCount}/{clusters.length} CRs deployed
            </span>
          </div>
        )}
        <div style={{
          fontFamily: 'var(--font-mono)', fontSize: '10px',
          color: '#d1d5db',
          background: '#f9fafb', border: '1px solid #e5e7eb',
          borderRadius: '20px', padding: '4px 12px',
        }}>
          Select a cluster → Draft Auto-Fix
        </div>
      </div>
    </div>
  );
}

function Metric({ label, value, color, sub }: {
  label: string; value: string; color: string; sub?: string;
}) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1px', minWidth: 'max-content' }}>
      <span style={{
        fontFamily: 'var(--font-mono)', fontSize: '13px',
        fontWeight: 700, color, lineHeight: 1,
      }}>{value}</span>
      <span style={{
        fontFamily: 'var(--font-mono)', fontSize: '9px',
        color: '#9ca3af',
      }}>{label}</span>
      {sub && (
        <span style={{ fontFamily: 'var(--font-mono)', fontSize: '9px', color: '#d1d5db' }}>
          {sub}
        </span>
      )}
    </div>
  );
}

function Sep() {
  return <div style={{ width: '1px', height: '28px', background: '#f3f4f6', margin: '0 16px' }} />;
}
