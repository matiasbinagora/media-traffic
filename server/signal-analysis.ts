export type SignalState = 'red' | 'yellow' | 'green' | 'unknown';

export type SignalColorScores = { red: number; yellow: number; green: number };

export type RawSignalPixelObservation = {
  frameIndex: number;
  timeSeconds: number;
  colorScores: SignalColorScores;
  signalRegionTooSmall?: boolean;
};

export type RawSignalObservation = {
  frameIndex: number;
  timeSeconds: number;
  state: SignalState;
  evidenceScore: number;
  colorScores: SignalColorScores;
  reason?: 'no_clear_lamp' | 'multiple_colors' | 'signal_region_too_small';
};

export type SignalInterval = {
  state: SignalState;
  startFrameIndex: number;
  endFrameExclusive: number;
  startSeconds: number;
  endSeconds: number;
  rationale: 'stable_for_three_consecutive_frames' | 'no_readable_signal' | 'ambiguous_signal' | 'signal_region_too_small' | 'transition_not_stable';
  transitionEvidence?: { supportingFrameIndices: [number, number, number] };
};

export type SignalTimeline = {
  stabilityRule: { method: 'consecutive-decoded-frames'; requiredFrames: 3 };
  observations: RawSignalObservation[];
  intervals: SignalInterval[];
};

export function classifySignalObservation(
  frameIndex: number,
  timeSeconds: number,
  colorScores: SignalColorScores,
  signalRegionTooSmall = false,
): RawSignalObservation {
  const colors: Array<keyof SignalColorScores> = ['red', 'yellow', 'green'];
  if (!Number.isSafeInteger(frameIndex) || frameIndex < 0 || !Number.isFinite(timeSeconds)
    || colors.some(color => !Number.isFinite(colorScores[color]) || colorScores[color] < 0 || colorScores[color] > 1)) {
    throw new Error('Signal pixel evidence must include valid frame, timestamp, and color ratios.');
  }
  const ranked = colors.map(color => ({ color, score: colorScores[color] })).sort((left, right) => right.score - left.score);
  const [leading, runnerUp] = ranked;
  if (signalRegionTooSmall) {
    return { frameIndex, timeSeconds, state: 'unknown', evidenceScore: 0, colorScores, reason: 'signal_region_too_small' };
  }
  if (leading.score < 0.005) {
    return { frameIndex, timeSeconds, state: 'unknown', evidenceScore: leading.score, colorScores, reason: 'no_clear_lamp' };
  }
  if (runnerUp.score >= leading.score * 0.5) {
    return { frameIndex, timeSeconds, state: 'unknown', evidenceScore: leading.score, colorScores, reason: 'multiple_colors' };
  }
  return { frameIndex, timeSeconds, state: leading.color, evidenceScore: leading.score, colorScores };
}

export function assembleSignalTimeline(input: { durationSeconds: number; observations: RawSignalObservation[] }): SignalTimeline {
  if (!Number.isFinite(input.durationSeconds) || input.durationSeconds <= 0 || !Array.isArray(input.observations) || input.observations.length === 0) {
    throw new Error('Signal analysis must include a positive source duration and at least one signal observation.');
  }

  let previousTime = -Infinity;
  for (let index = 0; index < input.observations.length; index += 1) {
    const observation = input.observations[index];
    if (!Number.isSafeInteger(observation.frameIndex) || observation.frameIndex !== index
      || !Number.isFinite(observation.timeSeconds) || observation.timeSeconds <= previousTime
      || observation.timeSeconds >= input.durationSeconds) {
      throw new Error('Signal observations must cover contiguous decoded frames with timestamps within the source duration.');
    }
    if (!['red', 'yellow', 'green', 'unknown'].includes(observation.state)
      || !Number.isFinite(observation.evidenceScore) || observation.evidenceScore < 0 || observation.evidenceScore > 1
      || !['red', 'yellow', 'green'].every(color => {
        const score = observation.colorScores[color as keyof SignalColorScores];
        return Number.isFinite(score) && score >= 0 && score <= 1;
      })
      || (observation.state === 'unknown' && !observation.reason)) {
      throw new Error('Signal observations contain an invalid state, score, confidence, or unknown-state reason.');
    }
    previousTime = observation.timeSeconds;
  }

  const intervals: SignalInterval[] = [];
  let start = 0;
  while (start < input.observations.length) {
    const rawState = input.observations[start].state;
    let end = start + 1;
    while (end < input.observations.length
      && input.observations[end].state === rawState
      && (rawState !== 'unknown' || input.observations[end].reason === input.observations[start].reason)) end += 1;
    const isStableColor = rawState !== 'unknown' && end - start >= 3;
    const state: SignalState = isStableColor ? rawState : 'unknown';
    const rationale = isStableColor
      ? 'stable_for_three_consecutive_frames'
      : rawState !== 'unknown'
        ? 'transition_not_stable'
        : input.observations[start].reason === 'multiple_colors'
          ? 'ambiguous_signal'
          : input.observations[start].reason === 'signal_region_too_small'
            ? 'signal_region_too_small'
            : 'no_readable_signal';
    intervals.push({
      state,
      startFrameIndex: start,
      endFrameExclusive: end,
      startSeconds: input.observations[start].timeSeconds,
      endSeconds: end < input.observations.length ? input.observations[end].timeSeconds : input.durationSeconds,
      rationale,
      ...(isStableColor ? { transitionEvidence: { supportingFrameIndices: [start, start + 1, start + 2] } } : {}),
    });
    start = end;
  }

  return {
    stabilityRule: { method: 'consecutive-decoded-frames', requiredFrames: 3 },
    observations: input.observations,
    intervals,
  };
}
