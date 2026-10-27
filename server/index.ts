import http, { type IncomingMessage, type ServerResponse } from 'node:http';
import { createWriteStream } from 'node:fs';
import { mkdir, rm, stat } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { pipeline } from 'node:stream/promises';
import { fileURLToPath } from 'node:url';
import Busboy from 'busboy';
import {
  DEFAULT_MAX_UPLOAD_BYTES,
  MediaError,
  type UploadJob,
  inspectVideo,
  prepareStorage,
  processPreview,
  readJob,
  safeDisplayName,
  sha256File,
  validateContainer,
  validateExtension,
  SUPPORTED_EXTENSIONS,
} from './media.js';
import { saveSceneConfiguration } from './scene-configuration.js';
import { createAndQueueAnalysisRun, readAnalysisRun, recoverInterruptedAnalysisRuns, type TrackingOutput } from './analysis-run.js';

type ServerOptions = {
  dataDirectory?: string;
  maxUploadBytes?: number;
  ffmpegPath?: string;
  ffprobePath?: string;
  processingTimeoutMs?: number;
  host?: string;
  analysisRunner?: (sourcePath: string, outputPath: string) => Promise<TrackingOutput>;
  analysisTimeoutMs?: number;
};

type StoredUpload = { fieldName: string; filename: string; path: string; sizeBytes: number };

function apiError(error: unknown): MediaError {
  if (error instanceof MediaError) return error;
  const code = (error as NodeJS.ErrnoException | undefined)?.code;
  if (code === 'UPLOAD_ABORTED' || code === 'ECONNRESET' || code === 'ERR_STREAM_PREMATURE_CLOSE') {
    return new MediaError('UPLOAD_INTERRUPTED', 'The upload was interrupted. Check your connection and retry the upload.', 400);
  }
  return new MediaError('INTERNAL_ERROR', 'The video could not be uploaded. Please retry.', 500);
}

function sendJson(response: ServerResponse, status: number, payload: unknown): void {
  if (response.headersSent || response.destroyed) return;
  const body = Buffer.from(JSON.stringify(payload));
  response.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': body.length,
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
  });
  response.end(body);
}

function sendError(response: ServerResponse, error: unknown): void {
  const normalized = apiError(error);
  sendJson(response, normalized.status, {
    error: {
      code: normalized.code,
      message: normalized.message,
      ...(normalized.details === undefined ? {} : { details: normalized.details }),
    },
  });
}

async function readJsonBody(request: IncomingMessage, maxBytes = 128 * 1024): Promise<unknown> {
  if (!(request.headers['content-type'] || '').toLowerCase().startsWith('application/json')) {
    throw new MediaError('JSON_REQUIRED', 'Send the request body as application/json.', 415);
  }
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.length;
    if (size > maxBytes) throw new MediaError('REQUEST_TOO_LARGE', 'The scene configuration request exceeds the 128 KB limit.', 413);
    chunks.push(buffer);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown;
  } catch {
    throw new MediaError('INVALID_JSON', 'The request body must contain valid JSON.', 400);
  }
}

function contentTypeFor(pathname: string): string {
  return pathname.endsWith('.mp4') ? 'video/mp4' : 'application/octet-stream';
}

export function parseByteRange(header: string | undefined, size: number): { start: number; end: number } | undefined {
  if (!header?.startsWith('bytes=') || size <= 0) return undefined;
  const match = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
  if (!match || (!match[1] && !match[2])) return undefined;
  if (!match[1]) {
    const suffix = Number(match[2]);
    return Number.isInteger(suffix) && suffix > 0 ? { start: Math.max(size - suffix, 0), end: size - 1 } : undefined;
  }
  const start = Number(match[1]);
  if (!Number.isInteger(start) || start < 0 || start >= size) return undefined;
  const requestedEnd = match[2] ? Number(match[2]) : size - 1;
  if (!Number.isInteger(requestedEnd) || requestedEnd < start) return undefined;
  return { start, end: Math.min(requestedEnd, size - 1) };
}

