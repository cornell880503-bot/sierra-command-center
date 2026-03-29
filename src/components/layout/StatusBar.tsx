import { useAppStore } from '../../store/useAppStore';

export function StatusBar() {
  const logs = useAppStore(s => s.logs);
  const clusters = useAppStore(s => s.clusters);
  const pipelines = useAppStore(s => s.pipelines);
  const changeRequests = useAppStore(s => s.changeRequests);

  const p95Latency = (() => {
    if (!logs.length) return 0;
    const sorted = [...logs].sort((a, b) => b.systemContext.latencyMs - a.systemContext.latencyMs);
    return sorted[Math.floor(sorted.length * 0.05)].systemContext.latencyMs;
  })();

  const totalAnnual = Object.values(pipelines)
    .reduce((s, p) => s + p.recommendation.valueProjection.annualLossSGD, 0);

  const crCount = Object.keys(changeRequests).length;

  return (
    <footer style={{
      borderTop: '1px solid #e5e7eb',
      background: '#ffffff',
      padding: '0 20px',
      height: '28px',
      display: 'flex', alignItems: 'center', justifyContent: 'space-between',
      flexShrink: 0,
    }}>
      <div style={{ display: 'flex', gap: '16px', alignItems: 'center' }}>
        <Stat label="LOGS" value={`${logs.length}`} />
        <Sep />
        <Stat label="CLUSTERS" value={`${clusters.length}`} />
        <Sep />
        <Stat label="P95 LATENCY" value={`${p95Latency.toLocaleString()}ms`} accent="#ca8a04" />
        <Sep />
        {totalAnnual > 0 && (
          <>
            <Stat
              label="ANNUAL EXPOSURE"
              value={totalAnnual >= 1_000_000
                ? `SGD ${(totalAnnual / 1_000_000).toFixed(2)}M`
                : `SGD ${totalAnnual.toLocaleString()}`}
              accent="#dc2626"
            />
            <Sep />
          </>
        )}
        {crCount > 0 && (
          <Stat label="CHANGE REQUESTS" value={`${crCount} generated`} accent="#0369a1" />
        )}
      </div>

      <div style={{ fontFamily: 'var(--font-mono)', fontSize: '9px', color: '#d1d5db' }}>
        Observer · Analyst · Strategist · Architect · v3.0
      </div>
    </footer>
  );
}

function Sep() {
  return <div style={{ width: '1px', height: '10px', background: '#e5e7eb' }} />;
}

function Stat({ label, value, accent = '#9ca3af' }: { label: string; value: string; accent?: string }) {
  return (
    <span style={{ fontFamily: 'var(--font-mono)', fontSize: '9px', color: '#9ca3af' }}>
      {label} <span style={{ color: accent, fontWeight: 600 }}>{value}</span>
    </span>
  );
}
