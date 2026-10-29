import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { executeAnalysisRun, identifySyntheticSource, ProgressOutputParser, recoverInterruptedAnalysisRuns } from './analysis-run.js';
import type { AnalysisRun } from './traffic-analysis.js';

function makeRun(videoId: string, status: AnalysisRun['status']): AnalysisRun {
  const createdAt = '2026-10-27T12:00:00.000Z';
  return {
    schemaVersion: 2,
    id: randomUUID(),
    videoId,
    status,
    phase: status === 'queued' ? 'queued' : status === 'running' ? 'car_tracking' : status,
    analysisStarted: true,
    configurationSnapshot: {
      geometry: { signalRegion: { x: 0.1, y: 0.1, width: 0.1, height: 0.2 } },
    } as AnalysisRun['configurationSnapshot'],
    provenance: {
      source: {
        videoId, sha256: 'a'.repeat(64), path: 'uploaded-original', durationSeconds: 1, width: 320, height: 240,
        syntheticSource: { status: 'not-identified', evidence: 'no-matching-manifest' },
      },
      detector: { family: 'YOLO26', weights: 'yolo26n.pt', runtime: 'Ultralytics', device: 'cpu' },
      tracker: { name: 'ByteTrack', configFile: 'server/inference/bytetrack.yaml' },
      sampling: { strategy: 'every-decoded-frame', framesPerSample: 1, timestampSource: 'ffprobe.best_effort_timestamp_time' },
      thresholds: { confidence: 0.25, imageSize: 640, classFilter: { id: 2, name: 'car' } },
      signalRecognition: { method: 'configured-region-hsv', algorithmVersion: 1, minimumColorPixelRatio: 0.005, ambiguousColorRatio: 0.5, requiredConsecutiveFrames: 3 },
    },
    createdAt,
    updatedAt: createdAt,
  };
}

