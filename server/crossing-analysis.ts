import type { CarTrajectory, TrackResult, TrackObservation } from './traffic-analysis.js';
import type { SceneConfigurationSnapshot, SceneGeometry } from './scene-configuration.js';
import type { SignalInterval, SignalState, SignalTimeline } from './signal-analysis.js';

const MIN_CAR_CONFIDENCE = 0.25;
const MAX_FRAME_INTERVAL_SECONDS = 1 / 30 + 0.000001;
const GEOMETRY_TOLERANCE_PIXELS = 1;
const RECROSS_REARM_DISTANCE_PIXELS = 3;
const RECROSS_REARM_REQUIRED_FRAMES = 2;

export type CrossingAssessmentOutcome = 'candidate' | 'indeterminate' | 'not_candidate';
export type CrossingAssessmentReason =
  | 'confirmed_red_crossing'
  | 'outside_stop_line_segment'
  | 'opposite_direction'
  | 'tracking_gap'
  | 'possible_identity_switch'
  | 'low_detection_confidence'
  | 'signal_not_red'
  | 'signal_transition'
  | 'signal_unknown_or_ambiguous'
  | 'insufficient_signal_evidence'
  | 'insufficient_trajectory';

export type CrossingObservationEvidence = {
  frameIndex: number;
  timeSeconds: number;
  confidence: number;
  box: { x: number; y: number; width: number; height: number };
  referencePoint: { x: number; y: number };
};

export type CrossingAssessment = {
  configurationId: string;
  trackId: string;
  relatedTrackIds?: string[];
  outcome: CrossingAssessmentOutcome;
  reason: CrossingAssessmentReason;
  crossingTimeSeconds?: number;
  timeRange: { startSeconds: number; endSeconds: number };
  frameRange: { startFrameIndex: number; endFrameIndex: number };
  observations: CrossingObservationEvidence[];
  signalEvidence: {
    state: SignalState | 'unavailable';
    interval?: Pick<SignalInterval, 'startFrameIndex' | 'endFrameExclusive' | 'startSeconds' | 'endSeconds' | 'rationale' | 'transitionEvidence'>;
  };
};

type Point = { x: number; y: number };
type Direction = SceneGeometry['crossingDirection'];
type Projection = { point: Point; signedDistancePixels: number; alongSegmentPixels: number };

function directionVector(direction: Direction): Point {
  switch (direction) {
    case 'top-to-bottom': return { x: 0, y: 1 };
    case 'bottom-to-top': return { x: 0, y: -1 };
    case 'left-to-right': return { x: 1, y: 0 };
    case 'right-to-left': return { x: -1, y: 0 };
  }
}

function referencePoint(observation: TrackObservation, direction: Direction): Point {
  const { x, y, width, height } = observation.box;
  switch (direction) {
    case 'top-to-bottom': return { x: x + width / 2, y: y + height };
    case 'bottom-to-top': return { x: x + width / 2, y };
    case 'left-to-right': return { x: x + width, y: y + height / 2 };
    case 'right-to-left': return { x, y: y + height / 2 };
  }
}

function dot(left: Point, right: Point): number {
  return left.x * right.x + left.y * right.y;
}

function lineProjection(
  point: Point,
  geometry: SceneGeometry,
  frameWidth: number,
  frameHeight: number,
): Projection | undefined {
  const start = { x: geometry.stopLine.start.x * frameWidth, y: geometry.stopLine.start.y * frameHeight };
  const end = { x: geometry.stopLine.end.x * frameWidth, y: geometry.stopLine.end.y * frameHeight };
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const length = Math.hypot(dx, dy);
  if (length === 0) return undefined;
  const normal = { x: -dy / length, y: dx / length };
  const travel = directionVector(geometry.crossingDirection);
  const orientation = dot(travel, normal);
  if (Math.abs(orientation) < 0.000001) return undefined;
  const relative = { x: point.x - start.x, y: point.y - start.y };
  const sign = Math.sign(orientation);
  return {
    point,
    // By convention, the allowed upstream side is negative and downstream is positive.
    signedDistancePixels: dot(relative, normal) * sign,
    alongSegmentPixels: dot(relative, { x: dx / length, y: dy / length }),
  };
}

