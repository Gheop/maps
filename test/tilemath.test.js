import { test } from 'node:test';
import assert from 'node:assert/strict';
import { TILE, lonToPx, latToPx, pxToLon, pxToLat, clamp } from '../web/js/tilemath.js';

test('TILE = 256', () => assert.equal(TILE, 256));
test('centre du monde au z0 = 128px', () => {
  assert.ok(Math.abs(lonToPx(0, 0) - 128) < 1e-9);
  assert.ok(Math.abs(latToPx(0, 0) - 128) < 1e-9);
});
test('lon aller-retour', () => {
  for (const lon of [-180, -73.5, 0, 2.35, 180]) assert.ok(Math.abs(pxToLon(lonToPx(lon, 5), 5) - lon) < 1e-6);
});
test('lat aller-retour', () => {
  for (const lat of [-80, -45.2, 0, 45.83, 80]) assert.ok(Math.abs(pxToLat(latToPx(lat, 5), 5) - lat) < 1e-6);
});
test('clamp', () => {
  assert.equal(clamp(5, 0, 10), 5);
  assert.equal(clamp(-1, 0, 10), 0);
  assert.equal(clamp(11, 0, 10), 10);
});
