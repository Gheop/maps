export const TILE = 256;

export function clamp(v, lo, hi) {
  return Math.max(lo, Math.min(hi, v));
}

export function clampLat(lat) {
  return clamp(lat, -85.0511, 85.0511);
}

export function lonToX(lon, z) {
  return (lon + 180) / 360 * TILE * 2 ** z;
}

export function latToY(lat, z) {
  const s = Math.sin(clampLat(lat) * Math.PI / 180);
  return (0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI)) * TILE * 2 ** z;
}

export function xToLon(x, z) {
  return x / (TILE * 2 ** z) * 360 - 180;
}

export function yToLat(y, z) {
  const n = Math.PI - 2 * Math.PI * y / (TILE * 2 ** z);
  return 180 / Math.PI * Math.atan(0.5 * (Math.exp(n) - Math.exp(-n)));
}