function crossingPoint(before: Projection, after: Projection, beforeTime: number, afterTime: number): { point: Point; timeSeconds: number } {
  const denominator = after.signedDistancePixels - before.signedDistancePixels;
  const fraction = Math.abs(denominator) < 0.000001
    ? 0
    : Math.max(0, Math.min(1, -before.signedDistancePixels / denominator));
  return {
    point: {
      x: before.point.x + (after.point.x - before.point.x) * fraction,
      y: before.point.y + (after.point.y - before.point.y) * fraction,
    },
    timeSeconds: beforeTime + (afterTime - beforeTime) * fraction,
  };
}

function signalForBracket(timeline: SignalTimeline, startSeconds: number, endSeconds: number): {
  outcome: 'red' | 'non_red' | 'transition' | 'unknown' | 'unavailable';
  evidence: CrossingAssessment['signalEvidence'];
} {
  if (!Number.isFinite(startSeconds) || !Number.isFinite(endSeconds) || endSeconds < startSeconds || timeline.intervals.length === 0) {
    return { outcome: 'unavailable', evidence: { state: 'unavailable' } };
  }
  const overlapping = timeline.intervals.filter(interval => interval.endSeconds > startSeconds && interval.startSeconds <= endSeconds);
  if (overlapping.length === 0) return { outcome: 'unavailable', evidence: { state: 'unavailable' } };
  const covering = overlapping.length === 1
    && overlapping[0].startSeconds <= startSeconds
    && overlapping[0].endSeconds >= endSeconds;
  if (covering && overlapping[0].state === 'red' && overlapping[0].rationale === 'stable_for_three_consecutive_frames') {
    return {
      outcome: 'red',
      evidence: {
        state: 'red',
        interval: {
          startFrameIndex: overlapping[0].startFrameIndex,
          endFrameExclusive: overlapping[0].endFrameExclusive,
          startSeconds: overlapping[0].startSeconds,
          endSeconds: overlapping[0].endSeconds,
          rationale: overlapping[0].rationale,
          transitionEvidence: overlapping[0].transitionEvidence,
        },
      },
    };
  }
  if (overlapping.some(interval => interval.state === 'unknown')) {
    return { outcome: 'unknown', evidence: { state: 'unknown', ...(overlapping.length === 1 ? { interval: overlapping[0] } : {}) } };
  }
  if (!covering || overlapping.some(interval => interval.rationale !== 'stable_for_three_consecutive_frames')) {
    return { outcome: 'transition', evidence: { state: overlapping[0].state, ...(overlapping.length === 1 ? { interval: overlapping[0] } : {}) } };
  }
  return {
    outcome: 'non_red',
    evidence: { state: overlapping[0].state, interval: overlapping[0] },
  };
}

function observationEvidence(observation: TrackObservation, geometry: SceneGeometry): CrossingObservationEvidence {
  return {
    frameIndex: observation.frameIndex,
    timeSeconds: observation.timeSeconds,
    confidence: observation.confidence,
    box: { ...observation.box },
    referencePoint: referencePoint(observation, geometry.crossingDirection),
  };
}

function baseAssessment(input: {
  configuration: SceneConfigurationSnapshot;
  trackId: string;
  relatedTrackIds?: string[];
  before: TrackObservation;
  after: TrackObservation;
  geometry: SceneGeometry;
  outcome: CrossingAssessmentOutcome;
  reason: CrossingAssessmentReason;
  crossingTimeSeconds?: number;
  signalEvidence?: CrossingAssessment['signalEvidence'];
}): CrossingAssessment {
  return {
    configurationId: input.configuration.id,
    trackId: input.trackId,
    ...(input.relatedTrackIds ? { relatedTrackIds: input.relatedTrackIds } : {}),
    outcome: input.outcome,
    reason: input.reason,
    ...(input.crossingTimeSeconds !== undefined ? { crossingTimeSeconds: input.crossingTimeSeconds } : {}),
    timeRange: { startSeconds: input.before.timeSeconds, endSeconds: input.after.timeSeconds },
    frameRange: { startFrameIndex: input.before.frameIndex, endFrameIndex: input.after.frameIndex },
    observations: [observationEvidence(input.before, input.geometry), observationEvidence(input.after, input.geometry)],
    signalEvidence: input.signalEvidence || { state: 'unavailable' },
  };
}

