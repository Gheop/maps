import { test } from 'node:test';
import assert from 'node:assert/strict';
import { TILE, lonToX, latToY, xToLon, yToLat, clampLat, clamp } from '../web/js/tilemath.js';

test('TILE is 256', () => assert.equal(TILE, 256));

test('lon/lat to world px at z0 centers at 128', () => {
  assert.ok(Math.abs(lonToX(0, 0) - 128) < 1e-9);
  assert.ok(Math.abs(latToY(0, 0) - 128) < 1e-9);
});

test('lon round trips', () => {
  for (const lon of [-180, -73.5, 0, 2.35, 180]) {
    assert.ok(Math.abs(xToLon(lonToX(lon, 5), 5) - lon) < 1e-6);
  }
});

test('lat round trips within mercator range', () => {
  for (const lat of [-80, -45.2, 0, 45.83, 80]) {
    assert.ok(Math.abs(yToLat(latToY(lat, 5), 5) - lat) < 1e-6);
  }
});

test('clampLat bounds to mercator limit', () => {
  assert.ok(Math.abs(clampLat(90) - 85.0511) < 1e-3);
  assert.ok(Math.abs(clampLat(-90) + 85.0511) < 1e-3);
  assert.equal(clampLat(10), 10);
});

test('clamp', () => {
  assert.equal(clamp(5, 0, 10), 5);
  assert.equal(clamp(-1, 0, 10), 0);
  assert.equal(clamp(11, 0, 10), 10);
});
