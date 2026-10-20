import { createHash, randomUUID } from 'node:crypto';
import { execFile } from 'node:child_process';
import { mkdir, rename, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

export const SUPPORTED_EXTENSIONS = ['.mp4', '.mov', '.webm'] as const;
export const DEFAULT_MAX_UPLOAD_BYTES = 200 * 1024 * 1024;

export type VideoMetadata = {
  durationSeconds: number;
  width: number;
  height: number;
  formatName: string;
  sourceStartTimeSeconds: number;
};

export type UploadJob = {
  id: string;
  originalName: string;
  status: 'processing' | 'completed' | 'failed';
  upload: { status: 'completed'; sizeBytes: number; sha256: string };
  preview: { status: 'processing' | 'completed' | 'failed'; contentType: 'video/mp4'; url: string };
  source: { sizeBytes: number; sha256: string; media: VideoMetadata };
  derivative?: {
    url: string;
    sizeBytes: number;
    media: VideoMetadata;
    timestampMapping: { sourceSeconds: string; previewSeconds: string; offsetSeconds: number };
    coordinateMapping: {
      sourceWidth: number;
      sourceHeight: number;
      previewWidth: number;
      previewHeight: number;
      xSourcePixelsPerPreviewPixel: number;
      ySourcePixelsPerPreviewPixel: number;
      origin: 'top-left';
    };
  };
  error?: { code: string; message: string };
  createdAt: string;
  updatedAt: string;
};

export class MediaError extends Error {
  constructor(readonly code: string, message: string, readonly status: number) {
    super(message);
    this.name = 'MediaError';
  }
}

export function safeDisplayName(filename: string): string {
  const basename = path.posix.basename(filename.replaceAll('\\', '/')).trim();
  const safe = basename.replace(/[\u0000-\u001f\u007f]/g, '').slice(0, 180);
  return safe && safe !== '.' && safe !== '..' ? safe : 'uploaded-video';
}

export function validateExtension(filename: string): string {
  const extension = path.extname(safeDisplayName(filename)).toLowerCase();
  if (!(SUPPORTED_EXTENSIONS as readonly string[]).includes(extension)) {
    throw new MediaError('UNSUPPORTED_FORMAT', 'Upload an MP4, MOV, or WebM video.', 415);
  }
  return extension;
}

function mediaErrorFromProbe(error: unknown): never {
  const detail = error instanceof Error ? error.message : 'Unknown media error.';
  throw new MediaError('INVALID_MEDIA', `The uploaded file is not a readable video. Try exporting it again as MP4, MOV, or WebM. (${detail})`, 422);
}

async function run(program: string, args: string[], timeoutMs: number) {
  try {
    return await execFileAsync(program, args, { timeout: timeoutMs, maxBuffer: 8 * 1024 * 1024 });
  } catch (error) {
    const e = error as NodeJS.ErrnoException & { killed?: boolean };
    if (e.code === 'ENOENT') throw new MediaError('MEDIA_TOOL_UNAVAILABLE', `${program} is unavailable. Install FFmpeg and FFprobe to process video uploads.`, 503);
    if (e.killed) throw new MediaError('MEDIA_PROCESSING_TIMEOUT', 'Video processing exceeded the configured time limit. Try a shorter or simpler video.', 422);
    throw error;
  }
}

export async function inspectVideo(filename: string, options: { ffprobePath?: string; timeoutMs?: number } = {}): Promise<VideoMetadata> {
  const probePath = options.ffprobePath || process.env.FFPROBE_PATH || 'ffprobe';
  try {
    const { stdout } = await run(probePath, [
      '-v', 'error', '-print_format', 'json', '-show_format', '-show_streams', filename,
    ], options.timeoutMs || Number(process.env.MEDIA_PROCESS_TIMEOUT_MS) || 30_000);
    const data = JSON.parse(stdout) as {
      format?: { duration?: string; format_name?: string; start_time?: string };
      streams?: Array<{ codec_type?: string; width?: number; height?: number; start_time?: string }>;
    };
    const video = data.streams?.find(stream => stream.codec_type === 'video');
    const durationSeconds = Number(data.format?.duration);
    const width = Number(video?.width);
    const height = Number(video?.height);
    const formatName = data.format?.format_name || '';
    if (!video || !Number.isFinite(durationSeconds) || durationSeconds <= 0 || !Number.isInteger(width) || width < 1 || !Number.isInteger(height) || height < 1 || !formatName) {
      throw new Error('Missing video stream, duration, dimensions, or container metadata.');
    }
    const sourceStartTimeSeconds = Number(video.start_time ?? data.format?.start_time ?? 0);
    return {
      durationSeconds,
      width,
      height,
      formatName,
      sourceStartTimeSeconds: Number.isFinite(sourceStartTimeSeconds) ? sourceStartTimeSeconds : 0,
    };
  } catch (error) {
    if (error instanceof MediaError) throw error;
    mediaErrorFromProbe(error);
  }
}

export function validateContainer(extension: string, metadata: VideoMetadata): void {
  const format = metadata.formatName.split(',');
  const supported = extension === '.webm'
    ? format.some(name => name === 'webm' || name === 'matroska')
    : format.some(name => ['mov', 'mp4', 'm4a', '3gp', '3g2', 'mj2'].includes(name));
  if (!supported) throw new MediaError('UNSUPPORTED_FORMAT', 'The file extension does not match a supported MP4, MOV, or WebM video container.', 415);
}

export async function sha256File(filename: string): Promise<string> {
  const { createReadStream } = await import('node:fs');
  const hash = createHash('sha256');
  await new Promise<void>((resolve, reject) => createReadStream(filename)
    .on('data', chunk => hash.update(chunk))
    .on('error', reject)
    .on('end', resolve));
  return hash.digest('hex');
}

async function persistJob(dataDirectory: string, job: UploadJob): Promise<void> {
  const directory = path.join(dataDirectory, 'videos', job.id);
  const temporaryPath = path.join(directory, `job-${randomUUID()}.tmp`);
  await writeFile(temporaryPath, `${JSON.stringify(job, null, 2)}\n`, { flag: 'wx', mode: 0o600 });
  await rename(temporaryPath, path.join(directory, 'job.json'));
}

export async function persistInitialJob(dataDirectory: string, job: UploadJob): Promise<void> {
  await persistJob(dataDirectory, job);
}

export async function readJob(dataDirectory: string, id: string): Promise<UploadJob | undefined> {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return undefined;
  try {
    const content = await import('node:fs/promises').then(({ readFile }) => readFile(path.join(dataDirectory, 'videos', id, 'job.json'), 'utf8'));
    return JSON.parse(content) as UploadJob;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
    throw error;
  }
}

export async function processPreview(options: {
  dataDirectory: string;
  job: UploadJob;
  sourcePath: string;
  ffmpegPath?: string;
  ffprobePath?: string;
  timeoutMs?: number;
}): Promise<UploadJob> {
  const { dataDirectory, job, sourcePath } = options;
  const directory = path.dirname(sourcePath);
  const temporaryOutput = path.join(directory, `preview-${randomUUID()}.part.mp4`);
  const outputPath = path.join(directory, 'preview.mp4');
  const ffmpegPath = options.ffmpegPath || process.env.FFMPEG_PATH || 'ffmpeg';
  const timeoutMs = options.timeoutMs || Number(process.env.MEDIA_PROCESS_TIMEOUT_MS) || 30 * 60_000;
  try {
    await run(ffmpegPath, [
      '-nostdin', '-hide_banner', '-loglevel', 'error', '-y', '-i', sourcePath,
      '-map', '0:v:0', '-map', '0:a:0?', '-vf', 'pad=ceil(iw/2)*2:ceil(ih/2)*2',
      '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '23', '-pix_fmt', 'yuv420p',
      '-c:a', 'aac', '-b:a', '128k', '-movflags', '+faststart', temporaryOutput,
    ], timeoutMs);
    const derivativeMetadata = await inspectVideo(temporaryOutput, { ffprobePath: options.ffprobePath, timeoutMs: Math.min(timeoutMs, 30_000) });
    await rename(temporaryOutput, outputPath);
    const outputStat = await stat(outputPath);
    job.status = 'completed';
    job.preview.status = 'completed';
    job.derivative = {
      url: job.preview.url,
      sizeBytes: outputStat.size,
      media: derivativeMetadata,
      timestampMapping: {
        sourceSeconds: 'previewSeconds + offsetSeconds',
        previewSeconds: 'MP4 presentation time from zero',
        offsetSeconds: job.source.media.sourceStartTimeSeconds,
      },
      coordinateMapping: {
        sourceWidth: job.source.media.width,
        sourceHeight: job.source.media.height,
        previewWidth: derivativeMetadata.width,
        previewHeight: derivativeMetadata.height,
        xSourcePixelsPerPreviewPixel: job.source.media.width / derivativeMetadata.width,
        ySourcePixelsPerPreviewPixel: job.source.media.height / derivativeMetadata.height,
        origin: 'top-left',
      },
    };
  } catch (error) {
    job.status = 'failed';
    job.preview.status = 'failed';
    const failure = error instanceof MediaError ? error : new MediaError('PREVIEW_GENERATION_FAILED', 'The video was uploaded, but a browser-playable preview could not be created. Keep the source and retry with another MP4, MOV, or WebM export.', 422);
    job.error = { code: failure.code, message: failure.message };
  } finally {
    job.updatedAt = new Date().toISOString();
    await rm(temporaryOutput, { force: true });
    await persistJob(dataDirectory, job);
  }
  return job;
}

export async function prepareStorage(directory: string): Promise<void> {
  await mkdir(path.join(directory, 'videos'), { recursive: true, mode: 0o700 });
}