test('fails an inference that exceeds its timeout and persists a terminal status', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'media-traffic-run-timeout-'));
  const dataDirectory = path.join(root, 'data');
  const videoId = randomUUID();
  const sourcePath = path.join(root, 'source.mp4');
  const source = Buffer.from('test video input');
  await writeFile(sourcePath, source);
  const sha256 = createHash('sha256').update(source).digest('hex');
  const run = makeRun(videoId, 'queued');
  run.provenance.source.sha256 = sha256;

  try {
    const terminal = await executeAnalysisRun({
      dataDirectory,
      videoId,
      upload: {
        schemaVersion: 1,
        id: videoId,
        originalName: 'source.mp4',
        status: 'completed',
        upload: { status: 'completed', sizeBytes: source.length, sha256 },
        preview: { status: 'completed', contentType: 'video/mp4', url: `/api/videos/${videoId}/preview` },
        source: { sizeBytes: source.length, sha256, media: { durationSeconds: 1, width: 320, height: 240 } },
        createdAt: run.createdAt,
        updatedAt: run.updatedAt,
      } as never,
      configurationId: randomUUID(),
      sourcePath,
      run,
      inferenceTimeoutMs: 15,
      runTracking: async () => new Promise(() => undefined),
    });

    assert.equal(terminal.status, 'failed');
    assert.equal(terminal.error?.code, 'ANALYSIS_INFERENCE_TIMEOUT');
    assert.match(terminal.error?.message || '', /time limit/);
    const persisted = JSON.parse(await readFile(path.join(dataDirectory, 'videos', videoId, 'analysis-runs', `${run.id}.json`), 'utf8')) as AnalysisRun;
    assert.equal(persisted.status, 'failed');
    assert.equal(persisted.error?.code, 'ANALYSIS_INFERENCE_TIMEOUT');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('persists a terminal failed run when saving the queued-to-running transition fails', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'media-traffic-run-transition-'));
  const dataDirectory = path.join(root, 'data');
  const videoId = randomUUID();
  const sourcePath = path.join(root, 'source.mp4');
  const source = Buffer.from('test video input');
  await writeFile(sourcePath, source);
  const sha256 = createHash('sha256').update(source).digest('hex');
  const run = makeRun(videoId, 'queued');
  run.provenance.source.sha256 = sha256;
  let persistAttempts = 0;
  let runnerCalled = false;

  try {
    const terminal = await executeAnalysisRun({
      dataDirectory,
      videoId,
      upload: {
        schemaVersion: 1,
        id: videoId,
        originalName: 'source.mp4',
        status: 'completed',
        upload: { status: 'completed', sizeBytes: source.length, sha256 },
        preview: { status: 'completed', contentType: 'video/mp4', url: `/api/videos/${videoId}/preview` },
        source: { sizeBytes: source.length, sha256, media: { durationSeconds: 1, width: 320, height: 240 } },
        createdAt: run.createdAt,
        updatedAt: run.updatedAt,
      } as never,
      configurationId: randomUUID(),
      sourcePath,
      run,
      persistState: async (_directory, nextRun) => {
        persistAttempts += 1;
        if (persistAttempts === 1) throw new Error('transient run-state write failure');
        const recordsDirectory = path.join(dataDirectory, 'videos', videoId, 'analysis-runs');
        await mkdir(recordsDirectory, { recursive: true });
        await writeFile(path.join(recordsDirectory, `${nextRun.id}.json`), JSON.stringify(nextRun));
      },
      runTracking: async () => {
        runnerCalled = true;
        throw new Error('runner must not be called');
      },
    });

    assert.equal(runnerCalled, false);
    assert.equal(terminal.status, 'failed');
    assert.equal(terminal.error?.code, 'ANALYSIS_RUN_STATE_PERSIST_FAILED');
    assert.match(terminal.error?.message || '', /progress could not be saved/);
    assert.equal(persistAttempts, 2);
    const persisted = JSON.parse(await readFile(path.join(dataDirectory, 'videos', videoId, 'analysis-runs', `${run.id}.json`), 'utf8')) as AnalysisRun;
    assert.equal(persisted.status, 'failed');
    assert.equal(persisted.error?.code, 'ANALYSIS_RUN_STATE_PERSIST_FAILED');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('terminates the inference child process when its timeout expires', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'media-traffic-child-timeout-'));
  const dataDirectory = path.join(root, 'data');
  const videoId = randomUUID();
  const sourcePath = path.join(root, 'source.mp4');
  const pidPath = path.join(root, 'child.pid');
  const fakePythonPath = path.join(root, 'slow-python');
  const source = Buffer.from('test video input');
  await writeFile(sourcePath, source);
  await writeFile(fakePythonPath, `#!/bin/sh\nprintf '%s' "$$" > '${pidPath}'\nexec sleep 30\n`);
  await chmod(fakePythonPath, 0o700);
  const sha256 = createHash('sha256').update(source).digest('hex');
  const run = makeRun(videoId, 'queued');
  run.provenance.source.sha256 = sha256;
  const oldPythonPath = process.env.YOLO_PYTHON_PATH;
  const oldModelPath = process.env.YOLO_MODEL_PATH;
  process.env.YOLO_PYTHON_PATH = fakePythonPath;
  process.env.YOLO_MODEL_PATH = path.join(root, 'checkpoint.pt');

  try {
    const terminal = await executeAnalysisRun({
      dataDirectory,
      videoId,
      upload: {
        schemaVersion: 1,
        id: videoId,
        originalName: 'source.mp4',
        status: 'completed',
        upload: { status: 'completed', sizeBytes: source.length, sha256 },
        preview: { status: 'completed', contentType: 'video/mp4', url: `/api/videos/${videoId}/preview` },
        source: { sizeBytes: source.length, sha256, media: { durationSeconds: 1, width: 320, height: 240 } },
        createdAt: run.createdAt,
        updatedAt: run.updatedAt,
      } as never,
      configurationId: randomUUID(),
      sourcePath,
      run,
      inferenceTimeoutMs: 30,
    });
    assert.equal(terminal.status, 'failed');
    assert.equal(terminal.error?.code, 'ANALYSIS_INFERENCE_TIMEOUT');

    const pidDeadline = Date.now() + 1_000;
    while (Date.now() < pidDeadline) {
      try {
        const pid = Number(await readFile(pidPath, 'utf8'));
        process.kill(pid, 0);
        await new Promise(resolve => setTimeout(resolve, 10));
      } catch {
        return;
      }
    }
    assert.fail('The inference child process remained alive after its timeout.');
  } finally {
    if (oldPythonPath === undefined) delete process.env.YOLO_PYTHON_PATH;
    else process.env.YOLO_PYTHON_PATH = oldPythonPath;
    if (oldModelPath === undefined) delete process.env.YOLO_MODEL_PATH;
    else process.env.YOLO_MODEL_PATH = oldModelPath;
    await rm(root, { recursive: true, force: true });
  }
});

