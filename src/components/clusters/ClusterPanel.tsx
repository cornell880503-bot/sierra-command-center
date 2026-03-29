import { useAppStore } from '../../store/useAppStore';
import { ClusterCard } from './ClusterCard';
import { StrategicImpactChart } from '../intelligence/StrategicImpactChart';

export function ClusterPanel() {
  const clusters = useAppStore(s => s.clusters);
  const pipelines = useAppStore(s => s.pipelines);
  const selectedClusterId = useAppStore(s => s.selectedClusterId);
  const selectCluster = useAppStore(s => s.selectCluster);

  const totalMonthlyLoss = Object.values(pipelines)
    .reduce((s, p) => s + p.recommendation.valueProjection.monthlyLossSGD, 0);

  return (
    <div style={{
      width: '340px', flexShrink: 0,
      borderRight: '1px solid #e5e7eb',
      display: 'flex', flexDirection: 'column',
      overflow: 'hidden',
      background: '#ffffff',
    }}>
      {/* Header */}
      <div style={{
        padding: '14px 16px 10px',
        borderBottom: '1px solid #f3f4f6',
        flexShrink: 0,
      }}>
        <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: '2px' }}>
          <span style={{
            fontFamily: 'var(--font-sans)', fontSize: '13px',
            fontWeight: 600, color: '#111827',
          }}>
            Friction Clusters
          </span>
          <span style={{ fontFamily: 'var(--font-mono)', fontSize: '10px', color: '#9ca3af' }}>
            {clusters.length} · k=4
          </span>
        </div>
        {totalMonthlyLoss > 0 && (
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
            <span style={{ fontFamily: 'var(--font-mono)', fontSize: '10px', color: '#9ca3af' }}>
              at risk
            </span>
            <span style={{
              fontFamily: 'var(--font-mono)', fontSize: '13px',
              fontWeight: 700, color: '#dc2626',
            }}>
              SGD {totalMonthlyLoss.toLocaleString()}
              <span style={{ color: '#9ca3af', fontWeight: 400, fontSize: '10px' }}>/mo</span>
            </span>
          </div>
        )}
      </div>

      {/* Chart */}
      {Object.keys(pipelines).length > 0 && (
        <div style={{ borderBottom: '1px solid #f3f4f6', flexShrink: 0 }}>
          <StrategicImpactChart />
        </div>
      )}

      {/* Cards */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '8px' }}>
        {clusters.map(cluster => (
          <ClusterCard
            key={cluster.id}
            cluster={cluster}
            selected={selectedClusterId === cluster.id}
            onSelect={() => selectCluster(cluster.id)}
          />
        ))}
      </div>

      {/* Footer */}
      <div style={{
        padding: '6px 16px',
        borderTop: '1px solid #f3f4f6',
        display: 'flex', justifyContent: 'space-between',
        fontFamily: 'var(--font-mono)', fontSize: '9px', color: '#d1d5db',
        flexShrink: 0,
      }}>
        <span>Observer → Analyst → Strategist → Architect</span>
        {selectedClusterId && (
          <span style={{ cursor: 'pointer', color: '#9ca3af' }}
            onClick={() => selectCluster(null)}>deselect</span>
        )}
      </div>
    </div>
  );
}
