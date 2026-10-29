import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { after, before, test } from 'node:test';
import { createMediaServer } from './index.js';
import type { TrackingOutput } from './analysis-run.js';

const fixtureRoot = await mkdtemp(path.join(os.tmpdir(), 'media-traffic-scene-test-'));
const fixturePath = path.join(fixtureRoot, 'scene-source.mp4');
let server: http.Server;
let baseUrl: string;
let dataDirectory: string;
let videoId: string;
let sourceSha256: string;
let lastSignalRegion: { x: number; y: number; width: number; height: number } | undefined;
let simulateInferenceFailure = false;
let simulateInvalidCheckpoint = false;
let simulateSignalTimestampMismatch = false;
let observedAnalysisPhases: string[] = [];

const deterministicTrackingOutput: TrackingOutput = {
  width: 320,
  height: 240,
  frames: [
    { frameIndex: 0, timeSeconds: 0, detections: [
      { trackId: 1, box: [30, 40, 80, 100], confidence: 0.91 },
      { trackId: 2, box: [150, 40, 210, 110], confidence: 0.86 },
    ] },
    { frameIndex: 1, timeSeconds: 0.1, detections: [
      { trackId: 1, box: [31, 41, 81, 101], confidence: 0.9 },
      { trackId: 2, box: [151, 41, 211, 111], confidence: 0.85 },
    ] },
    { frameIndex: 2, timeSeconds: 0.2, detections: [
      { trackId: 1, box: [32, 42, 82, 102], confidence: 0.89 },
    ] },
  ],
  signalPixelObservations: [0, 1, 2].map(frameIndex => ({
    frameIndex,
    timeSeconds: frameIndex / 10,
    colorScores: { red: 0, yellow: 0, green: 0.03 },
  })),
  provenance: {
    checkpoint: 'yolo26n.pt',
    checkpointSha256: '9b09cc8bf347f0fc8a5f7657480587f25db09b34bf33b0652110fb03a8ad4fef',
    runtime: 'Ultralytics',
    runtimeVersion: 'test-version',
    pythonVersion: 'test-python',
    pytorchVersion: 'test-pytorch',
    platform: 'test-platform',
    device: 'cpu',
    tracker: 'ByteTrack',
    trackerConfigSha256: 'a'.repeat(64),
    trackerConfig: { tracker_type: 'bytetrack', track_buffer: 30 },
    sampling: 'every decoded frame',
    timestampSource: 'ffprobe.best_effort_timestamp_time',
    confidenceThreshold: 0.25,
    imageSize: 640,
    classFilter: { id: 2, name: 'car' },
    decodedFrameCount: 3,
    inferenceSeconds: 0.12,
  },
};

