// 像素中心采样，距离为负时位于圆角矩形内部。
export function lensGeometry(width: number, height: number, radius: number, bezelWidth: number) {
  const r = Math.max(0, Math.min(radius, width / 2, height / 2));
  return {
    width,
    height,
    r,
    bezel: Math.max(0, Math.min(bezelWidth, width / 2 - 2, height / 2 - 2)),
  };
}
function surface(u: number) {
  const v = 1 - u,
    base = 1 - v ** 4;
  const slope = v ** 3 / Math.max(1e-4, base ** 0.75);
  const thetaI = Math.atan(slope);
  return { height: base ** 0.25, offset: Math.tan(thetaI - Math.asin(Math.sin(thetaI) / 1.5)) };
}
const maxOffset = surface(0.015).offset;
export function lensPixel(g: ReturnType<typeof lensGeometry>, x: number, y: number) {
  const dx = x + 0.5 - g.width / 2,
    dy = y + 0.5 - g.height / 2;
  const qx = Math.abs(dx) - g.width / 2 + g.r,
    qy = Math.abs(dy) - g.height / 2 + g.r;
  const ax = Math.max(qx, 0),
    ay = Math.max(qy, 0);
  const norm = Math.hypot(ax, ay);
  const inset = g.r - norm - Math.min(Math.max(qx, qy), 0);
  if (inset <= 0 || inset >= g.bezel) return [128, 128, inset > 0 ? 255 : 0, 255];
  const nx = Math.sign(dx) * (norm ? ax / norm : Number(qx >= qy));
  const ny = Math.sign(dy) * (norm ? ay / norm : Number(qy > qx));
  const { height, offset } = surface(Math.max(0.015, inset / g.bezel));
  const rawAmount = Math.min(1, offset / maxOffset);
  const amount = Math.pow(rawAmount, 0.42);
  return [
    Math.round(128 - 127 * amount * nx),
    Math.round(128 - 127 * amount * ny),
    // 255 同时是平顶遮罩的标记，避免接近满高的倒角被提前截断。
    Math.min(254, Math.round(255 * height)),
    255,
  ];
}
