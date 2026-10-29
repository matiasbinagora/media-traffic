import assert from 'node:assert/strict';
import { test } from 'node:test';
import { assembleSignalTimeline, classifySignalObservation, type RawSignalObservation } from './signal-analysis.js';

function observation(frameIndex: number, state: RawSignalObservation['state']): RawSignalObservation {
  return {
    frameIndex,
    timeSeconds: frameIndex / 10,
    state,
    evidenceScore: state === 'unknown' ? 0 : 0.03,
    colorScores: { red: state === 'red' ? 0.03 : 0, yellow: state === 'yellow' ? 0.03 : 0, green: state === 'green' ? 0.03 : 0 },
    ...(state === 'unknown' ? { reason: 'no_clear_lamp' as const } : {}),
  };
}

test('classifies clear HSV pixel ratios and leaves absent or competing colors unknown', () => {
  assert.equal(classifySignalObservation(0, 0, { red: 0.03, yellow: 0, green: 0 }).state, 'red');
  assert.equal(classifySignalObservation(1, 0.1, { red: 0, yellow: 0.03, green: 0 }).state, 'yellow');
  assert.equal(classifySignalObservation(2, 0.2, { red: 0, yellow: 0, green: 0.03 }).state, 'green');
  assert.equal(classifySignalObservation(3, 0.3, { red: 0.004, yellow: 0, green: 0 }).reason, 'no_clear_lamp');
  assert.equal(classifySignalObservation(3, 0.3, { red: 0.004, yellow: 0, green: 0 }).evidenceScore, 0.004);
  assert.equal(classifySignalObservation(4, 0.4, { red: 0.03, yellow: 0.016, green: 0 }).reason, 'multiple_colors');
  assert.equal(classifySignalObservation(4, 0.4, { red: 0.03, yellow: 0.016, green: 0 }).evidenceScore, 0.03);
  assert.equal(classifySignalObservation(5, 0.5, { red: 0, yellow: 0, green: 0 }, true).reason, 'signal_region_too_small');
  assert.equal(classifySignalObservation(5, 0.5, { red: 0, yellow: 0, green: 0 }, true).evidenceScore, 0);
});

test('retains observations and confirms color intervals only after three consecutive frames', () => {
  const result = assembleSignalTimeline({
    durationSeconds: 0.7,
    observations: [
      observation(0, 'red'), observation(1, 'red'), observation(2, 'red'),
      observation(3, 'unknown'), observation(4, 'green'), observation(5, 'green'), observation(6, 'green'),
    ],
  });

  assert.equal(result.observations.length, 7);
  assert.deepEqual(result.intervals.map(interval => [interval.state, interval.startFrameIndex, interval.endFrameExclusive]), [
    ['red', 0, 3], ['unknown', 3, 4], ['green', 4, 7],
  ]);
  assert.deepEqual(result.intervals[0].transitionEvidence?.supportingFrameIndices, [0, 1, 2]);
  assert.equal(result.intervals[0].rationale, 'stable_for_three_consecutive_frames');
  assert.equal(result.intervals[1].rationale, 'no_readable_signal');
  assert.deepEqual(result.stabilityRule, { method: 'consecutive-decoded-frames', requiredFrames: 3 });
});

test('keeps a brief color flash unknown instead of promoting it to a signal phase', () => {
  const result = assembleSignalTimeline({
    durationSeconds: 0.5,
    observations: [observation(0, 'red'), observation(1, 'red'), observation(2, 'unknown'), observation(3, 'green'), observation(4, 'green')],
  });

  assert.ok(result.intervals.every(interval => interval.state === 'unknown'));
  assert.deepEqual(result.intervals.map(interval => interval.rationale), [
    'transition_not_stable', 'no_readable_signal', 'transition_not_stable',
  ]);
  assert.equal(result.observations[0].state, 'red', 'raw evidence remains available when the stable interval is unknown');
});

test('keeps adjacent unknown intervals separate when their rationales differ', () => {
  const noReadableSignal = { ...observation(0, 'unknown'), reason: 'no_clear_lamp' as const };
  const ambiguousSignal = { ...observation(1, 'unknown'), reason: 'multiple_colors' as const };
  const tooSmallSignal = { ...observation(2, 'unknown'), reason: 'signal_region_too_small' as const };
  const result = assembleSignalTimeline({
    durationSeconds: 0.3,
    observations: [noReadableSignal, ambiguousSignal, tooSmallSignal],
  });

  assert.deepEqual(result.intervals.map(interval => [interval.state, interval.rationale]), [
    ['unknown', 'no_readable_signal'],
    ['unknown', 'ambiguous_signal'],
    ['unknown', 'signal_region_too_small'],
  ]);
});

test('rejects missing, reordered, or out-of-duration signal samples', () => {
  assert.throws(() => assembleSignalTimeline({ durationSeconds: 1, observations: [] }), /at least one signal observation/);
  assert.throws(() => assembleSignalTimeline({ durationSeconds: 1, observations: [observation(0, 'red'), observation(2, 'red')] }), /contiguous decoded frames/);
  assert.throws(() => assembleSignalTimeline({ durationSeconds: 1, observations: [observation(0, 'red'), { ...observation(1, 'red'), timeSeconds: 1 }] }), /within the source duration/);
});

test('preserves valid negative source presentation timestamps', () => {
  const result = assembleSignalTimeline({
    durationSeconds: 0.2,
    observations: [
      { ...observation(0, 'red'), timeSeconds: -0.04 },
      { ...observation(1, 'red'), timeSeconds: 0 },
      { ...observation(2, 'red'), timeSeconds: 0.04 },
    ],
  });

  assert.equal(result.intervals[0].startSeconds, -0.04);
  assert.equal(result.intervals[0].endSeconds, 0.2);
});
