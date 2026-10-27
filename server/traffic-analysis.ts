export type RawDetection = {
  trackId: string | number;
  box: [number, number, number, number];
  confidence: number;
};

export type RawTrackingFrame = {
  frameIndex: number;
  timeSeconds: number;
  detections: RawDetection[];
};

export type TrackObservation = {
  frameIndex: number;
  timeSeconds: number;
  frameWidth: number;
  frameHeight: number;
  box: { x: number; y: number; width: number; height: number };
  normalizedBox: { x: number; y: number; width: number; height: number };
  confidence: number;
  state: 'observed';
};

export type TrackGap = {
  afterFrameIndex: number;
  beforeFrameIndex: number;
  missingFrameCount: number;
  startSeconds: number;
  endSeconds: number;
  reason: 'not_observed';
  identityContinuity: 'unverified';
};

export type CarTrajectory = {
  trackId: string;
  firstSeenSeconds: number;
  lastSeenSeconds: number;
  observations: TrackObservation[];
  gaps: TrackGap[];
};

export type TrackResult = {
  frameWidth: number;
  frameHeight: number;
  sampledFrameCount: number;
  tracks: CarTrajectory[];
  possibleIdentitySwitches: PossibleIdentitySwitch[];
};

export type PossibleIdentitySwitch = {
  fromTrackId: string;
  toTrackId: string;
  fromFrameIndex: number;
  toFrameIndex: number;
  fromTimeSeconds: number;
  toTimeSeconds: number;
  spatialEvidence: 'overlap' | 'nearby';
  identityContinuity: 'unverified';
};

export type AnalysisRunStatus = 'queued' | 'running' | 'completed' | 'failed';

export type AnalysisProvenance = {
  source: { videoId: string; sha256: string; path: 'uploaded-original'; durationSeconds: number; width: number; height: number };
  detector: { family: 'YOLO26'; weights: string; sha256?: string; runtime: 'Ultralytics'; runtimeVersion?: string; pythonVersion?: string; pytorchVersion?: string; platform?: string; inferenceSeconds?: number; device: 'cpu' };
  tracker: { name: 'ByteTrack'; configFile: 'server/inference/bytetrack.yaml'; configSha256?: string; config?: Record<string, unknown> };
  sampling: { strategy: 'every-decoded-frame'; framesPerSample: 1; timestampSource: 'ffprobe.best_effort_timestamp_time'; decodedFrameCount?: number };
  thresholds: { confidence: number; imageSize: number; classFilter: { id: 2; name: 'car' } };
};

export type AnalysisRunError = { code: string; message: string; stage: 'inference' };

export type AnalysisRun = {
  schemaVersion: 2;
  id: string;
  videoId: string;
  status: AnalysisRunStatus;
  analysisStarted: boolean;
  configurationSnapshot: import('./scene-configuration.js').SceneConfigurationSnapshot;
  provenance: AnalysisProvenance;
  result?: TrackResult;
  error?: AnalysisRunError;
  createdAt: string;
  updatedAt: string;
};

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function intersectionOverUnion(left: TrackObservation, right: TrackObservation): number {
  const x1 = Math.max(left.box.x, right.box.x);
  const y1 = Math.max(left.box.y, right.box.y);
  const x2 = Math.min(left.box.x + left.box.width, right.box.x + right.box.width);
  const y2 = Math.min(left.box.y + left.box.height, right.box.y + right.box.height);
  const intersection = Math.max(0, x2 - x1) * Math.max(0, y2 - y1);
  if (!intersection) return 0;
  const union = left.box.width * left.box.height + right.box.width * right.box.height - intersection;
  return intersection / union;
}

function nearbyDistinctTracks(left: TrackObservation, right: TrackObservation): 'overlap' | 'nearby' | undefined {
  const overlap = intersectionOverUnion(left, right);
  if (overlap >= 0.1) return 'overlap';
  const leftCenterX = left.box.x + left.box.width / 2;
  const leftCenterY = left.box.y + left.box.height / 2;
  const rightCenterX = right.box.x + right.box.width / 2;
  const rightCenterY = right.box.y + right.box.height / 2;
  const centerDistance = Math.hypot(leftCenterX - rightCenterX, leftCenterY - rightCenterY);
  const largestDiagonal = Math.max(
    Math.hypot(left.box.width, left.box.height),
    Math.hypot(right.box.width, right.box.height),
  );
  return centerDistance <= largestDiagonal * 0.75 ? 'nearby' : undefined;
}

