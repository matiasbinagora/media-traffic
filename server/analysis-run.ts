import { createHash, randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { mkdir, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { MediaError, sha256File, type UploadJob } from './media.js';
import { invalidGeometryFields, type SceneConfigurationSnapshot } from './scene-configuration.js';
import { assembleSignalTimeline, classifySignalObservation, type RawSignalPixelObservation } from './signal-analysis.js';
import { assembleTrackResult, type AnalysisProvenance, type AnalysisRun, type RawTrackingFrame } from './traffic-analysis.js';

const EXPECTED_CHECKPOINT_SHA256 = '9b09cc8bf347f0fc8a5f7657480587f25db09b34bf33b0652110fb03a8ad4fef';
export const DEFAULT_ANALYSIS_TIMEOUT_MS = 15 * 60 * 1000;
const inferenceDirectory = path.join(path.dirname(fileURLToPath(import.meta.url)), 'inference');

export type TrackingOutput = {
  width: number;
  height: number;
  frames: RawTrackingFrame[];
  signalPixelObservations: RawSignalPixelObservation[];
  provenance: {
    checkpoint: string;
    checkpointSha256: string;
    runtime: string;
    runtimeVersion: string;
    pythonVersion: string;
    pytorchVersion: string;
    platform: string;
    device: 'cpu';
    tracker: string;
    trackerConfigSha256: string;
    trackerConfig: Record<string, unknown>;
    sampling: string;
    timestampSource: string;
    confidenceThreshold: number;
    imageSize: number;
    classFilter: { id: number; name: string };
    decodedFrameCount: number;
    inferenceSeconds: number;
  };
};

type RunOptions = {
  dataDirectory: string;
  videoId: string;
  upload: UploadJob;
  configurationId: unknown;
  sourcePath: string;
  runTracking?: (sourcePath: string, outputPath: string, signalRegion: SceneConfigurationSnapshot['geometry']['signalRegion']) => Promise<TrackingOutput>;
  inferenceTimeoutMs?: number;
  now?: () => string;
};

function digest(bytes: Buffer): string {
  return createHash('sha256').update(bytes).digest('hex');
}

function recordDirectory(dataDirectory: string, videoId: string): string {
  return path.join(dataDirectory, 'videos', videoId, 'analysis-runs');
}

function recordPath(dataDirectory: string, videoId: string, runId: string): string {
  return path.join(recordDirectory(dataDirectory, videoId), `${runId}.json`);
}

async function persistRun(dataDirectory: string, run: AnalysisRun): Promise<void> {
  const directory = recordDirectory(dataDirectory, run.videoId);
  const target = recordPath(dataDirectory, run.videoId, run.id);
  const temporary = `${target}.${randomUUID()}.tmp`;
  await mkdir(directory, { recursive: true, mode: 0o700 });
  try {
    await writeFile(temporary, `${JSON.stringify(run, null, 2)}\n`, { flag: 'wx', mode: 0o600 });
    await rename(temporary, target);
  } finally {
    await rm(temporary, { force: true });
  }
}

async function readConfiguration(dataDirectory: string, videoId: string, upload: UploadJob, configurationId: unknown): Promise<SceneConfigurationSnapshot> {
  if (typeof configurationId !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(configurationId)) {
    throw new MediaError('SCENE_CONFIGURATION_REQUIRED', 'Save a valid scene configuration before starting car tracking.', 422);
  }
  const filename = path.join(dataDirectory, 'videos', videoId, 'configurations', `${configurationId}.json`);
  let snapshot: SceneConfigurationSnapshot;
  try {
    snapshot = JSON.parse(await readFile(filename, 'utf8')) as SceneConfigurationSnapshot;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      throw new MediaError('SCENE_CONFIGURATION_REQUIRED', 'Save a valid scene configuration before starting car tracking.', 422);
    }
    throw error;
  }
  const invalidFields = invalidGeometryFields(snapshot.geometry);
  if (snapshot.schemaVersion !== 1 || snapshot.id !== configurationId || snapshot.source.videoId !== videoId
    || snapshot.source.sha256 !== upload.source.sha256 || snapshot.source.width !== upload.source.media.width
    || snapshot.source.height !== upload.source.media.height || invalidFields.length) {
    throw new MediaError('SCENE_CONFIGURATION_INVALID', 'The saved scene configuration does not match this uploaded source.', 422, { invalidFields });
  }
  return structuredClone(snapshot);
}

async function initialProvenance(videoId: string, upload: UploadJob): Promise<AnalysisProvenance> {
  const modelPath = process.env.YOLO_MODEL_PATH;
  const trackerPath = path.join(inferenceDirectory, 'bytetrack.yaml');
  const trackerBytes = await readFile(trackerPath);
  let checkpointSha256: string | undefined;
  if (modelPath) {
    try {
      checkpointSha256 = digest(await readFile(path.resolve(modelPath)));
    } catch {
      // Keep the queued record honest; the runner will persist a failed status with the reason.
    }
  }
  return {
    source: {
      videoId,
      sha256: upload.source.sha256,
      path: 'uploaded-original',
      durationSeconds: upload.source.media.durationSeconds,
      width: upload.source.media.width,
      height: upload.source.media.height,
    },
    detector: {
      family: 'YOLO26',
      weights: modelPath ? path.basename(modelPath) : 'yolo26n.pt',
      ...(checkpointSha256 ? { sha256: checkpointSha256 } : {}),
      runtime: 'Ultralytics',
      device: 'cpu',
    },
    tracker: { name: 'ByteTrack', configFile: 'server/inference/bytetrack.yaml', configSha256: digest(trackerBytes) },
    sampling: { strategy: 'every-decoded-frame', framesPerSample: 1, timestampSource: 'ffprobe.best_effort_timestamp_time' },
    thresholds: { confidence: 0.25, imageSize: 640, classFilter: { id: 2, name: 'car' } },
    signalRecognition: {
      method: 'configured-region-hsv',
      algorithmVersion: 1,
      minimumColorPixelRatio: 0.005,
      ambiguousColorRatio: 0.5,
      requiredConsecutiveFrames: 3,
    },
  };
}

export async function createAndQueueAnalysisRun(options: RunOptions): Promise<AnalysisRun> {
  const configurationSnapshot = await readConfiguration(options.dataDirectory, options.videoId, options.upload, options.configurationId);
  const createdAt = (options.now || (() => new Date().toISOString()))();
  const run: AnalysisRun = {
    schemaVersion: 2,
    id: randomUUID(),
    videoId: options.videoId,
    status: 'queued',
    analysisStarted: true,
    configurationSnapshot,
    provenance: await initialProvenance(options.videoId, options.upload),
    createdAt,
    updatedAt: createdAt,
  };
  await persistRun(options.dataDirectory, run);
  const accepted = structuredClone(run);
  setImmediate(() => {
    void executeAnalysisRun({ ...options, run }).catch(error => {
      console.error('Could not persist the terminal traffic-analysis run state:', error);
    });
  });
  return accepted;
}

type ExecuteOptions = RunOptions & {
  run: AnalysisRun;
  persistState?: typeof persistRun;
};

export async function executeAnalysisRun(options: ExecuteOptions): Promise<AnalysisRun> {
  const { run } = options;
  const now = options.now || (() => new Date().toISOString());
  const saveRun = options.persistState || persistRun;
  run.status = 'running';
  run.updatedAt = now();
  const outputPath = path.join(recordDirectory(options.dataDirectory, options.videoId), `${run.id}.tracking.json`);
  try {
    try {
      await saveRun(options.dataDirectory, run);
    } catch (error) {
      throw Object.assign(new Error(`Could not persist the queued-to-running transition: ${error instanceof Error ? error.message : 'run state write failed'}`), {
        code: 'ANALYSIS_RUN_STATE_PERSIST_FAILED',
      });
    }
    if (await sha256File(options.sourcePath) !== options.upload.source.sha256) {
      throw new Error('Uploaded source SHA-256 no longer matches the immutable upload record.');
    }
    const timeoutMs = validTimeout(options.inferenceTimeoutMs ?? Number(process.env.YOLO_INFERENCE_TIMEOUT_MS));
    const tracker = options.runTracking || ((source, output, signalRegion) => runUltralyticsTracker(source, output, signalRegion, timeoutMs));
    const output = await withTimeout(tracker(options.sourcePath, outputPath, run.configurationSnapshot.geometry.signalRegion), timeoutMs);
    if (await sha256File(options.sourcePath) !== options.upload.source.sha256) {
      throw new Error('Uploaded source changed while inference was running; the run was rejected.');
    }
    if (output.frames.length !== output.provenance.decodedFrameCount) throw new Error('Tracker output frame count did not match the recorded decoded frame count.');
    if (!Array.isArray(output.signalPixelObservations) || output.signalPixelObservations.length !== output.frames.length || output.signalPixelObservations.some((observation, index) => observation.frameIndex !== index || observation.timeSeconds !== output.frames[index].timeSeconds)) {
      throw new Error('Signal observations did not match every decoded source frame and presentation timestamp.');
    }
    if (output.width !== options.upload.source.media.width || output.height !== options.upload.source.media.height) {
      throw new Error('Tracker output dimensions did not match the uploaded source video.');
    }
    if (output.provenance.checkpointSha256 !== EXPECTED_CHECKPOINT_SHA256 || output.provenance.runtime !== 'Ultralytics'
      || output.provenance.tracker !== 'ByteTrack' || output.provenance.device !== 'cpu'
      || output.provenance.confidenceThreshold !== 0.25 || output.provenance.imageSize !== 640
      || output.provenance.classFilter.id !== 2 || output.provenance.classFilter.name !== 'car'
      || output.provenance.timestampSource !== 'ffprobe.best_effort_timestamp_time') {
      throw new Error('Tracker provenance does not match the approved YOLO/ByteTrack analysis configuration.');
    }
    if (output.frames.some((frame, index) => frame.frameIndex !== index)) {
      throw new Error('Tracker output omitted or reordered decoded source frames.');
    }
    run.result = {
      ...assembleTrackResult({ width: output.width, height: output.height, frames: output.frames }),
      signalTimeline: assembleSignalTimeline({
        durationSeconds: options.upload.source.media.durationSeconds,
        observations: output.signalPixelObservations.map(observation => classifySignalObservation(
          observation.frameIndex,
          observation.timeSeconds,
          observation.colorScores,
          observation.signalRegionTooSmall,
        )),
      }),
    };
    run.provenance.detector = {
      ...run.provenance.detector,
      weights: output.provenance.checkpoint,
      sha256: output.provenance.checkpointSha256,
      runtime: output.provenance.runtime as 'Ultralytics',
      runtimeVersion: output.provenance.runtimeVersion,
      pythonVersion: output.provenance.pythonVersion,
      pytorchVersion: output.provenance.pytorchVersion,
      platform: output.provenance.platform,
      inferenceSeconds: output.provenance.inferenceSeconds,
      device: output.provenance.device,
    };
    run.provenance.tracker = {
      name: output.provenance.tracker as 'ByteTrack',
      configFile: 'server/inference/bytetrack.yaml',
      configSha256: output.provenance.trackerConfigSha256,
      config: output.provenance.trackerConfig,
    };
    run.provenance.sampling = {
      strategy: 'every-decoded-frame',
      framesPerSample: 1,
      timestampSource: 'ffprobe.best_effort_timestamp_time',
      decodedFrameCount: output.provenance.decodedFrameCount,
    };
    run.provenance.thresholds = {
      confidence: output.provenance.confidenceThreshold,
      imageSize: output.provenance.imageSize,
      classFilter: { id: 2, name: 'car' },
    };
    run.status = 'completed';
    delete run.error;
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    run.status = 'failed';
    run.error = {
      code: typeof code === 'string' ? code : 'YOLO_INFERENCE_FAILED',
      message: error instanceof Error ? error.message : 'YOLO inference failed.',
      stage: 'inference',
    };
    delete run.result;
  } finally {
    run.updatedAt = now();
    try {
      await saveRun(options.dataDirectory, run);
    } catch (error) {
      console.error('Could not persist the terminal traffic-analysis run state:', error);
    }
    await rm(outputPath, { force: true });
  }
  return run;
}

function validTimeout(value: number | undefined): number {
  return Number.isSafeInteger(value) && value! > 0 ? value! : DEFAULT_ANALYSIS_TIMEOUT_MS;
}

function withTimeout<T>(operation: Promise<T>, timeoutMs: number): Promise<T> {
  let timer: NodeJS.Timeout;
  const timeout = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => reject(Object.assign(new Error(`Traffic analysis timed out after ${timeoutMs} ms.`), { code: 'ANALYSIS_INFERENCE_TIMEOUT' })), timeoutMs);
  });
  return Promise.race([operation, timeout]).finally(() => clearTimeout(timer!));
}