async function parseMultipartUpload(request: IncomingMessage, tempPath: string, maxBytes: number): Promise<StoredUpload> {
  const contentType = request.headers['content-type'] || '';
  if (!contentType.toLowerCase().startsWith('multipart/form-data')) {
    throw new MediaError('MULTIPART_REQUIRED', 'Send the video as multipart/form-data in a field named "video".', 415);
  }

  return new Promise((resolve, reject) => {
    let upload: StoredUpload | undefined;
    let writePromise: Promise<void> | undefined;
    let failure: Error | undefined;
    let settled = false;
    const finishError = (error: Error) => {
      if (settled) return;
      settled = true;
      reject(error);
    };
    let parser: ReturnType<typeof Busboy>;
    try {
      parser = Busboy({
        headers: request.headers,
        limits: { fileSize: maxBytes, files: 1, fields: 0 },
      });
    } catch {
      finishError(new MediaError('INVALID_MULTIPART', 'The upload request has an invalid multipart boundary.', 400));
      return;
    }

    request.once('aborted', () => {
      failure = Object.assign(new Error('Upload request ended before the file was complete.'), { code: 'UPLOAD_ABORTED' });
      finishError(failure);
    });
    parser.on('file', (fieldName, file, info) => {
      if (fieldName !== 'video') {
        failure = new MediaError('VIDEO_FIELD_REQUIRED', 'Send one video file in the multipart field named "video".', 400);
        file.resume();
        return;
      }
      if (upload) {
        failure = new MediaError('MULTIPLE_FILES', 'Upload one video file at a time.', 400);
        file.resume();
        return;
      }
      const displayName = safeDisplayName(info.filename || 'uploaded-video');
      upload = { fieldName, filename: displayName, path: tempPath, sizeBytes: 0 };
      file.once('limit', () => { failure = new MediaError('FILE_TOO_LARGE', `The video exceeds the ${Math.floor(maxBytes / (1024 * 1024))} MB upload limit.`, 413); });
      writePromise = pipeline(file, createWriteStream(tempPath, { flags: 'wx', mode: 0o600 }))
        .then(async () => {
          if (upload) upload.sizeBytes = (await stat(tempPath)).size;
          if (file.truncated) failure = new MediaError('FILE_TOO_LARGE', `The video exceeds the ${Math.floor(maxBytes / (1024 * 1024))} MB upload limit.`, 413);
        })
        .catch(error => { failure ||= error as Error; });
    });
    parser.on('filesLimit', () => { failure = new MediaError('MULTIPLE_FILES', 'Upload one video file at a time.', 400); });
    parser.on('fieldsLimit', () => { failure = new MediaError('UNEXPECTED_FIELDS', 'The upload request must contain only the video file.', 400); });
    parser.once('error', error => {
      const normalized = error instanceof Error ? error : new Error('Invalid multipart request.');
      failure = normalized;
      finishError(normalized);
    });
    parser.once('close', async () => {
      if (writePromise) await writePromise;
      if (settled) return;
      if (failure) return finishError(failure);
      if (!upload) return finishError(new MediaError('VIDEO_REQUIRED', 'Choose one MP4, MOV, or WebM video to upload.', 400));
      if (upload.sizeBytes === 0) return finishError(new MediaError('EMPTY_FILE', 'The selected video is empty. Choose a non-empty MP4, MOV, or WebM file.', 422));
      settled = true;
      resolve(upload);
    });
    request.pipe(parser);
  });
}

function videoIdFromPath(pathname: string): string | undefined {
  const match = /^\/api\/videos\/([0-9a-f-]{36})(?:\/(preview))?$/i.exec(pathname);
  return match?.[1];
}

function safeSourcePath(dataDirectory: string, id: string, extension: string): string | undefined {
  if (!/^[0-9a-f-]{36}$/i.test(id) || !SUPPORTED_EXTENSIONS.includes(extension as typeof SUPPORTED_EXTENSIONS[number])) return undefined;
  const directory = path.resolve(dataDirectory, 'videos', id);
  const source = path.resolve(directory, `source${extension}`);
  return source.startsWith(`${directory}${path.sep}`) ? source : undefined;
}

