import { useEffect, useMemo, useRef, useState, type PointerEvent } from 'react';
import type { wardHeatmap, farmingHeatmap } from '../../server/src/services/replay';

export type WardMap = Awaited<ReturnType<typeof wardHeatmap>>;
export type FarmMap = Awaited<ReturnType<typeof farmingHeatmap>>;
type Ward = WardMap['points'][number];
type Cell = FarmMap['cells'][number];
const palette = [
  [45, 102, 245],
  [25, 200, 146],
  [255, 188, 51],
  [230, 44, 69],
];
const densityColors = Array.from({ length: 256 }, (_, i) => {
  const k = (i / 255) * 3,
    from = Math.min(2, Math.floor(k)),
    t = k - from;
  return palette[from].map((v, n) => Math.round(v + (palette[from + 1][n] - v) * t));
});
// 在固定分辨率上累计高斯核，再用全图峰值着色。密集样本先合并到像素格，避免逐事件重绘。
function drawHeat(canvas: HTMLCanvasElement, samples: (Ward | Cell)[]) {
  const size = canvas.width,
    ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) return;
  ctx.clearRect(0, 0, size, size);
  const bins = new Map<number, number>();
  for (const p of samples) {
    const x = Math.round(p.nx * (size - 1)),
      y = Math.round(p.ny * (size - 1)),
      key = y * size + x;
    bins.set(key, (bins.get(key) ?? 0) + ('weight' in p ? p.weight : 1));
  }
  if (!bins.size) return;
  const radius = 14,
    diameter = radius * 2 + 1;
  const stamp = document.createElement('canvas');
  stamp.width = stamp.height = diameter;
  const brush = stamp.getContext('2d')!;
  const center = radius + 0.5;
  const gradient = brush.createRadialGradient(center, center, 0, center, center, radius);
  for (let i = 0; i <= 10; i++) {
    const r = i / 10;
    gradient.addColorStop(r, 'rgba(255,255,255,' + (i === 10 ? 0 : Math.exp(-4.5 * r * r)) + ')');
  }
  brush.fillStyle = gradient;
  brush.fillRect(0, 0, diameter, diameter);
  const kernel = brush.getImageData(0, 0, diameter, diameter).data;
  // 用浮点缓冲累加密度，避免 Canvas 的 8 位透明度叠加饱和，丢失热区间的差异。
  const density = new Float64Array(size * size);
  let peak = 0;
  for (const [key, weight] of bins) {
    const x = key % size,
      y = Math.floor(key / size);
    for (let dy = Math.max(-radius, -y); dy <= Math.min(radius, size - 1 - y); dy++) {
      for (let dx = Math.max(-radius, -x); dx <= Math.min(radius, size - 1 - x); dx++) {
        const i = key + dy * size + dx;
        density[i] += weight * kernel[((dy + radius) * diameter + dx + radius) * 4 + 3];
        peak = Math.max(peak, density[i]);
      }
    }
  }
  const pixels = ctx.createImageData(size, size);
  for (let i = 0; i < density.length; i++) {
    if (!density[i]) continue;
    const value = Math.sqrt(density[i] / peak),
      color = densityColors[Math.round(value * 255)];
    pixels.data.set(color, i * 4);
    pixels.data[i * 4 + 3] = Math.min(255, value * 580);
  }
  ctx.putImageData(pixels, 0, 0);
}
function timestamp(seconds: number) {
  const t = Math.floor(Math.abs(seconds));
  return (
    (seconds < 0 ? '−' : '') +
    String(Math.floor(t / 60)).padStart(2, '0') +
    ':' +
    String(t % 60).padStart(2, '0')
  );
}
const noWards: Ward[] = [],
  noCells: Cell[] = [];