before(async () => {
  execFileSync('ffmpeg', [
    '-nostdin', '-hide_banner', '-loglevel', 'error', '-y',
    '-f', 'lavfi', '-i', 'color=c=blue:s=320x240:r=10:d=0.5',
    '-c:v', 'mpeg4', '-pix_fmt', 'yuv420p', fixturePath,
  ]);
  dataDirectory = await mkdtemp(path.join(os.tmpdir(), 'media-traffic-scene-data-'));
  server = createMediaServer({
    dataDirectory,
    maxUploadBytes: 1024 * 1024,
    analysisRunner: async (_sourcePath, _outputPath, signalRegion, onProgress) => {
      observedAnalysisPhases = [];
      for (const phase of ['media_inspection', 'preparation', 'car_tracking'] as const) {
        await onProgress?.(phase);
        observedAnalysisPhases.push(phase);
      }
      if (simulateInferenceFailure) throw Object.assign(new Error('sensitive /private/model/checkpoint.pt detail'), { code: 'YOLO_INFERENCE_FAILED' });
      lastSignalRegion = structuredClone(signalRegion);
      const output = structuredClone(deterministicTrackingOutput);
      if (simulateInvalidCheckpoint) output.provenance.checkpointSha256 = '0'.repeat(64);
      if (simulateSignalTimestampMismatch) output.signalPixelObservations[2].timeSeconds += 0.05;
      return output;
    },
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  assert.ok(address && typeof address === 'object');
  baseUrl = `http://127.0.0.1:${address.port}`;

  const boundary = 'scene-configuration-upload';
  const body = Buffer.concat([
    Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="video"; filename="scene-source.mp4"\r\nContent-Type: video/mp4\r\n\r\n`),
    await readFile(fixturePath),
    Buffer.from(`\r\n--${boundary}--\r\n`),
  ]);
  const response = await fetch(`${baseUrl}/api/videos`, {
    method: 'POST',
    headers: { 'content-type': `multipart/form-data; boundary=${boundary}` },
    body,
  });
  assert.equal(response.status, 201, JSON.stringify(await response.clone().json()));
  const upload = await response.json() as { id: string; source: { sha256: string } };
  videoId = upload.id;
  sourceSha256 = upload.source.sha256;
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    const jobResponse = await fetch(`${baseUrl}/api/videos/${videoId}`);
    const job = await jobResponse.json() as { status: string };
    if (job.status === 'completed') return;
    if (job.status === 'failed') assert.fail('The synthetic upload preview failed to process.');
    await new Promise(resolve => setTimeout(resolve, 30));
  }
  assert.fail('The synthetic upload preview did not complete in time.');
});

after(async () => {
  server.closeAllConnections();
  await new Promise<void>(resolve => server.close(() => resolve()));
  await rm(dataDirectory, { recursive: true, force: true });
  await rm(fixtureRoot, { recursive: true, force: true });
});

function configuration(id: string, stopLineEndX = 0.8) {
  return {
    schemaVersion: 1,
    id,
    source: { videoId, sha256: sourceSha256, width: 320, height: 240 },
    geometry: {
      vehicleRegion: { x: 0.1, y: 0.2, width: 0.8, height: 0.7 },
      stopLine: { start: { x: 0.2, y: 0.6 }, end: { x: stopLineEndX, y: 0.6 } },
      crossingDirection: 'top-to-bottom',
      signalRegion: { x: 0.72, y: 0.08, width: 0.12, height: 0.32 },
      signalAssociation: 'traffic-signal-1',
    },
    createdAt: '2026-10-20T12:00:00.000Z',
  };
}

async function saveConfiguration(snapshot: ReturnType<typeof configuration>) {
  return fetch(`${baseUrl}/api/videos/${videoId}/configurations`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(snapshot),
  });
}

test('rejects invalid geometry and missing signal association with field-level errors', async () => {
  const invalid = configuration('10000000-0000-4000-8000-000000000001');
  invalid.geometry.vehicleRegion = null as unknown as typeof invalid.geometry.vehicleRegion;
  invalid.geometry.stopLine.end = { x: 0.2, y: 0.6 };
  invalid.geometry.signalAssociation = '  ';

  const response = await saveConfiguration(invalid);
  assert.equal(response.status, 422);
  assert.deepEqual(await response.json(), {
    error: {
      code: 'SCENE_CONFIGURATION_INVALID',
      message: 'The scene configuration is incomplete or invalid.',
      details: { invalidFields: ['vehicleRegion', 'stopLine', 'signalAssociation'] },
    },
  });
});

test('captures immutable configuration snapshots per run when later scene edits are saved', async () => {
  const first = configuration('10000000-0000-4000-8000-000000000002', 0.8);
  const saveFirst = await saveConfiguration(first);
  assert.equal(saveFirst.status, 201, JSON.stringify(await saveFirst.clone().json()));
  assert.deepEqual(await saveFirst.json(), first);

  const firstRunResponse = await fetch(`${baseUrl}/api/videos/${videoId}/analysis-runs`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ configurationId: first.id }),
  });
  assert.equal(firstRunResponse.status, 202, JSON.stringify(await firstRunResponse.clone().json()));
  const firstRun = await firstRunResponse.json() as Record<string, any>;
  assert.equal(firstRun.status, 'queued');
  assert.equal(firstRun.analysisStarted, true);
  assert.deepEqual(firstRun.configurationSnapshot, first);
  const completedFirstRun = await waitForAnalysisRun(firstRun.id);
  assert.deepEqual(lastSignalRegion, first.geometry.signalRegion, 'signal recognition must use the saved run configuration');
  assert.equal(completedFirstRun.status, 'completed');
  assert.equal(completedFirstRun.phase, 'completed');
  assert.deepEqual(observedAnalysisPhases, ['media_inspection', 'preparation', 'car_tracking']);
  assert.deepEqual(completedFirstRun.provenance.source.syntheticSource, { status: 'not-identified', evidence: 'no-matching-manifest' });
  assert.deepEqual(completedFirstRun.result.tracks.map((track: any) => track.trackId), ['1', '2']);
  assert.equal(completedFirstRun.result.tracks[0].observations.length, 3);
  assert.equal(completedFirstRun.result.tracks[1].observations.length, 2);
  assert.equal(completedFirstRun.provenance.sampling.framesPerSample, 1);
  assert.equal(completedFirstRun.provenance.detector.sha256, deterministicTrackingOutput.provenance.checkpointSha256);
  assert.equal(completedFirstRun.provenance.detector.platform, deterministicTrackingOutput.provenance.platform);
  assert.equal(completedFirstRun.provenance.detector.inferenceSeconds, deterministicTrackingOutput.provenance.inferenceSeconds);
  assert.equal(completedFirstRun.provenance.sampling.decodedFrameCount, deterministicTrackingOutput.provenance.decodedFrameCount);
  assert.equal(completedFirstRun.result.signalTimeline.intervals[0].state, 'green');
  assert.deepEqual(completedFirstRun.result.signalTimeline.intervals[0].transitionEvidence?.supportingFrameIndices, [0, 1, 2]);
  assert.deepEqual(completedFirstRun.result.signalTimeline.observations.map((observation: any) => observation.frameIndex), [0, 1, 2]);
  assert.deepEqual(completedFirstRun.provenance.signalRecognition, {
    method: 'configured-region-hsv', algorithmVersion: 1, minimumColorPixelRatio: 0.005, ambiguousColorRatio: 0.5, requiredConsecutiveFrames: 3,
  });

  const second = configuration('10000000-0000-4000-8000-000000000003', 0.9);
  const saveSecond = await saveConfiguration(second);
  assert.equal(saveSecond.status, 201, JSON.stringify(await saveSecond.clone().json()));

  const firstEvidenceResponse = await fetch(`${baseUrl}/api/videos/${videoId}/analysis-runs/${firstRun.id}`);
  assert.equal(firstEvidenceResponse.status, 200);
  const firstEvidence = await firstEvidenceResponse.json() as Record<string, any>;
  assert.deepEqual(firstEvidence.configurationSnapshot, first);
  assert.equal(firstEvidence.status, 'completed');
  assert.equal(firstEvidence.result.tracks.length, 2);
  assert.equal(firstEvidence.configurationSnapshot.geometry.stopLine.end.x, 0.8);

  const secondRunResponse = await fetch(`${baseUrl}/api/videos/${videoId}/analysis-runs`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ configurationId: second.id }),
  });
  assert.equal(secondRunResponse.status, 202, JSON.stringify(await secondRunResponse.clone().json()));
  const secondRun = await secondRunResponse.json() as Record<string, any>;
  assert.notEqual(secondRun.id, firstRun.id);
  assert.deepEqual(secondRun.configurationSnapshot, second);
  assert.equal((await waitForAnalysisRun(secondRun.id)).status, 'completed');

  const duplicate = await saveConfiguration(first);
  assert.equal(duplicate.status, 409);
  assert.equal((await duplicate.json() as any).error.code, 'SCENE_CONFIGURATION_IMMUTABLE');
});

async function waitForAnalysisRun(runId: string) {
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline) {
    const response = await fetch(`${baseUrl}/api/videos/${videoId}/analysis-runs/${runId}`);
    const run = await response.json() as Record<string, any>;
    if (run.status === 'completed' || run.status === 'failed') return run;
    await new Promise(resolve => setTimeout(resolve, 10));
  }
  assert.fail('The analysis run did not reach a terminal state in time.');
}

test('cannot create an analysis run without an explicitly saved configuration', async () => {
  const response = await fetch(`${baseUrl}/api/videos/${videoId}/analysis-runs`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ configurationId: '10000000-0000-4000-8000-000000000004' }),
  });
  assert.equal(response.status, 422);
  assert.equal((await response.json() as any).error.code, 'SCENE_CONFIGURATION_REQUIRED');
});

test('does not queue analysis if the playable preview has disappeared', async () => {
  const snapshot = configuration('10000000-0000-4000-8000-000000000008');
  assert.equal((await saveConfiguration(snapshot)).status, 201);
  const previewPath = path.join(dataDirectory, 'videos', videoId, 'preview.mp4');
  const preview = await readFile(previewPath);
  await rm(previewPath);
  try {
    const response = await fetch(`${baseUrl}/api/videos/${videoId}/analysis-runs`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ configurationId: snapshot.id }),
    });
    assert.equal(response.status, 409);
    assert.equal((await response.json() as any).error.code, 'PREVIEW_UNAVAILABLE');
  } finally {
    await writeFile(previewPath, preview);
  }
});

test('fails the run when signal evidence is not synchronized with source frames', async () => {
  const snapshot = configuration('10000000-0000-4000-8000-000000000007');
  assert.equal((await saveConfiguration(snapshot)).status, 201);
  simulateSignalTimestampMismatch = true;
  try {
    const response = await fetch(`${baseUrl}/api/videos/${videoId}/analysis-runs`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ configurationId: snapshot.id }),
    });
    assert.equal(response.status, 202);
    const queued = await response.json() as Record<string, any>;
    const failed = await waitForAnalysisRun(queued.id);
    assert.equal(failed.status, 'failed');
    assert.equal(failed.error.stage, 'car_tracking');
    assert.match(failed.error.message, /failed during car tracking/);
    assert.equal('result' in failed, false);
  } finally {
    simulateSignalTimestampMismatch = false;
  }
});

test('persists a failed inference state without substituting fixture detections', async () => {
  const snapshot = configuration('10000000-0000-4000-8000-000000000005');
  assert.equal((await saveConfiguration(snapshot)).status, 201);
  simulateInferenceFailure = true;
  const response = await fetch(`${baseUrl}/api/videos/${videoId}/analysis-runs`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ configurationId: snapshot.id }),
  });
  assert.equal(response.status, 202);
  const queued = await response.json() as Record<string, any>;
  const failed = await waitForAnalysisRun(queued.id);
  simulateInferenceFailure = false;
  assert.equal(failed.status, 'failed');
  assert.equal(failed.error.stage, 'car_tracking');
  assert.doesNotMatch(failed.error.message, /private|checkpoint\.pt|sensitive/i);
  assert.equal(failed.error.message, 'Traffic analysis failed during car tracking. Verify the uploaded source, qualified model and runtime, then start a new run; include this run ID when contacting the operator.');
  assert.equal(failed.phase, 'failed');
  assert.equal('result' in failed, false);
});

test('rejects tracker output with checkpoint provenance that differs from the qualified model', async () => {
  const snapshot = configuration('10000000-0000-4000-8000-000000000006');
  assert.equal((await saveConfiguration(snapshot)).status, 201);
  simulateInvalidCheckpoint = true;
  const response = await fetch(`${baseUrl}/api/videos/${videoId}/analysis-runs`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ configurationId: snapshot.id }),
  });
  const queued = await response.json() as Record<string, any>;
  const failed = await waitForAnalysisRun(queued.id);
  simulateInvalidCheckpoint = false;
  assert.equal(failed.status, 'failed');
  assert.match(failed.error.message, /failed during car tracking/);
  assert.equal('result' in failed, false);
});
