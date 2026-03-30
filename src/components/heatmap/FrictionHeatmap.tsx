import { useState } from 'react';
import { useAppStore } from '../../store/useAppStore';
import type { FrictionLog } from '../../types';

// Interpolate: low → mode-aware light color; high → deep crimson
function frictionColor(score: number, lowColor: [number, number, number]): string {
  const [lr, lg, lb] = lowColor;
  const r = Math.round(lr - (lr - 153) * Math.pow(score, 0.7));
  const g = Math.round(lg - (lg - 27) * Math.pow(score, 0.6));
  const b = Math.round(lb - (lb - 27) * score);
  return `rgb(${r},${g},${b})`;
}

interface TooltipState { log: FrictionLog; x: number; y: number; }

export function FrictionHeatmap() {
  const logs = useAppStore(s => s.logs);
  const clusters = useAppStore(s => s.clusters);
  const pipelines = useAppStore(s => s.pipelines);
  const selectedClusterId = useAppStore(s => s.selectedClusterId);
  const openLog = useAppStore(s => s.openLog);
  const appMode = useAppStore(s => s.appMode);
  const [tooltip, setTooltip] = useState<TooltipState | null>(null);

  const lowColor: [number, number, number] = appMode === 'FINTECH' ? [240, 230, 211] : [255, 228, 230];

  const sorted = [...logs].sort((a, b) => b.frictionScore - a.frictionScore);
  const selectedCluster = clusters.find(c => c.id === selectedClusterId);
  const highlightedIds = new Set(selectedCluster?.logIds ?? []);

  const getCluster = (id: string) => clusters.find(c => c.logIds.includes(id));
  const getPriority = (id: string) => {
    const c = getCluster(id);
    return c ? pipelines[c.id]?.recommendation.priority : undefined;
  };

  return (
    <div style={{
      flex: 1, padding: '20px', position: 'relative',
      minWidth: 0, display: 'flex', flexDirection: 'column',
      background: '#f6f5f3',
    }}>
      {/* Header */}
      <div style={{
        display: 'flex', alignItems: 'flex-end',
        justifyContent: 'space-between', marginBottom: '14px',
      }}>
        <div>
          <h2 style={{
            fontFamily: 'var(--font-sans)', fontSize: '13px',
            fontWeight: 600, color: '#111827', margin: 0,
          }}>
            Global Friction Heatmap
          </h2>
          <p style={{
            fontFamily: 'var(--font-mono)', fontSize: '10px',
            color: '#9ca3af', marginTop: '2px',
          }}>
            100 logs · friction intensity · click to inspect
          </p>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          <span style={{ fontFamily: 'var(--font-mono)', fontSize: '9px', color: '#d1d5db' }}>Low</span>
          <div style={{
            width: '64px', height: '4px', borderRadius: '2px',
            background: appMode === 'FINTECH'
              ? 'linear-gradient(to right, #f0e6d3, #991b1b)'
              : 'linear-gradient(to right, #ffe4e6, #991b1b)',
          }} />
          <span style={{ fontFamily: 'var(--font-mono)', fontSize: '9px', color: '#d1d5db' }}>High</span>
          <div style={{ width: '1px', height: '14px', background: '#e5e7eb' }} />
          {clusters.map(c => (
            <div key={c.id} style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
              <div style={{
                width: '6px', height: '6px', borderRadius: '50%', background: c.color,
                boxShadow: selectedClusterId === c.id ? `0 0 4px ${c.color}` : 'none',
              }} />
              <span style={{
                fontFamily: 'var(--font-mono)', fontSize: '9px',
                color: selectedClusterId === c.id ? '#374151' : '#9ca3af',
                transition: 'color 0.2s',
              }}>
                {c.label.split(' ')[0]}
              </span>
            </div>
          ))}
        </div>
      </div>

      {/* Grid */}
      <div style={{
        display: 'grid', gridTemplateColumns: 'repeat(10, 1fr)',
        gap: '4px', maxHeight: '420px', flex: 1,
      }}>
        {sorted.map(log => {
          const isHighlighted = selectedClusterId ? highlightedIds.has(log.id) : true;
          const clusterColor = getCluster(log.id)?.color ?? '#9ca3af';
          const priority = getPriority(log.id);

          return (
            <div
              key={log.id}
              onClick={() => openLog(log.id)}
              onMouseEnter={e => {
                const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
                setTooltip({ log, x: r.left, y: r.top });
              }}
              onMouseLeave={() => setTooltip(null)}
              onMouseOver={e => {
                (e.currentTarget as HTMLElement).style.transform = 'scale(1.2)';
                (e.currentTarget as HTMLElement).style.zIndex = '10';
              }}
              onMouseOut={e => {
                (e.currentTarget as HTMLElement).style.transform = 'scale(1)';
                (e.currentTarget as HTMLElement).style.zIndex = '1';
              }}
              style={{
                aspectRatio: '1', borderRadius: '4px',
                background: frictionColor(log.frictionScore, lowColor),
                border: isHighlighted && selectedClusterId
                  ? `1.5px solid ${clusterColor}`
                  : '1px solid rgba(0,0,0,0.05)',
                opacity: selectedClusterId ? (isHighlighted ? 1 : 0.18) : 1,
                cursor: 'pointer',
                transition: 'all 0.12s ease',
                position: 'relative',
                boxShadow: priority === 'P0' && isHighlighted
                  ? '0 0 0 1px rgba(220,38,38,0.4)' : 'none',
              }}
            />
          );
        })}
      </div>

      {/* Tooltip */}
      {tooltip && (
        <div style={{
          position: 'fixed', left: tooltip.x + 14, top: tooltip.y - 90,
          background: '#ffffff', border: '1px solid #e5e7eb',
          borderRadius: '8px', padding: '10px 13px', zIndex: 100,
          pointerEvents: 'none', animation: 'fadeIn 0.1s ease',
          minWidth: '178px',
          boxShadow: '0 8px 24px rgba(0,0,0,0.1)',
        }}>
          <div style={{
            fontFamily: 'var(--font-mono)', fontSize: '12px',
            fontWeight: 700, color: '#111827', marginBottom: '6px',
          }}>
            {tooltip.log.id}
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '3px' }}>
            <TRow label="Tier" value={tooltip.log.userMetadata.tier}
              color={tooltip.log.userMetadata.tier === 'Platinum' ? '#7c3aed' : '#b45309'} />
            <TRow label="HTTP" value={String(tooltip.log.systemContext.apiStatusCode)} color="#dc2626" />
            <TRow label="Latency" value={`${tooltip.log.systemContext.latencyMs.toLocaleString()}ms`} color="#ca8a04" />
            <TRow label="Retries" value={String(tooltip.log.systemContext.retryCount)} />
            <TRow label="NPS" value={`${tooltip.log.userMetadata.nps > 0 ? '+' : ''}${tooltip.log.userMetadata.nps}`}
              color={tooltip.log.userMetadata.nps < 0 ? '#dc2626' : '#16a34a'} />
            <TRow label="Friction" value={tooltip.log.frictionScore.toFixed(3)} color="#f97316" />
            <div style={{
              marginTop: '3px', paddingTop: '5px', borderTop: '1px solid #f3f4f6',
              fontFamily: 'var(--font-mono)', fontSize: '9px', color: '#9ca3af',
            }}>
              {tooltip.log.archetype}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function TRow({ label, value, color = '#4b5563' }: { label: string; value: string; color?: string }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', gap: '12px' }}>
      <span style={{ fontFamily: 'var(--font-mono)', fontSize: '10px', color: '#9ca3af' }}>{label}</span>
      <span style={{ fontFamily: 'var(--font-mono)', fontSize: '10px', color }}>{value}</span>
    </div>
  );
}
