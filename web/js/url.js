// Hash : #calque/zoom/lat/lon. Le calque est optionnel (les vieux liens #zoom/lat/lon restent valides).
export function parseHash(hash) {
  const m = /^#?(?:([a-z]+)\/)?(\d{1,2})\/(-?\d+(?:\.\d+)?)\/(-?\d+(?:\.\d+)?)$/.exec(hash || '');
  if (!m) return null;
  const layer = m[1] || null;
  const zoom = +m[2], lat = +m[3], lon = +m[4];
  if (zoom < 0 || zoom > 20 || lat < -90 || lat > 90 || lon < -180 || lon > 180) return null;
  return { layer, zoom, lat, lon };
}
export function formatHash(layer, zoom, lat, lon) {
  return `#${layer}/${zoom}/${lat.toFixed(5)}/${lon.toFixed(5)}`;
}