function crossingPotential(before: Projection, after: Projection): boolean {
  // The 1px deadband suppresses box jitter. A point at the line only becomes a
  // crossing after a later adjacent observation confirms downstream movement.
  return before.signedDistancePixels <= GEOMETRY_TOLERANCE_PIXELS
    && after.signedDistancePixels > GEOMETRY_TOLERANCE_PIXELS;
}

function reverseCrossingPotential(before: Projection, after: Projection): boolean {
  return before.signedDistancePixels > GEOMETRY_TOLERANCE_PIXELS
    && after.signedDistancePixels < -GEOMETRY_TOLERANCE_PIXELS;
}

function assessPair(input: {
  configuration: SceneConfigurationSnapshot;
  trackId: string;
  relatedTrackIds?: string[];
  before: TrackObservation;
  after: TrackObservation;
  beforeProjection: Projection;
  afterProjection: Projection;
  geometry: SceneGeometry;
  timeline: SignalTimeline;
  frameWidth: number;
  frameHeight: number;
  reasonOverride?: CrossingAssessmentReason;
  oppositeDirection?: boolean;
}): CrossingAssessment {
  const crossing = crossingPoint(input.beforeProjection, input.afterProjection, input.before.timeSeconds, input.after.timeSeconds);
  const along = input.beforeProjection.alongSegmentPixels
    + (input.afterProjection.alongSegmentPixels - input.beforeProjection.alongSegmentPixels)
      * (input.afterProjection.signedDistancePixels === input.beforeProjection.signedDistancePixels
        ? 0
        : Math.max(0, Math.min(1, -input.beforeProjection.signedDistancePixels
          / (input.afterProjection.signedDistancePixels - input.beforeProjection.signedDistancePixels))));
  if (along < -GEOMETRY_TOLERANCE_PIXELS
    || along > Math.hypot(
      (input.geometry.stopLine.end.x - input.geometry.stopLine.start.x) * input.frameWidth,
      (input.geometry.stopLine.end.y - input.geometry.stopLine.start.y) * input.frameHeight,
    ) + GEOMETRY_TOLERANCE_PIXELS) {
    return baseAssessment({
      ...input,
      outcome: 'not_candidate',
      reason: 'outside_stop_line_segment',
      crossingTimeSeconds: crossing.timeSeconds,
    });
  }
  if (input.oppositeDirection) {
    return baseAssessment({
      ...input,
      outcome: 'not_candidate',
      reason: 'opposite_direction',
      crossingTimeSeconds: crossing.timeSeconds,
    });
  }
  if (input.reasonOverride) {
    return baseAssessment({
      ...input,
      outcome: 'indeterminate',
      reason: input.reasonOverride,
      crossingTimeSeconds: crossing.timeSeconds,
    });
  }

  const frameDelta = input.after.frameIndex - input.before.frameIndex;
  const timeDelta = input.after.timeSeconds - input.before.timeSeconds;
  if (frameDelta !== 1 || timeDelta <= 0 || timeDelta > MAX_FRAME_INTERVAL_SECONDS) {
    return baseAssessment({
      ...input,
      outcome: 'indeterminate',
      reason: 'tracking_gap',
      crossingTimeSeconds: crossing.timeSeconds,
    });
  }
  if (input.before.confidence < MIN_CAR_CONFIDENCE || input.after.confidence < MIN_CAR_CONFIDENCE) {
    return baseAssessment({
      ...input,
      outcome: 'indeterminate',
      reason: 'low_detection_confidence',
      crossingTimeSeconds: crossing.timeSeconds,
    });
  }

  const signal = signalForBracket(input.timeline, input.before.timeSeconds, input.after.timeSeconds);
  if (signal.outcome === 'red') {
    return baseAssessment({
      ...input,
      outcome: 'candidate',
      reason: 'confirmed_red_crossing',
      crossingTimeSeconds: crossing.timeSeconds,
      signalEvidence: signal.evidence,
    });
  }
  if (signal.outcome === 'non_red') {
    if (signal.evidence.state === 'yellow') {
      return baseAssessment({
        ...input,
        outcome: 'indeterminate',
        reason: 'signal_not_red',
        crossingTimeSeconds: crossing.timeSeconds,
        signalEvidence: signal.evidence,
      });
    }
    return baseAssessment({
      ...input,
      outcome: 'not_candidate',
      reason: 'signal_not_red',
      crossingTimeSeconds: crossing.timeSeconds,
      signalEvidence: signal.evidence,
    });
  }
  return baseAssessment({
    ...input,
    outcome: 'indeterminate',
    reason: signal.outcome === 'unknown'
      ? 'signal_unknown_or_ambiguous'
      : signal.outcome === 'transition'
        ? 'signal_transition'
        : 'insufficient_signal_evidence',
    crossingTimeSeconds: crossing.timeSeconds,
    signalEvidence: signal.evidence,
  });
}

