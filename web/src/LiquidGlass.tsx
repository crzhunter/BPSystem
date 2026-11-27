import {
  memo,
  useEffect,
  useId,
  useRef,
  useState,
  type CSSProperties,
  type HTMLAttributes,
} from 'react';
import { lensGeometry, lensPixel } from './glassMath';
export { lensGeometry, lensPixel } from './glassMath';

const images = new Map<string, string>();
function mapImage(width: number, height: number, radius: number, bezel: number) {
  const g = lensGeometry(width, height, radius, bezel);
  const key = `${width}x${height}:r${g.r}:b${g.bezel}`;
  const cached = images.get(key);
  if (cached) return cached;
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) return '';
  const bitmap = ctx.createImageData(width, height);
  // 中央矩形整段填充，只在棱边计算距离与折射角。
  const pixels = new Uint32Array(bitmap.data.buffer);
  pixels.fill(0xffff8080);
  const flatRow = Math.max(g.bezel, g.r);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (y >= flatRow && y < height - flatRow && x >= g.bezel && x < width - g.bezel) {
        x = Math.ceil(width - g.bezel) - 1;
        continue;
      }
      bitmap.data.set(lensPixel(g, x, y), (y * width + x) * 4);
    }
  }
  ctx.putImageData(bitmap, 0, 0);
  const url = canvas.toDataURL();
  if (images.size >= 80) images.delete(images.keys().next().value!);
  images.set(key, url);
  return url;
}

const matrices = [
  '1 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 0 1',
  '0 0 0 0 0  0 1 0 0 0  0 0 0 0 0  0 0 0 0 1',
  '0 0 0 0 0  0 0 0 0 0  0 0 1 0 0  0 0 0 0 1',
];
type MapData = { w: number; h: number; url: string; bezel: number };
const LensFilter = memo(function LensFilter({
  id,
  map,
  scale,
  aberration,
  regular,
}: {
  id: string;
  map: MapData;
  scale: number;
  aberration: number;
  regular: boolean;
}) {
  return (
    <filter
      id={id}
      x="0"
      y="0"
      width={map.w}
      height={map.h}
      filterUnits="userSpaceOnUse"
      primitiveUnits="userSpaceOnUse"
      colorInterpolationFilters="sRGB"
    >
      <feImage
        href={map.url}
        x="0"
        y="0"
        width={map.w}
        height={map.h}
        preserveAspectRatio="none"
        result="map"
      />
      {['R', 'G', 'B'].map((c, i) => (
        <feDisplacementMap
          key={c}
          in="SourceGraphic"
          in2="map"
          scale={scale * [1 + aberration, 1, 1 - aberration][i]}
          xChannelSelector="R"
          yChannelSelector="G"
          result={'shift' + c}
        />
      ))}
      {['R', 'G', 'B'].map((c, i) => (
        <feColorMatrix key={c} in={'shift' + c} values={matrices[i]} result={c} />
      ))}
      <feComposite in="R" in2="G" operator="arithmetic" k2="1" k3="1" result="rg" />
      <feComposite in="rg" in2="B" operator="arithmetic" k2="1" k3="1" result="rgb" />
      <feComposite in="rgb" in2="shiftG" operator="in" result="refracted" />
      <feColorMatrix in="map" values="0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 1 0 0" />
      <feGaussianBlur stdDeviation="1.3" />
      <feSpecularLighting
        surfaceScale={map.bezel * 0.65}
        specularExponent="26"
        lightingColor="#dbe7f5"
      >
        <feDistantLight azimuth="225" elevation="32" />
      </feSpecularLighting>
      <feComposite in2="refracted" operator="arithmetic" k2="0.09" k3="1" result="lit" />
      {/* 平顶独立采样避开 128/255 带来的亚像素漂移。羽化权重互补，相加可避免过渡带变暗。 */}
      <feColorMatrix
        in="map"
        values="0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 255 0 -254"
        result="flat"
      />
      {regular && <feGaussianBlur in="flat" stdDeviation="7" result="flatSoft" />}
      {regular && <feGaussianBlur in="SourceGraphic" stdDeviation="11" result="softCenter" />}
      <feComposite in="lit" in2={regular ? 'flatSoft' : 'flat'} operator="out" result="rim" />
      <feComposite
        in={regular ? 'softCenter' : 'SourceGraphic'}
        in2={regular ? 'flatSoft' : 'flat'}
        operator="in"
        result="center"
      />
      <feComposite in="rim" in2="center" operator="arithmetic" k2="1" k3="1" />
    </filter>
  );
});
export function LiquidGlass({
  regular = false,
  className = '',
  children,
  style,
  ...props
}: HTMLAttributes<HTMLDivElement> & { regular?: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  const id = 'lens-' + useId().replace(/[^a-z0-9_-]/gi, '');
  const [map, setMap] = useState<MapData>();
  useEffect(() => {
    const nav = navigator as Navigator & { userAgentData?: { brands: { brand: string }[] } };
    if (
      !nav.userAgentData?.brands.some((v) => /Chromium|Edge|Chrome/.test(v.brand)) &&
      !/Chrome|Chromium|Edg\//.test(nav.userAgent)
    )
      return;
    const node = ref.current!;
    let frame = 0;
    const observer = new ResizeObserver(() => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        if (!node.offsetWidth || !node.offsetHeight) return;
        const w = node.offsetWidth,
          h = node.offsetHeight;
        const qw = Math.max(4, Math.round(w / 4) * 4),
          qh = Math.max(4, Math.round(h / 4) * 4);
        const radius = regular ? 32 : qh / 2,
          bezel = regular ? 38 : 14;
        const url = mapImage(qw, qh, radius, bezel);
        setMap((old) =>
          old?.w === w && old.h === h && old.url === url
            ? old
            : { w, h, url, bezel: lensGeometry(qw, qh, radius, bezel).bezel },
        );
      });
    });
    observer.observe(node);
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
    };
  }, [regular]);
  const scale = regular ? 86 : 38;
  const aberration = regular ? 0.22 : 0.18;
  const prefilter = regular
    ? 'blur(1.2px) saturate(185%) brightness(1.06)'
    : 'blur(1px) saturate(175%) brightness(1.06)';
  return (
    <div
      {...props}
      ref={ref}
      className={'liquid ' + (regular ? 'regular ' : '') + className}
      style={style}
    >
      <span className="lens-base" aria-hidden="true" />
      <span
        className={'lens-surface' + (map?.url ? '' : ' fallback')}
        aria-hidden="true"
        style={
          map?.url
            ? ({ '--lens-filter': prefilter + ' url(#' + id + ')' } as CSSProperties)
            : undefined
        }
      />
      <span className="lens-rim" aria-hidden="true" />
      {map && (
        <svg className="lens-defs" width="0" height="0" aria-hidden="true">
          <defs>
            <LensFilter id={id} map={map} scale={scale} aberration={aberration} regular={regular} />
          </defs>
        </svg>
      )}
      {children}
    </div>
  );
}
