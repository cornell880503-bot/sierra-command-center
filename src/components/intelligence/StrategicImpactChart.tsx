import { useAppStore } from '../../store/useAppStore';

export function StrategicImpactChart() {
  const clusters = useAppStore(s => s.clusters);
  const pipelines = useAppStore(s => s.pipelines);
  const selectedClusterId = useAppStore(s => s.selectedClusterId);
  const selectCluster = useAppStore(s => s.selectCluster);

  const data = clusters
    .map(c => ({
      id: c.id, label: c.label, color: c.color,
      monthly: pipelines[c.id]?.recommendation.valueProjection.monthlyLossSGD ?? 0,
      priority: pipelines[c.id]?.recommendation.priority ?? 'P3',
    }))
    .filter(d => d.monthly > 0)
    .sort((a, b) => b.monthly - a.monthly);

  if (data.length === 0) return null;

  const max = data[0].monthly;

  return (
    <div style={{ padding: '10px 14px' }}>
      <div style={{
        fontFamily: 'var(--font-mono)', fontSize: '9px',
        color: '#9ca3af', textTransform: 'uppercase',
        letterSpacing: '0.08em', marginBottom: '8px',
      }}>
        Monthly Exposure · SGD
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
        {data.map((d) => {
          const pct = (d.monthly / max) * 100;
          const isSelected = selectedClusterId === d.id;
          return (
            <div key={d.id} style={{ cursor: 'pointer' }} onClick={() => selectCluster(d.id)}>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '2px' }}>
                <span style={{
                  fontFamily: 'var(--font-mono)', fontSize: '10px',
                  color: isSelected ? '#111827' : '#6b7280',
                  maxWidth: '160px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                  transition: 'color 0.15s',
                }}>
                  {d.label}
                </span>
                <span style={{
                  fontFamily: 'var(--font-mono)', fontSize: '10px', fontWeight: 700,
                  color: isSelected ? '#dc2626' : '#9ca3af', transition: 'color 0.15s',
                }}>
                  {d.monthly >= 1_000_000
                    ? `${(d.monthly / 1_000_000).toFixed(1)}M`
                    : d.monthly >= 1_000
                    ? `${(d.monthly / 1_000).toFixed(0)}K`
                    : String(d.monthly)}
                </span>
              </div>
              <div style={{ height: '3px', borderRadius: '2px', background: '#f3f4f6', overflow: 'hidden' }}>
                <div style={{
                  height: '100%', borderRadius: '2px',
                  width: `${pct}%`,
                  background: isSelected
                    ? `linear-gradient(to right, ${d.color}, #dc2626)`
                    : d.color,
                  opacity: isSelected ? 1 : 0.45,
                  transition: 'all 0.3s ease',
                }} />
              </div>
            </div>
          );
        })}
      </div>

      <div style={{
        marginTop: '8px', paddingTop: '7px', borderTop: '1px solid #f3f4f6',
        display: 'flex', justifyContent: 'space-between', alignItems: 'baseline',
      }}>
        <span style={{ fontFamily: 'var(--font-mono)', fontSize: '9px', color: '#9ca3af' }}>TOTAL</span>
        <span style={{ fontFamily: 'var(--font-mono)', fontSize: '12px', fontWeight: 700, color: '#dc2626' }}>
          SGD {data.reduce((s, d) => s + d.monthly, 0).toLocaleString()}
        </span>
      </div>
    </div>
  );
}