export function assembleTrackResult(input: {
  width: number;
  height: number;
  frames: RawTrackingFrame[];
}): TrackResult {
  if (!Number.isSafeInteger(input.width) || input.width < 1 || !Number.isSafeInteger(input.height) || input.height < 1) {
    throw new Error('Tracking output must include valid frame dimensions.');
  }

  const tracks = new Map<string, TrackObservation[]>();
  let previousFrame = -1;
  let previousTime = -Infinity;
  for (const frame of input.frames) {
    if (!Number.isSafeInteger(frame.frameIndex) || frame.frameIndex < 0 || frame.frameIndex <= previousFrame
      || !isFiniteNumber(frame.timeSeconds) || frame.timeSeconds <= previousTime
      || !Array.isArray(frame.detections)) {
      throw new Error('Tracking frame indices and presentation timestamps must be valid and strictly increasing.');
    }
    previousFrame = frame.frameIndex;
    previousTime = frame.timeSeconds;

    for (const detection of frame.detections) {
      const idValue = detection.trackId;
      const trackId = String(idValue).trim();
      const [left, top, right, bottom] = detection.box;
      if (!trackId || !Array.isArray(detection.box) || detection.box.length !== 4
        || ![left, top, right, bottom, detection.confidence].every(isFiniteNumber)
        || left < 0 || top < 0 || right <= left || bottom <= top
        || right > input.width || bottom > input.height
        || detection.confidence < 0 || detection.confidence > 1) {
        throw new Error('Tracking output contains an invalid track ID, confidence, or valid box.');
      }

      const width = right - left;
      const height = bottom - top;
      const observation: TrackObservation = {
        frameIndex: frame.frameIndex,
        timeSeconds: frame.timeSeconds,
        frameWidth: input.width,
        frameHeight: input.height,
        box: { x: left, y: top, width, height },
        normalizedBox: {
          x: left / input.width,
          y: top / input.height,
          width: width / input.width,
          height: height / input.height,
        },
        confidence: detection.confidence,
        state: 'observed',
      };
      const observations = tracks.get(trackId) || [];
      observations.push(observation);
      tracks.set(trackId, observations);
    }
  }

  const resultTracks = [...tracks.entries()].map(([trackId, observations]): CarTrajectory => {
    const gaps: TrackGap[] = [];
    for (let index = 1; index < observations.length; index += 1) {
      const previous = observations[index - 1];
      const current = observations[index];
      const missingFrameCount = current.frameIndex - previous.frameIndex - 1;
      if (missingFrameCount > 0) {
        gaps.push({
          afterFrameIndex: previous.frameIndex,
          beforeFrameIndex: current.frameIndex,
          missingFrameCount,
          startSeconds: previous.timeSeconds,
          endSeconds: current.timeSeconds,
          reason: 'not_observed',
          identityContinuity: 'unverified',
        });
      }
    }
    return {
      trackId,
      firstSeenSeconds: observations[0].timeSeconds,
      lastSeenSeconds: observations.at(-1)!.timeSeconds,
      observations,
      gaps,
    };
  }).sort((left, right) => left.trackId.localeCompare(right.trackId, undefined, { numeric: true }));

  const possibleIdentitySwitches: PossibleIdentitySwitch[] = [];
  for (const from of resultTracks) {
    const last = from.observations.at(-1)!;
    for (const to of resultTracks) {
      if (from.trackId === to.trackId) continue;
      const first = to.observations[0];
      const frameGap = first.frameIndex - last.frameIndex;
      if (frameGap < 1 || frameGap > 3) continue;
      const spatialEvidence = nearbyDistinctTracks(last, first);
      if (!spatialEvidence) continue;
      possibleIdentitySwitches.push({
        fromTrackId: from.trackId,
        toTrackId: to.trackId,
        fromFrameIndex: last.frameIndex,
        toFrameIndex: first.frameIndex,
        fromTimeSeconds: last.timeSeconds,
        toTimeSeconds: first.timeSeconds,
        spatialEvidence,
        identityContinuity: 'unverified',
      });
    }
  }

  return {
    frameWidth: input.width,
    frameHeight: input.height,
    sampledFrameCount: input.frames.length,
    tracks: resultTracks,
    possibleIdentitySwitches,
  };
}
