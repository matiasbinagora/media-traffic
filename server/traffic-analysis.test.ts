import assert from 'node:assert/strict';
import { test } from 'node:test';
import { assembleTrackResult } from './traffic-analysis.js';

test('retains concurrent track identities and every timestamped observation', () => {
  const result = assembleTrackResult({
    width: 1920,
    height: 1080,
    frames: [
      { frameIndex: 0, timeSeconds: 0, detections: [
        { trackId: 11, box: [100, 200, 300, 400], confidence: 0.91 },
        { trackId: 12, box: [600, 220, 900, 420], confidence: 0.82 },
      ] },
      { frameIndex: 1, timeSeconds: 0.04, detections: [
        { trackId: 11, box: [102, 202, 302, 402], confidence: 0.88 },
        { trackId: 12, box: [604, 222, 904, 422], confidence: 0.86 },
      ] },
    ],
  });

  assert.deepEqual(result.tracks.map(track => track.trackId), ['11', '12']);
  assert.equal(result.tracks[0].observations.length, 2);
  assert.equal(result.tracks[1].observations.length, 2);
  assert.deepEqual(result.tracks[0].observations[1], {
    frameIndex: 1,
    timeSeconds: 0.04,
    frameWidth: 1920,
    frameHeight: 1080,
    box: { x: 102, y: 202, width: 200, height: 200 },
    normalizedBox: { x: 102 / 1920, y: 202 / 1080, width: 200 / 1920, height: 200 / 1080 },
    confidence: 0.88,
    state: 'observed',
  });
});

test('records missing-frame gaps without inventing interpolated boxes', () => {
  const result = assembleTrackResult({
    width: 320,
    height: 240,
    frames: [
      { frameIndex: 4, timeSeconds: 0.4, detections: [{ trackId: 'car-1', box: [10, 20, 50, 80], confidence: 0.8 }] },
      { frameIndex: 5, timeSeconds: 0.5, detections: [] },
      { frameIndex: 6, timeSeconds: 0.6, detections: [] },
      { frameIndex: 7, timeSeconds: 0.7, detections: [{ trackId: 'car-1', box: [13, 20, 53, 80], confidence: 0.83 }] },
    ],
  });

  assert.equal(result.tracks[0].observations.length, 2);
  assert.deepEqual(result.tracks[0].gaps, [{
    afterFrameIndex: 4,
    beforeFrameIndex: 7,
    missingFrameCount: 2,
    startSeconds: 0.4,
    endSeconds: 0.7,
    reason: 'not_observed',
    identityContinuity: 'unverified',
  }]);
});

test('links spatially plausible adjacent track fragments as uncertain while preserving distinct IDs', () => {
  const result = assembleTrackResult({
    width: 320,
    height: 240,
    frames: [
      { frameIndex: 0, timeSeconds: 0, detections: [
        { trackId: 'car-1a', box: [10, 20, 50, 80], confidence: 0.8 },
        { trackId: 'car-2', box: [220, 20, 280, 80], confidence: 0.9 },
      ] },
      { frameIndex: 1, timeSeconds: 0.1, detections: [
        { trackId: 'car-2', box: [220, 21, 280, 81], confidence: 0.9 },
      ] },
      { frameIndex: 2, timeSeconds: 0.2, detections: [
        { trackId: 'car-1b', box: [60, 20, 100, 80], confidence: 0.82 },
        { trackId: 'car-2', box: [220, 22, 280, 82], confidence: 0.9 },
      ] },
    ],
  });

  assert.deepEqual(result.tracks.map(track => track.trackId), ['car-1a', 'car-1b', 'car-2']);
  assert.deepEqual(result.possibleIdentitySwitches, [{
    fromTrackId: 'car-1a',
    toTrackId: 'car-1b',
    fromFrameIndex: 0,
    toFrameIndex: 2,
    fromTimeSeconds: 0,
    toTimeSeconds: 0.2,
    spatialEvidence: 'nearby',
    identityContinuity: 'unverified',
  }]);
});

test('preserves valid negative source presentation timestamps', () => {
  const result = assembleTrackResult({
    width: 320,
    height: 240,
    frames: [
      { frameIndex: 0, timeSeconds: -0.04, detections: [{ trackId: 'car-1', box: [10, 20, 50, 80], confidence: 0.8 }] },
      { frameIndex: 1, timeSeconds: 0, detections: [{ trackId: 'car-1', box: [11, 20, 51, 80], confidence: 0.8 }] },
    ],
  });

  assert.equal(result.tracks[0].observations[0].timeSeconds, -0.04);
});

test('rejects malformed and non-monotonic detector output instead of fabricating a trajectory', () => {
  assert.throws(() => assembleTrackResult({ width: 320, height: 240, frames: [
    { frameIndex: 1, timeSeconds: 0.1, detections: [{ trackId: 1, box: [10, 10, 50, 50], confidence: 0.8 }] },
    { frameIndex: 0, timeSeconds: 0, detections: [] },
  ] }), /strictly increasing/);
  assert.throws(() => assembleTrackResult({ width: 320, height: 240, frames: [
    { frameIndex: 0, timeSeconds: 0, detections: [{ trackId: 1, box: [40, 10, 30, 50], confidence: 0.8 }] },
  ] }), /valid box/);
});