test('marks queued and running records as failed after restart while retaining terminal records', async () => {
  const dataDirectory = await mkdtemp(path.join(os.tmpdir(), 'media-traffic-run-recovery-'));
  const videoId = randomUUID();
  const recordsDirectory = path.join(dataDirectory, 'videos', videoId, 'analysis-runs');
  await mkdir(recordsDirectory, { recursive: true });
  const queued = makeRun(videoId, 'queued');
  const running = makeRun(videoId, 'running');
  const completed = makeRun(videoId, 'completed');
  for (const run of [queued, running, completed]) {
    await writeFile(path.join(recordsDirectory, `${run.id}.json`), JSON.stringify(run));
  }

  try {
    const recovered = await recoverInterruptedAnalysisRuns(dataDirectory, () => '2026-10-27T12:05:00.000Z');
    assert.equal(recovered, 2);
    for (const run of [queued, running]) {
      const persisted = JSON.parse(await readFile(path.join(recordsDirectory, `${run.id}.json`), 'utf8')) as AnalysisRun;
      assert.equal(persisted.status, 'failed');
      assert.equal(persisted.error?.code, 'ANALYSIS_WORKER_INTERRUPTED');
      assert.equal(persisted.error?.stage, run.status === 'queued' ? 'queued' : 'car_tracking');
      assert.equal(persisted.updatedAt, '2026-10-27T12:05:00.000Z');
    }
    const unchanged = JSON.parse(await readFile(path.join(recordsDirectory, `${completed.id}.json`), 'utf8')) as AnalysisRun;
    assert.equal(unchanged.status, 'completed');
  } finally {
    await rm(dataDirectory, { recursive: true, force: true });
  }
});

test('parses CR-delimited progress and bounds unterminated runtime output', () => {
  const parser = new ProgressOutputParser();
  assert.deepEqual(parser.push('MEDIA_TRAFFIC_PROGRESS:media_inspection\rMEDIA_TRAFFIC_PROGRESS:preparation\r'), ['media_inspection', 'preparation']);
  assert.deepEqual(parser.push('x'.repeat(100_000)), []);
  assert.ok(parser.bufferedChars <= 4_096);
  assert.deepEqual(parser.push('\nMEDIA_TRAFFIC_PROGRESS:car_tracking\r'), ['car_tracking']);
  assert.ok(parser.bufferedChars <= 4_096);
});

test('reports a missing model at the preparation stage without exposing paths', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'media-traffic-run-model-missing-'));
  const dataDirectory = path.join(root, 'data');
  const videoId = randomUUID();
  const sourcePath = path.join(root, 'source.mp4');
  const source = Buffer.from('test video input');
  await writeFile(sourcePath, source);
  const sha256 = createHash('sha256').update(source).digest('hex');
  const run = makeRun(videoId, 'queued');
  run.provenance.source.sha256 = sha256;
  const previousModelPath = process.env.YOLO_MODEL_PATH;
  delete process.env.YOLO_MODEL_PATH;

  try {
    const failed = await executeAnalysisRun({
      dataDirectory,
      videoId,
      upload: {
        schemaVersion: 1,
        id: videoId,
        originalName: 'source.mp4',
        status: 'completed',
        upload: { status: 'completed', sizeBytes: source.length, sha256 },
        preview: { status: 'completed', contentType: 'video/mp4', url: `/api/videos/${videoId}/preview` },
        source: { sizeBytes: source.length, sha256, media: { durationSeconds: 1, width: 320, height: 240 } },
        createdAt: run.createdAt,
        updatedAt: run.updatedAt,
      } as never,
      configurationId: randomUUID(),
      sourcePath,
      run,
    });

    assert.equal(failed.status, 'failed');
    assert.equal(failed.error?.code, 'YOLO_MODEL_NOT_CONFIGURED');
    assert.equal(failed.error?.stage, 'preparation');
    assert.equal(failed.error?.message, 'Set YOLO_MODEL_PATH to the qualified yolo26n.pt checkpoint, then start a new analysis run.');
    assert.equal('result' in failed, false);
  } finally {
    if (previousModelPath === undefined) delete process.env.YOLO_MODEL_PATH;
    else process.env.YOLO_MODEL_PATH = previousModelPath;
    await rm(root, { recursive: true, force: true });
  }
});

