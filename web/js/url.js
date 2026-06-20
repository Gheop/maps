export function parseHash(hash) {
  const m = /^#?(\d{1,2})\/(-?\d+(?:\.\d+)?)\/(-?\d+(?:\.\d+)?)$/.exec(hash || '');
  if (!m) return null;
  const zoom = +m[1], lat = +m[2], lon = +m[3];
  if (zoom < 0 || zoom > 20 || lat < -90 || lat > 90 || lon < -180 || lon > 180) return null;
  return { zoom, lat, lon };
}
export function formatHash(zoom, lat, lon) {
  return `#${zoom}/${lat.toFixed(5)}/${lon.toFixed(5)}`;
}
