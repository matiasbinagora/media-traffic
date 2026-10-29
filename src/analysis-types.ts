import type { SceneConfigurationSnapshot } from './SceneConfigurationEditor';

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

export type SignalState = 'red' | 'yellow' | 'green' | 'unknown';

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
  observations: Array<{
    frameIndex: number;
    timeSeconds: number;
    state: SignalState;
    evidenceScore: number;
    colorScores: { red: number; yellow: number; green: number };
    reason?: 'no_clear_lamp' | 'multiple_colors' | 'signal_region_too_small';
  }>;
  intervals: SignalInterval[];
};

export type TrafficAnalysisResult = {
  frameWidth: number;
  frameHeight: number;
  sampledFrameCount: number;
  tracks: CarTrajectory[];
  possibleIdentitySwitches: PossibleIdentitySwitch[];
  /** Optional for compatibility with completed run records created before signal inference was added. */
  signalTimeline?: SignalTimeline;
};

export type AnalysisProvenance = {
  source: {
    videoId: string; sha256: string; path: 'uploaded-original'; durationSeconds: number; width: number; height: number;
    syntheticSource?: { status: 'manifest-verified' | 'not-identified'; evidence: 'demo-video-manifest-sha256' | 'no-matching-manifest' };
  };
  detector: { family: 'YOLO26'; weights: string; sha256?: string; runtime: 'Ultralytics'; runtimeVersion?: string; pythonVersion?: string; pytorchVersion?: string; platform?: string; inferenceSeconds?: number; device: 'cpu' };
  tracker: { name: 'ByteTrack'; configFile: 'server/inference/bytetrack.yaml'; configSha256?: string; config?: Record<string, unknown> };
  sampling: { strategy: 'every-decoded-frame'; framesPerSample: 1; timestampSource: 'ffprobe.best_effort_timestamp_time'; decodedFrameCount?: number };
  thresholds: { confidence: number; imageSize: number; classFilter: { id: number; name: 'car' } };
};

export type AnalysisRunSnapshot = {
  schemaVersion: 2;
  id: string;
  videoId: string;
  status: 'queued' | 'running' | 'completed' | 'failed';
  phase?: 'queued' | 'media_inspection' | 'preparation' | 'car_tracking' | 'signal_analysis' | 'result_generation' | 'completed' | 'failed';
  analysisStarted: boolean;
  configurationSnapshot: SceneConfigurationSnapshot;
  createdAt: string;
  updatedAt: string;
  provenance: AnalysisProvenance;
  result?: TrafficAnalysisResult;
  error?: { code: string; message: string; stage: 'queued' | 'media_inspection' | 'preparation' | 'car_tracking' | 'signal_analysis' | 'result_generation' | 'inference' };
};