test('identifies only the checked-in demo video by its manifest source hash', async () => {
  const manifest = JSON.parse(await readFile(new URL('../example/demo-traffic-video/manifest.json', import.meta.url), 'utf8')) as { video: { sha256: string } };
  assert.deepEqual(await identifySyntheticSource(manifest.video.sha256), {
    status: 'manifest-verified', evidence: 'demo-video-manifest-sha256',
  });
  assert.deepEqual(await identifySyntheticSource('f'.repeat(64)), {
    status: 'not-identified', evidence: 'no-matching-manifest',
  });
});

test('does not return completed when persisting the complete result fails', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'media-traffic-result-persist-'));
  const dataDirectory = path.join(root, 'data');
  const videoId = randomUUID();
  const sourcePath = path.join(root, 'source.mp4');
  const previewPath = path.join(dataDirectory, 'videos', videoId, 'preview.mp4');
  const source = Buffer.from('test video input');
  const preview = Buffer.from('playable preview');
  await mkdir(path.dirname(previewPath), { recursive: true });
  await writeFile(sourcePath, source);
  await writeFile(previewPath, preview);
  const sha256 = createHash('sha256').update(source).digest('hex');
  const run = makeRun(videoId, 'queued');
  run.provenance.source.sha256 = sha256;
  let failedToPersistCompletion = false;
  const persistedPhases: string[] = [];

  try {
    const terminal = await executeAnalysisRun({
      dataDirectory,
      videoId,
      upload: {
        schemaVersion: 1,
        id: videoId,
        originalName: 'source.mp4',
        status: 'completed',
        upload: { status: 'completed', sizeBytes: source.length, sha256 },
        preview: { status: 'completed', contentType: 'video/mp4', url: `/api/videos/${videoId}/preview` },
        derivative: { sizeBytes: preview.length },
        source: { sizeBytes: source.length, sha256, media: { durationSeconds: 1, width: 320, height: 240 } },
        createdAt: run.createdAt,
        updatedAt: run.updatedAt,
      } as never,
      configurationId: randomUUID(),
      sourcePath,
      run,
      runTracking: async (_source, _output, _region, onProgress) => {
        await onProgress?.('preparation');
        await onProgress?.('car_tracking');
        return {
          width: 320,
          height: 240,
          frames: [0, 1, 2].map(frameIndex => ({ frameIndex, timeSeconds: frameIndex / 10, detections: [] })),
          signalPixelObservations: [0, 1, 2].map(frameIndex => ({ frameIndex, timeSeconds: frameIndex / 10, colorScores: { red: 0, yellow: 0, green: 0 } })),
          provenance: {
            checkpoint: 'yolo26n.pt', checkpointSha256: '9b09cc8bf347f0fc8a5f7657480587f25db09b34bf33b0652110fb03a8ad4fef',
            runtime: 'Ultralytics', runtimeVersion: 'test', pythonVersion: 'test', pytorchVersion: 'test', platform: 'test', device: 'cpu',
            tracker: 'ByteTrack', trackerConfigSha256: 'a'.repeat(64), trackerConfig: {}, sampling: 'every decoded frame',
            timestampSource: 'ffprobe.best_effort_timestamp_time', confidenceThreshold: 0.25, imageSize: 640,
            classFilter: { id: 2, name: 'car' }, decodedFrameCount: 3, inferenceSeconds: 0.1,
          },
        };
      },
      persistState: async (directory, nextRun) => {
        persistedPhases.push(nextRun.phase);
        if (nextRun.status === 'completed' && !failedToPersistCompletion) {
          failedToPersistCompletion = true;
          throw new Error('disk write failed');
        }
        const recordDirectory = path.join(directory, 'videos', videoId, 'analysis-runs');
        await mkdir(recordDirectory, { recursive: true });
        await writeFile(path.join(recordDirectory, `${nextRun.id}.json`), JSON.stringify(nextRun));
      },
    });

    assert.equal(terminal.status, 'failed');
    assert.equal(terminal.phase, 'failed');
    assert.equal(terminal.error?.code, 'ANALYSIS_RESULT_PERSIST_FAILED');
    assert.equal(terminal.error?.stage, 'result_generation');
    assert.equal('result' in terminal, false);
    assert.deepEqual(persistedPhases, ['media_inspection', 'preparation', 'car_tracking', 'signal_analysis', 'result_generation', 'completed', 'failed']);
    const persisted = JSON.parse(await readFile(path.join(dataDirectory, 'videos', videoId, 'analysis-runs', `${run.id}.json`), 'utf8')) as AnalysisRun;
    assert.equal(persisted.status, 'failed');
    assert.equal(persisted.error?.code, 'ANALYSIS_RESULT_PERSIST_FAILED');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
