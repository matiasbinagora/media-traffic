import assert from 'node:assert/strict';
import { test } from 'node:test';
import { assembleTrackResult } from './traffic-analysis.js';
import { assessCrossingEvents } from './crossing-analysis.js';
import type { SceneConfigurationSnapshot } from './scene-configuration.js';
import type { SignalTimeline } from './signal-analysis.js';

const configuration: SceneConfigurationSnapshot = {
  schemaVersion: 1,
  id: 'configuration-1',
  source: { videoId: 'video-1', sha256: 'a'.repeat(64), width: 100, height: 100 },
  geometry: {
    vehicleRegion: { x: 0, y: 0, width: 1, height: 1 },
    stopLine: { start: { x: 0.2, y: 0.5 }, end: { x: 0.8, y: 0.5 } },
    crossingDirection: 'top-to-bottom',
    signalRegion: { x: 0.8, y: 0, width: 0.2, height: 0.2 },
    signalAssociation: 'signal-1',
  },
  createdAt: '2026-11-02T00:00:00.000Z',
};

function timeline(input: { state?: 'red' | 'green' | 'yellow' | 'unknown'; start?: number; end?: number } = {}): SignalTimeline {
  const state = input.state ?? 'red';
  const startSeconds = input.start ?? 0;
  const endSeconds = input.end ?? 1;
  const rationale = state === 'unknown' ? 'ambiguous_signal' : 'stable_for_three_consecutive_frames';
  return {
    stabilityRule: { method: 'consecutive-decoded-frames', requiredFrames: 3 },
    observations: [],
    intervals: [{
      state,
      startFrameIndex: 0,
      endFrameExclusive: 30,
      startSeconds,
      endSeconds,
      rationale,
      ...(state === 'unknown' ? {} : { transitionEvidence: { supportingFrameIndices: [0, 1, 2] } }),
    }],
  };
}

function assess(input: {
  frames: Array<{ frameIndex: number; timeSeconds: number; detections: Array<{ trackId: string; box: [number, number, number, number]; confidence: number }> }>;
  signal?: SignalTimeline;
}) {
  const trackResult = assembleTrackResult({ width: 100, height: 100, frames: input.frames });
  return assessCrossingEvents({ trackResult, configuration, signalTimeline: input.signal ?? timeline() });
}

const upstream = [40, 35, 50, 45] as [number, number, number, number];
const downstream = [40, 55, 50, 65] as [number, number, number, number];
const crossingFrames = (before = upstream, after = downstream, confidence = 0.8) => [
  { frameIndex: 0, timeSeconds: 0, detections: [{ trackId: 'car-1', box: before, confidence }] },
  { frameIndex: 1, timeSeconds: 1 / 30, detections: [{ trackId: 'car-1', box: after, confidence }] },
];

test('confirms one red crossing at interpolated source PTS with explainable observations', () => {
  const result = assess({ frames: crossingFrames() });
  assert.equal(result.length, 1);
  assert.equal(result[0].outcome, 'candidate');
  assert.equal(result[0].reason, 'confirmed_red_crossing');
  assert.ok(Math.abs(result[0].crossingTimeSeconds! - 1 / 120) < 0.000001);
  assert.deepEqual(result[0].observations.map(item => item.referencePoint), [{ x: 45, y: 45 }, { x: 45, y: 65 }]);
  assert.equal(result[0].signalEvidence.state, 'red');
});

test('returns indeterminate for low confidence, missing frames, and oversized adjacent PTS gap', () => {
  assert.equal(assess({ frames: crossingFrames(upstream, downstream, 0.24) })[0].reason, 'low_detection_confidence');
  assert.equal(assess({ frames: crossingFrames(upstream, downstream, 0.25) })[0].outcome, 'candidate');
  const missing = crossingFrames();
  missing[1] = { ...missing[1], frameIndex: 2, timeSeconds: 2 / 30 };
  assert.equal(assess({ frames: missing })[0].reason, 'tracking_gap');
  const delayed = crossingFrames();
  delayed[1] = { ...delayed[1], timeSeconds: 0.04 };
  assert.equal(assess({ frames: delayed })[0].reason, 'tracking_gap');
});

test('never confirms an event if signal is green, yellow, unknown, or changes during crossing', () => {
  assert.equal(assess({ frames: crossingFrames(), signal: timeline({ state: 'green' }) })[0].outcome, 'not_candidate');
  const yellow = assess({ frames: crossingFrames(), signal: timeline({ state: 'yellow' }) })[0];
  assert.equal(yellow.outcome, 'indeterminate');
  assert.equal(yellow.reason, 'signal_not_red');
  assert.equal(assess({ frames: crossingFrames(), signal: timeline({ state: 'unknown' }) })[0].reason, 'signal_unknown_or_ambiguous');
  const redThenGreen: SignalTimeline = {
    ...timeline(),
    intervals: [
      { ...timeline().intervals[0], startSeconds: 0, endSeconds: 0.01 },
      { ...timeline({ state: 'green' }).intervals[0], startSeconds: 0.01, endSeconds: 1 },
    ],
  };
  assert.equal(assess({ frames: crossingFrames(), signal: redThenGreen })[0].reason, 'signal_transition');
});

test('excludes reverse movement, stopped vehicles, and finite-line misses while accepting endpoint tolerance', () => {
  const reverse = assess({ frames: crossingFrames(downstream, upstream) });
  assert.equal(reverse[0].outcome, 'not_candidate');
  assert.equal(reverse[0].reason, 'opposite_direction');
  assert.equal(assess({ frames: [crossingFrames()[0], { ...crossingFrames()[0], frameIndex: 1, timeSeconds: 1 / 30 }] }).length, 0);
  const outside = assess({ frames: crossingFrames([85, 35, 95, 45], [85, 55, 95, 65]) });
  assert.equal(outside[0].reason, 'outside_stop_line_segment');
  const endpointWithinTolerance = assess({ frames: crossingFrames([15, 35, 25, 45], [15, 55, 25, 65]) });
  assert.equal(endpointWithinTolerance[0].outcome, 'candidate');
  const endpointTolerance = assess({ frames: crossingFrames([14, 35, 24, 45], [14, 55, 24, 65]) });
  assert.equal(endpointTolerance[0].outcome, 'candidate', 'a crossing point one source pixel outside the endpoint remains included');
  const beyondEndpointTolerance = assess({ frames: crossingFrames([13, 35, 23, 45], [13, 55, 23, 65]) });
  assert.equal(beyondEndpointTolerance[0].reason, 'outside_stop_line_segment');
});

test('suppresses 1px jitter, preserves line-contact uncertainty, and marks likely identity switches indeterminate', () => {
  const jitter = assess({ frames: crossingFrames([10, 40, 20, 50], [10, 41, 20, 51]) });
  assert.equal(jitter.length, 0);
  const contact = assess({ frames: [crossingFrames()[0], { ...crossingFrames()[0], frameIndex: 1, timeSeconds: 1 / 30, detections: [{ trackId: 'car-1', box: [10, 40, 20, 50], confidence: 0.8 }] }] });
  assert.equal(contact[0].reason, 'insufficient_trajectory');
  const switched = assess({ frames: [
    { frameIndex: 0, timeSeconds: 0, detections: [{ trackId: 'car-a', box: [40, 15, 50, 45], confidence: 0.8 }] },
    { frameIndex: 1, timeSeconds: 1 / 30, detections: [{ trackId: 'car-b', box: [40, 35, 50, 65], confidence: 0.8 }] },
  ] });
  assert.ok(switched.some(item => item.reason === 'possible_identity_switch' && item.outcome === 'indeterminate'));
});