function findTrackCrossings(input: {
  track: CarTrajectory;
  trackResult: TrackResult;
  configuration: SceneConfigurationSnapshot;
  timeline: SignalTimeline;
}): CrossingAssessment[] {
  const { track, trackResult, configuration, timeline } = input;
  const geometry = configuration.geometry;
  const observations = track.observations;
  if (observations.length < 2) return [];
  const projections = observations.map(observation => lineProjection(
    referencePoint(observation, geometry.crossingDirection),
    geometry,
    trackResult.frameWidth,
    trackResult.frameHeight,
  ));
  if (projections.some(projection => projection === undefined)) return [];
  const validProjections = projections as Projection[];
  const assessments: CrossingAssessment[] = [];
  let armed = validProjections[0].signedDistancePixels < -GEOMETRY_TOLERANCE_PIXELS;
  let awaitingClearUpstream = false;
  let clearUpstreamFrameCount = 0;

  for (let index = 1; index < observations.length; index += 1) {
    const before = observations[index - 1];
    const after = observations[index];
    const beforeProjection = validProjections[index - 1];
    const afterProjection = validProjections[index];
    if (awaitingClearUpstream) {
      if (afterProjection.signedDistancePixels <= -RECROSS_REARM_DISTANCE_PIXELS) {
        clearUpstreamFrameCount += 1;
        if (clearUpstreamFrameCount >= RECROSS_REARM_REQUIRED_FRAMES) {
          awaitingClearUpstream = false;
          clearUpstreamFrameCount = 0;
          armed = true;
        }
      } else {
        clearUpstreamFrameCount = 0;
      }
    } else if (beforeProjection.signedDistancePixels < -GEOMETRY_TOLERANCE_PIXELS) {
      armed = true;
    }

    if (reverseCrossingPotential(beforeProjection, afterProjection)) {
      assessments.push(assessPair({
        configuration,
        trackId: track.trackId,
        before,
        after,
        beforeProjection,
        afterProjection,
        geometry,
        timeline,
        frameWidth: trackResult.frameWidth,
        frameHeight: trackResult.frameHeight,
        oppositeDirection: true,
      }));
      if (!awaitingClearUpstream) armed = false;
      continue;
    }
    if (armed && crossingPotential(beforeProjection, afterProjection)) {
      const assessment = assessPair({
        configuration,
        trackId: track.trackId,
        before,
        after,
        beforeProjection,
        afterProjection,
        geometry,
        timeline,
        frameWidth: trackResult.frameWidth,
        frameHeight: trackResult.frameHeight,
      });
      assessments.push(assessment);
      armed = false;
      // A crossing bracket consumes this approach. To distinguish real travel
      // back from small oscillations at the line, require two observed frames
      // at least 3 source pixels upstream before the same track can rearm.
      awaitingClearUpstream = true;
      clearUpstreamFrameCount = 0;
      continue;
    }
    if (!armed || afterProjection.signedDistancePixels <= GEOMETRY_TOLERANCE_PIXELS) continue;

    // A gap may hide the approach to the line. If the first observation after
    // that gap is downstream, preserve the uncertainty rather than infer motion.
    const missingFrames = after.frameIndex - before.frameIndex - 1;
    const deltaSeconds = after.timeSeconds - before.timeSeconds;
    if (missingFrames > 0 || deltaSeconds > MAX_FRAME_INTERVAL_SECONDS) {
      if (beforeProjection.signedDistancePixels <= GEOMETRY_TOLERANCE_PIXELS) {
        assessments.push(assessPair({
          configuration,
          trackId: track.trackId,
          before,
          after,
          beforeProjection,
          afterProjection,
          geometry,
          timeline,
          frameWidth: trackResult.frameWidth,
          frameHeight: trackResult.frameHeight,
          reasonOverride: 'tracking_gap',
        }));
      }
      armed = false;
    }
  }
  const lastIndex = observations.length - 1;
  const lastProjection = validProjections[lastIndex];
  if (armed && lastProjection.signedDistancePixels >= -GEOMETRY_TOLERANCE_PIXELS
    && lastProjection.signedDistancePixels <= GEOMETRY_TOLERANCE_PIXELS) {
    const before = observations[lastIndex - 1];
    const after = observations[lastIndex];
    assessments.push(baseAssessment({
      configuration,
      trackId: track.trackId,
      before,
      after,
      geometry,
      outcome: 'indeterminate',
      reason: 'insufficient_trajectory',
    }));
  }
  return assessments;
}