export async function recoverInterruptedAnalysisRuns(
  dataDirectory: string,
  now: () => string = () => new Date().toISOString(),
): Promise<number> {
  const videosDirectory = path.join(dataDirectory, 'videos');
  const videoEntries = await readdir(videosDirectory, { withFileTypes: true }).catch((error: NodeJS.ErrnoException) => {
    if (error.code === 'ENOENT') return [];
    throw error;
  });
  let recovered = 0;
  for (const videoEntry of videoEntries) {
    if (!videoEntry.isDirectory()) continue;
    const directory = recordDirectory(dataDirectory, videoEntry.name);
    const records = await readdir(directory, { withFileTypes: true }).catch((error: NodeJS.ErrnoException) => {
      if (error.code === 'ENOENT') return [];
      throw error;
    });
    for (const record of records) {
      if (!record.isFile() || !/^[0-9a-f-]{36}\.json$/i.test(record.name)) continue;
      const filename = path.join(directory, record.name);
      let run: AnalysisRun;
      try {
        run = JSON.parse(await readFile(filename, 'utf8')) as AnalysisRun;
      } catch {
        continue;
      }
      if (run.videoId !== videoEntry.name || (run.status !== 'queued' && run.status !== 'running')) continue;
      run.status = 'failed';
      run.error = {
        code: 'ANALYSIS_WORKER_INTERRUPTED',
        message: 'The server restarted before car tracking completed. Start a new analysis run.',
        stage: 'inference',
      };
      delete run.result;
      run.updatedAt = now();
      await persistRun(dataDirectory, run);
      recovered += 1;
    }
  }
  return recovered;
}

