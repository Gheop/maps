export const TILE = 256;
export const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

export function lonToPx(lon, z) {
  return (lon + 180) / 360 * TILE * 2 ** z;
}
export function latToPx(lat, z) {
  const r = lat * Math.PI / 180;
  return (1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2 * TILE * 2 ** z;
}
export function pxToLon(px, z) {
  return px / (TILE * 2 ** z) * 360 - 180;
}
export function pxToLat(px, z) {
  const n = Math.PI - 2 * Math.PI * px / (TILE * 2 ** z);
  return 180 / Math.PI * Math.atan(0.5 * (Math.exp(n) - Math.exp(-n)));
}