export function MinimapHeatmap({
  points = noWards,
  cells = noCells,
  farming = false,
}: {
  points?: Ward[];
  cells?: Cell[];
  farming?: boolean;
}) {
  const [opacity, setOpacity] = useState(78),
    [markers, setMarkers] = useState(true);
  const [index, setIndex] = useState<number | null>(null),
    [pinned, setPinned] = useState(false);
  const heat = useRef<HTMLCanvasElement>(null),
    overlay = useRef<HTMLCanvasElement>(null);
  const selected = !farming && markers && index !== null ? points[index] : null;
  // 指针移动只检查邻近网格，避免多场聚合时反复扫描全部眼位。
  const nearby = useMemo(() => {
    const grid = new Map<number, number[]>();
    for (let i = 0; i < points.length; i++) {
      const p = points[i],
        key = Math.min(31, Math.floor(p.ny * 32)) * 32 + Math.min(31, Math.floor(p.nx * 32));
      const group = grid.get(key);
      if (group) group.push(i);
      else grid.set(key, [i]);
    }
    return grid;
  }, [points]);
  useEffect(() => {
    setIndex(null);
    setPinned(false);
  }, [points, markers, farming]);
  useEffect(() => {
    if (heat.current) drawHeat(heat.current, farming ? cells : points);
  }, [cells, points, farming]);
  useEffect(() => {
    const canvas = overlay.current;
    if (!canvas) return;
    function draw() {
      if (!canvas) return;
      const width = canvas.clientWidth,
        ratio = Math.min(window.devicePixelRatio || 1, 3);
      canvas.width = canvas.height = Math.round(width * ratio);
      const ctx = canvas.getContext('2d');
      if (!ctx || !markers || farming) return;
      ctx.scale(ratio, ratio);
      for (const p of points) {
        const x = p.nx * width,
          y = p.ny * width;
        ctx.beginPath();
        ctx.lineWidth = 2;
        if (p.wardType === 'obs') {
          ctx.fillStyle = '#332812';
          ctx.strokeStyle = '#ffd45d';
          ctx.arc(x, y, 4.4, 0, Math.PI * 2);
        } else {
          ctx.fillStyle = '#103443';
          ctx.strokeStyle = '#6de4ff';
          ctx.moveTo(x, y - 5);
          ctx.lineTo(x + 5, y);
          ctx.lineTo(x, y + 5);
          ctx.lineTo(x - 5, y);
          ctx.closePath();
        }
        ctx.fill();
        ctx.stroke();
      }
    }
    const observer = new ResizeObserver(draw);
    observer.observe(canvas);
    draw();
    return () => observer.disconnect();
  }, [points, markers, farming]);
  function inspect(e: PointerEvent<HTMLCanvasElement>, click: boolean) {
    if ((!click && pinned) || farming || !markers) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const x = e.clientX - rect.left,
      y = e.clientY - rect.top;
    const bucket = (px: number, size: number) =>
      Math.max(0, Math.min(31, Math.floor((px * 32) / size)));
    const candidates: { i: number; d: number }[] = [];
    for (let row = bucket(y - 12, rect.height); row <= bucket(y + 12, rect.height); row++) {
      for (let col = bucket(x - 12, rect.width); col <= bucket(x + 12, rect.width); col++) {
        for (const i of nearby.get(row * 32 + col) ?? []) {
          const d = Math.hypot(points[i].nx * rect.width - x, points[i].ny * rect.height - y);
          if (d <= 12) candidates.push({ i, d });
        }
      }
    }
    candidates.sort((a, b) => a.d - b.d);
    let at = 0;
    if (click && pinned)
      at = (candidates.findIndex((p) => p.i === index) + 1) % (candidates.length || 1);
    setIndex(candidates[at]?.i ?? null);
    if (click) setPinned(!!candidates.length);
  }
  return (
    <div>
      <div className="replay-map">
        <img src="/art/map.jpg" alt="刀塔战术地图，左下方为天辉，右上方为夜魇" />
        <canvas
          ref={heat}
          width={288}
          height={288}
          style={{ opacity: opacity / 100 }}
          aria-hidden="true"
        />
        <canvas
          ref={overlay}
          aria-hidden={farming || !markers}
          aria-label="眼位地图，使用左右方向键逐个查看眼位"
          tabIndex={markers && points.length ? 0 : -1}
          onPointerMove={(e) => inspect(e, false)}
          onPointerUp={(e) => inspect(e, true)}
          onPointerLeave={() => {
            if (!pinned) setIndex(null);
          }}
          onKeyDown={(e) => {
            if (e.key === 'Escape') {
              setPinned(false);
              setIndex(null);
            }
            if (points.length && (e.key === 'ArrowLeft' || e.key === 'ArrowRight')) {
              e.preventDefault();
              setPinned(true);
              setIndex(
                (i) =>
                  ((i ?? (e.key === 'ArrowRight' ? -1 : 0)) +
                    (e.key === 'ArrowRight' ? 1 : -1) +
                    points.length) %
                  points.length,
              );
            }
          }}
        />
        <span className="map-side dire">夜魇</span>
        <span className="map-side radiant">天辉</span>
        {selected && (
          <div
            className="ward-tooltip"
            role="status"
            style={{
              left: `clamp(6px, calc(${selected.nx * 100}% - 86px), 100% - 178px)`,
              [selected.ny < 0.5 ? 'top' : 'bottom']:
                `calc(${(selected.ny < 0.5 ? selected.ny : 1 - selected.ny) * 100}% + 8px)`,
            }}
          >
            <b>
              {timestamp(selected.time)} · {selected.wardType === 'obs' ? '假眼' : '真眼'} ·{' '}
              {selected.side === 'radiant' ? '天辉' : '夜魇'}
            </b>
            <span>
              {selected.heroName} · {selected.playerName}
            </span>
            <span>比赛 {selected.matchId}</span>
          </div>
        )}
      </div>
      <div className="map-controls">
        <label>
          热力图不透明度{' '}
          <input
            type="range"
            aria-label="热力图不透明度"
            min="0"
            max="100"
            value={opacity}
            onChange={(e) => setOpacity(Number(e.target.value))}
          />
          {opacity}%
        </label>
        {!farming && (
          <label>
            <input type="checkbox" checked={markers} onChange={(e) => setMarkers(e.target.checked)} />
            显示精确眼位
          </label>
        )}
      </div>
    </div>
  );
}