async function handlePreview(request: IncomingMessage, response: ServerResponse, dataDirectory: string, id: string): Promise<void> {
  const job = await readJob(dataDirectory, id);
  if (!job) return sendJson(response, 404, { error: { code: 'VIDEO_NOT_FOUND', message: 'Upload not found.' } });
  if (job.preview.status === 'processing') return sendJson(response, 409, { error: { code: 'PREVIEW_PROCESSING', message: 'The upload is saved and its browser-playable preview is still being prepared. Poll the upload status and retry playback when it is ready.' } });
  if (job.preview.status !== 'completed') return sendJson(response, 409, { error: { code: 'PREVIEW_UNAVAILABLE', message: job.error?.message || 'A playable preview is unavailable. Retry the upload.' } });

  const filename = path.join(dataDirectory, 'videos', id, 'preview.mp4');
  const fileStat = await stat(filename).catch(() => undefined);
  if (!fileStat?.isFile()) return sendJson(response, 404, { error: { code: 'PREVIEW_NOT_FOUND', message: 'The preview file is no longer available.' } });
  const range = request.headers.range ? parseByteRange(request.headers.range, fileStat.size) : undefined;
  if (request.headers.range && !range) {
    response.writeHead(416, { 'content-range': `bytes */${fileStat.size}`, 'accept-ranges': 'bytes', 'content-length': '0' });
    response.end();
    return;
  }
  const start = range?.start ?? 0;
  const end = range?.end ?? fileStat.size - 1;
  response.writeHead(range ? 206 : 200, {
    'content-type': contentTypeFor(filename),
    'content-length': end - start + 1,
    'accept-ranges': 'bytes',
    'cache-control': 'private, no-store',
    'x-content-type-options': 'nosniff',
    ...(range ? { 'content-range': `bytes ${start}-${end}/${fileStat.size}` } : {}),
  });
  const { createReadStream } = await import('node:fs');
  const stream = createReadStream(filename, { start, end });
  stream.on('error', () => { if (!response.headersSent) sendJson(response, 404, { error: { code: 'PREVIEW_NOT_FOUND', message: 'The preview file is no longer available.' } }); else response.destroy(); });
  stream.pipe(response);
}