export async function readAnalysisRun(dataDirectory: string, videoId: string, runId: string): Promise<AnalysisRun | undefined> {
  if (!/^[0-9a-f-]{36}$/i.test(runId)) return undefined;
  try {
    return JSON.parse(await readFile(recordPath(dataDirectory, videoId, runId), 'utf8')) as AnalysisRun;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
    throw error;
  }
}

function runUltralyticsTracker(sourcePath: string, outputPath: string, signalRegion: SceneConfigurationSnapshot['geometry']['signalRegion'], timeoutMs: number): Promise<TrackingOutput> {
  const modelPath = process.env.YOLO_MODEL_PATH;
  if (!modelPath) return Promise.reject(Object.assign(new Error('Set YOLO_MODEL_PATH to the qualified yolo26n.pt checkpoint to enable traffic analysis and signal recognition.'), { code: 'YOLO_MODEL_NOT_CONFIGURED' }));
  const pythonPath = process.env.YOLO_PYTHON_PATH || 'python3';
  const scriptPath = path.join(inferenceDirectory, 'track-cars.py');
  const trackerPath = path.join(inferenceDirectory, 'bytetrack.yaml');
  const temporaryOutput = `${outputPath}.${randomUUID()}.tmp.json`;
  return new Promise((resolve, reject) => {
    const child = spawn(pythonPath, [scriptPath, '--source', sourcePath, '--weights', modelPath, '--tracker', trackerPath, '--output', temporaryOutput, '--signal-region-json', JSON.stringify(signalRegion), '--ffprobe', process.env.FFPROBE_PATH || 'ffprobe'], { shell: false, stdio: ['ignore', 'ignore', 'pipe'] });
    let stderr = '';
    let timedOut = false;
    let killTimer: NodeJS.Timeout | undefined;
    const timeout = setTimeout(() => {
      timedOut = true;
      child.kill('SIGTERM');
      killTimer = setTimeout(() => child.kill('SIGKILL'), 2_000);
    }, timeoutMs);
    child.stderr.setEncoding('utf8');
    child.stderr.on('data', chunk => { stderr = (stderr + chunk).slice(-16_000); });
    child.once('error', error => {
      clearTimeout(timeout);
      if (killTimer) clearTimeout(killTimer);
      reject(Object.assign(new Error(`Could not start the configured YOLO Python runtime: ${error.message}`), { code: 'YOLO_RUNTIME_UNAVAILABLE' }));
    });
    child.once('close', async code => {
      clearTimeout(timeout);
      if (killTimer) clearTimeout(killTimer);
      if (timedOut) {
        await rm(temporaryOutput, { force: true });
        return reject(Object.assign(new Error(`Traffic analysis timed out after ${timeoutMs} ms; the inference process was terminated.`), { code: 'ANALYSIS_INFERENCE_TIMEOUT' }));
      }
      if (code !== 0) {
        await rm(temporaryOutput, { force: true });
        return reject(Object.assign(new Error(stderr.trim().slice(-2_000) || `YOLO inference exited with code ${code}.`), { code: 'YOLO_INFERENCE_FAILED' }));
      }
      try {
        const output = JSON.parse(await readFile(temporaryOutput, 'utf8')) as TrackingOutput;
        await rm(temporaryOutput, { force: true });
        resolve(output);
      } catch (error) {
        await rm(temporaryOutput, { force: true });
        reject(Object.assign(new Error(`YOLO inference output is invalid: ${error instanceof Error ? error.message : 'invalid JSON'}`), { code: 'YOLO_OUTPUT_INVALID' }));
      }
    });
  });
}
