import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { readFile, realpath } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const EXPECTED_EVENT_TYPES = ['red_crossing', 'green_crossing', 'correct_stop'];
const INFERENCE_DATA_KEYS = new Set(['inference', 'detections', 'predictions', 'modeloutput', 'inferenceresults']);
const SHA256_PATTERN = /^[a-f0-9]{64}$/i;

function requireCondition(condition, message) {
  if (!condition) throw new Error(message);
}

async function resolveAssetFile(assetDirectory, relativePath, fieldName) {
  requireCondition(typeof relativePath === 'string' && relativePath.length > 0, `${fieldName} path is required`);
  requireCondition(!path.isAbsolute(relativePath), `${fieldName} path must stay inside the asset directory`);

  const resolvedPath = path.resolve(assetDirectory, relativePath);
  const relativeToAsset = path.relative(assetDirectory, resolvedPath);
  requireCondition(
    relativeToAsset !== '' && relativeToAsset !== '..' && !relativeToAsset.startsWith(`..${path.sep}`) && !path.isAbsolute(relativeToAsset),
    `${fieldName} path must stay inside the asset directory`,
  );
  const [realAssetDirectory, realResolvedPath] = await Promise.all([
    realpath(assetDirectory),
    realpath(resolvedPath).catch((error) => {
      throw new Error(`unable to resolve ${fieldName} path: ${error.message}`, { cause: error });
    }),
  ]);
  const realRelativeToAsset = path.relative(realAssetDirectory, realResolvedPath);
  requireCondition(
    realRelativeToAsset !== '' && realRelativeToAsset !== '..' && !realRelativeToAsset.startsWith(`..${path.sep}`) && !path.isAbsolute(realRelativeToAsset),
    `${fieldName} path must stay inside the asset directory`,
  );
  return realResolvedPath;
}

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

function containsInferenceData(value) {
  if (Array.isArray(value)) return value.some(containsInferenceData);
  if (!value || typeof value !== 'object') return false;
  return Object.entries(value).some(([key, nestedValue]) =>
    INFERENCE_DATA_KEYS.has(key.toLowerCase()) || containsInferenceData(nestedValue));
}

function probeVideo(filename) {
  let output;
  try {
    output = execFileSync(process.env.FFPROBE_PATH || 'ffprobe', [
      '-v', 'error',
      '-select_streams', 'v:0',
      '-show_entries', 'stream=codec_name,width,height,avg_frame_rate,r_frame_rate,duration:format=duration,format_name',
      '-of', 'json',
      filename,
    ], { encoding: 'utf8' });
  } catch (error) {
    throw new Error(`unable to probe source video with ffprobe: ${error.message}`, { cause: error });
  }

  let metadata;
  try {
    metadata = JSON.parse(output);
  } catch (error) {
    throw new Error('ffprobe returned invalid JSON for source video', { cause: error });
  }
  const stream = metadata.streams?.[0];
  requireCondition(stream, 'ffprobe did not find a video stream');
  const [rateNumerator, rateDenominator] = (stream.avg_frame_rate || stream.r_frame_rate || '').split('/').map(Number);
  const frameRate = rateDenominator ? rateNumerator / rateDenominator : rateNumerator;
  const durationSeconds = Number(stream.duration ?? metadata.format?.duration);
  return { stream, format: metadata.format, frameRate, durationSeconds };
}

async function readJson(filename, fieldName) {
  let contents;
  try {
    contents = await readFile(filename, 'utf8');
  } catch (error) {
    throw new Error(`unable to read ${fieldName}: ${error.message}`, { cause: error });
  }
  try {
    return JSON.parse(contents);
  } catch (error) {
    throw new Error(`${fieldName} must contain valid JSON`, { cause: error });
  }
}