export function createMediaServer(options: ServerOptions = {}): http.Server {
  const dataDirectory = path.resolve(options.dataDirectory || process.env.LOCAL_DATA_DIR || '.local-data');
  const maxUploadBytes = options.maxUploadBytes ?? (Number(process.env.MAX_UPLOAD_BYTES) || DEFAULT_MAX_UPLOAD_BYTES);
  if (!Number.isSafeInteger(maxUploadBytes) || maxUploadBytes < 1) throw new Error('MAX_UPLOAD_BYTES must be a positive integer.');

  let startupRecovery = Promise.resolve(0);
  const server = http.createServer(async (request, response) => {
    await startupRecovery;
    const url = new URL(request.url || '/', 'http://localhost');
    if (request.method === 'GET' && url.pathname === '/api/uploads/limits') {
      return sendJson(response, 200, {
        supportedFormats: [...SUPPORTED_EXTENSIONS],
        maxUploadBytes,
        maxUploadMegabytes: Math.floor(maxUploadBytes / (1024 * 1024)),
        durationLimitSeconds: null,
        fieldName: 'video',
      });
    }

    if (request.method === 'POST' && url.pathname === '/api/videos') {
      const id = randomUUID();
      const directory = path.join(dataDirectory, 'videos', id);
      const tempPath = path.join(directory, 'source.uploading');
      let sourcePath: string | undefined;
      try {
        await mkdir(directory, { recursive: true, mode: 0o700 });
        const uploaded = await parseMultipartUpload(request, tempPath, maxUploadBytes);
        const extension = validateExtension(uploaded.filename);
        const sourceMetadata = await inspectVideo(tempPath, { ffprobePath: options.ffprobePath });
        validateContainer(extension, sourceMetadata);
        const digest = await sha256File(tempPath);
        sourcePath = safeSourcePath(dataDirectory, id, extension);
        if (!sourcePath) throw new MediaError('INVALID_FILENAME', 'The uploaded filename is not supported. Rename it and try again.', 400);
        await import('node:fs/promises').then(({ rename }) => rename(tempPath, sourcePath!));
        const now = new Date().toISOString();
        const job: UploadJob = {
          schemaVersion: 1,
          id,
          originalName: uploaded.filename,
          status: 'processing',
          upload: { status: 'completed', sizeBytes: uploaded.sizeBytes, sha256: digest },
          preview: { status: 'processing', contentType: 'video/mp4', url: `/api/videos/${id}/preview` },
          source: { sizeBytes: uploaded.sizeBytes, sha256: digest, media: sourceMetadata },
          createdAt: now,
          updatedAt: now,
        };
        const { persistInitialJob } = await import('./media.js');
        await persistInitialJob(dataDirectory, job);
        void processPreview({
          dataDirectory,
          job,
          sourcePath,
          ffmpegPath: options.ffmpegPath,
          ffprobePath: options.ffprobePath,
          timeoutMs: options.processingTimeoutMs,
        }).catch(error => console.error('Unexpected preview job failure:', error));
        return sendJson(response, 201, job);
      } catch (error) {
        await rm(tempPath, { force: true }).catch(() => undefined);
        if (sourcePath) await rm(sourcePath, { force: true }).catch(() => undefined);
        if (!response.destroyed && !request.aborted) sendError(response, error);
        await rm(directory, { recursive: true, force: true }).catch(() => undefined);
        return;
      }
    }

    const sceneRoute = /^\/api\/videos\/([0-9a-f-]{36})\/(configurations|analysis-runs)(?:\/([0-9a-f-]{36}))?$/i.exec(url.pathname);
    if (sceneRoute) {
      const videoId = sceneRoute[1];
      const collection = sceneRoute[2];
      const itemId = sceneRoute[3];
      const job = await readJob(dataDirectory, videoId);
      if (!job) return sendJson(response, 404, { error: { code: 'VIDEO_NOT_FOUND', message: 'Upload not found.' } });

      try {
        if (collection === 'configurations' && request.method === 'POST' && !itemId) {
          const input = await readJsonBody(request);
          const snapshot = await saveSceneConfiguration(dataDirectory, videoId, job, input);
          return sendJson(response, 201, snapshot);
        }
        if (collection === 'analysis-runs' && request.method === 'POST' && !itemId) {
          const input = await readJsonBody(request);
          const configurationId = input !== null && typeof input === 'object' && !Array.isArray(input)
            ? (input as Record<string, unknown>).configurationId
            : undefined;
          const extension = path.extname(job.originalName).toLowerCase();
          const sourcePath = safeSourcePath(dataDirectory, videoId, extension);
          if (!sourcePath || !(await stat(sourcePath).catch(() => undefined))?.isFile()) {
            return sendJson(response, 404, { error: { code: 'VIDEO_SOURCE_NOT_FOUND', message: 'The uploaded original source is no longer available for analysis.' } });
          }
          const run = await createAndQueueAnalysisRun({
            dataDirectory,
            videoId,
            upload: job,
            configurationId,
            sourcePath,
            inferenceTimeoutMs: options.analysisTimeoutMs,
            ...(options.analysisRunner ? { runTracking: options.analysisRunner } : {}),
          });
          return sendJson(response, 202, run);
        }
        if (collection === 'analysis-runs' && request.method === 'GET' && itemId) {
          const run = await readAnalysisRun(dataDirectory, videoId, itemId);
          if (!run) return sendJson(response, 404, { error: { code: 'ANALYSIS_RUN_NOT_FOUND', message: 'Analysis run record not found.' } });
          return sendJson(response, 200, run);
        }
      } catch (error) {
        return sendError(response, error);
      }
    }

    const id = videoIdFromPath(url.pathname);
    if (id && request.method === 'GET' && url.pathname.endsWith('/preview')) return handlePreview(request, response, dataDirectory, id);
    if (id && request.method === 'GET') {
      const job = await readJob(dataDirectory, id);
      if (!job) return sendJson(response, 404, { error: { code: 'VIDEO_NOT_FOUND', message: 'Upload not found.' } });
      return sendJson(response, 200, job);
    }
    sendJson(response, 404, { error: { code: 'NOT_FOUND', message: 'API route not found.' } });
  });

  server.on('clientError', (_error, socket) => socket.destroy());
  server.on('listening', () => {
    startupRecovery = recoverInterruptedAnalysisRuns(dataDirectory).catch(error => {
      console.error('Could not recover interrupted traffic-analysis runs:', error);
      return 0;
    });
    void prepareStorage(dataDirectory);
  });
  return server;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const port = Number(process.env.PORT || 8787);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('PORT must be an integer from 1 through 65535.');
  const dataDirectory = path.resolve(process.env.LOCAL_DATA_DIR || '.local-data');
  void prepareStorage(dataDirectory).then(() => {
    const server = createMediaServer({ dataDirectory });
    server.listen(port, process.env.HOST || '127.0.0.1', () => console.log(`Media Traffic API listening on http://${process.env.HOST || '127.0.0.1'}:${port}`));
  });
}