function possibleIdentityCrossings(input: {
  trackResult: TrackResult;
  configuration: SceneConfigurationSnapshot;
  timeline: SignalTimeline;
}): CrossingAssessment[] {
  const { trackResult, configuration, timeline } = input;
  const tracks = new Map(trackResult.tracks.map(track => [track.trackId, track]));
  const geometry = configuration.geometry;
  const assessments: CrossingAssessment[] = [];
  for (const possibleSwitch of trackResult.possibleIdentitySwitches) {
    const before = tracks.get(possibleSwitch.fromTrackId)?.observations.find(item => item.frameIndex === possibleSwitch.fromFrameIndex);
    const after = tracks.get(possibleSwitch.toTrackId)?.observations.find(item => item.frameIndex === possibleSwitch.toFrameIndex);
    if (!before || !after) continue;
    const beforeProjection = lineProjection(referencePoint(before, geometry.crossingDirection), geometry, trackResult.frameWidth, trackResult.frameHeight);
    const afterProjection = lineProjection(referencePoint(after, geometry.crossingDirection), geometry, trackResult.frameWidth, trackResult.frameHeight);
    if (!beforeProjection || !afterProjection || !crossingPotential(beforeProjection, afterProjection)) continue;
    assessments.push(assessPair({
      configuration,
      trackId: possibleSwitch.fromTrackId,
      relatedTrackIds: [possibleSwitch.toTrackId],
      before,
      after,
      beforeProjection,
      afterProjection,
      geometry,
      timeline,
      frameWidth: trackResult.frameWidth,
      frameHeight: trackResult.frameHeight,
      reasonOverride: 'possible_identity_switch',
    }));
  }
  return assessments;
}

function compareAssessments(left: CrossingAssessment, right: CrossingAssessment): number {
  const leftTime = left.crossingTimeSeconds ?? left.timeRange.startSeconds;
  const rightTime = right.crossingTimeSeconds ?? right.timeRange.startSeconds;
  return leftTime - rightTime || left.trackId.localeCompare(right.trackId, undefined, { numeric: true })
    || left.frameRange.startFrameIndex - right.frameRange.startFrameIndex;
}

export function assessCrossingEvents(input: {
  trackResult: TrackResult;
  configuration: SceneConfigurationSnapshot;
  signalTimeline: SignalTimeline;
}): CrossingAssessment[] {
  const assessments = input.trackResult.tracks.flatMap(track => findTrackCrossings({
    track,
    trackResult: input.trackResult,
    configuration: input.configuration,
    timeline: input.signalTimeline,
  }));
  const identityAssessments = possibleIdentityCrossings({
    trackResult: input.trackResult,
    configuration: input.configuration,
    timeline: input.signalTimeline,
  });
  const identityKeys = new Set(identityAssessments.map(item => `${item.trackId}:${item.frameRange.startFrameIndex}:${item.frameRange.endFrameIndex}`));
  assessments.push(...identityAssessments);
  return assessments
    .filter(item => item.reason === 'possible_identity_switch'
      || !identityKeys.has(`${item.trackId}:${item.frameRange.startFrameIndex}:${item.frameRange.endFrameIndex}`))
    .sort(compareAssessments);
}