export async function validateDemoManifest(manifestPath) {
  const absoluteManifestPath = path.resolve(manifestPath);
  const assetDirectory = path.dirname(absoluteManifestPath);
  const manifest = await readJson(absoluteManifestPath, 'manifest');

  requireCondition(manifest?.schemaVersion === 1, 'manifest schemaVersion must be 1');
  requireCondition(manifest?.synthetic === true, 'manifest must label the source as synthetic');
  requireCondition(manifest.video && typeof manifest.video === 'object', 'manifest video metadata is required');
  requireCondition(manifest.groundTruth && typeof manifest.groundTruth === 'object', 'manifest groundTruth reference is required');
  requireCondition(!Object.hasOwn(manifest, 'inference'), 'inference outputs must not be stored in the asset manifest');

  const [videoPath, groundTruthPath] = await Promise.all([
    resolveAssetFile(assetDirectory, manifest.video.path, 'video'),
    resolveAssetFile(assetDirectory, manifest.groundTruth.path, 'groundTruth'),
  ]);
  requireCondition(videoPath !== groundTruthPath, 'groundTruth must be separate from the source video');
  requireCondition(SHA256_PATTERN.test(manifest.video.sha256 ?? ''), 'video SHA-256 must be a 64-character hexadecimal digest');
  requireCondition(SHA256_PATTERN.test(manifest.groundTruth.sha256 ?? ''), 'groundTruth SHA-256 must be a 64-character hexadecimal digest');
  requireCondition(typeof manifest.video.mimeType === 'string' && manifest.video.mimeType.startsWith('video/'), 'video mimeType must start with video/');
  requireCondition(Number.isInteger(manifest.video.width) && manifest.video.width > 0, 'video width must be a positive integer');
  requireCondition(Number.isInteger(manifest.video.height) && manifest.video.height > 0, 'video height must be a positive integer');
  requireCondition(Number.isFinite(manifest.video.durationSeconds) && manifest.video.durationSeconds > 0, 'video durationSeconds must be positive');
  requireCondition(Number.isFinite(manifest.video.frameRate) && manifest.video.frameRate > 0, 'video frameRate must be positive');

  const [videoBytes, annotationBytes] = await Promise.all([
    readFile(videoPath).catch((error) => { throw new Error(`unable to read source video: ${error.message}`, { cause: error }); }),
    readFile(groundTruthPath).catch((error) => { throw new Error(`unable to read groundTruth: ${error.message}`, { cause: error }); }),
  ]);
  requireCondition(sha256(videoBytes) === manifest.video.sha256.toLowerCase(), 'video SHA-256 does not match the source file');
  requireCondition(sha256(annotationBytes) === manifest.groundTruth.sha256.toLowerCase(), 'groundTruth SHA-256 does not match the annotation file');

  const probedVideo = probeVideo(videoPath);
  requireCondition(probedVideo.format?.format_name?.split(',').includes('mp4'), 'source video container is not MP4');
  requireCondition(manifest.video.codec === probedVideo.stream.codec_name, 'video codec does not match the probed stream');
  requireCondition(manifest.video.width === probedVideo.stream.width, 'video width does not match the probed stream');
  requireCondition(manifest.video.height === probedVideo.stream.height, 'video height does not match the probed stream');
  requireCondition(Math.abs(manifest.video.durationSeconds - probedVideo.durationSeconds) <= 0.001, 'video duration does not match the probed stream');
  requireCondition(Math.abs(manifest.video.frameRate - probedVideo.frameRate) <= 0.001, 'video frameRate does not match the probed stream');

  const annotations = await readJson(groundTruthPath, 'groundTruth');
  requireCondition(annotations?.schemaVersion === 1, 'groundTruth schemaVersion must be 1');
  requireCondition(!containsInferenceData(annotations), 'inference output must remain separate from groundTruth');
  requireCondition(Array.isArray(annotations.events), 'groundTruth events must be an array');
  const eventCounts = Object.fromEntries(EXPECTED_EVENT_TYPES.map((type) => [type, 0]));
  const eventIds = new Set();

  for (const event of annotations.events) {
    requireCondition(typeof event?.eventId === 'string' && event.eventId.length > 0, 'each event must have an eventId');
    requireCondition(!eventIds.has(event.eventId), `duplicate eventId: ${event.eventId}`);
    eventIds.add(event.eventId);
    requireCondition(Object.hasOwn(eventCounts, event.type), `unsupported event type: ${event.type}`);
    eventCounts[event.type] += 1;
    requireCondition(Number.isFinite(event.startSeconds) && event.startSeconds >= 0, `event ${event.eventId} startSeconds must be non-negative`);
    requireCondition(Number.isFinite(event.endSeconds) && event.endSeconds > event.startSeconds, `event ${event.eventId} endSeconds must be after startSeconds`);
    requireCondition(event.endSeconds <= manifest.video.durationSeconds, `event ${event.eventId} ends after the source video`);
  }

  requireCondition(
    EXPECTED_EVENT_TYPES.every((type) => eventCounts[type] === 1),
    'groundTruth must contain exactly one red_crossing, green_crossing, and correct_stop event',
  );

  return {
    synthetic: true,
    videoSha256: manifest.video.sha256.toLowerCase(),
    groundTruthSha256: manifest.groundTruth.sha256.toLowerCase(),
    eventTypes: [...EXPECTED_EVENT_TYPES].sort(),
    eventCount: annotations.events.length,
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const [manifestPath] = process.argv.slice(2);
  if (!manifestPath) {
    console.error('Usage: node scripts/demo-manifest.mjs <path-to-manifest.json>');
    process.exitCode = 2;
  } else {
    try {
      const result = await validateDemoManifest(manifestPath);
      console.log(JSON.stringify({ valid: true, ...result }, null, 2));
    } catch (error) {
      console.error(JSON.stringify({ valid: false, error: error.message }, null, 2));
      process.exitCode = 1;
    }
  }
}
