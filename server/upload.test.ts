import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtemp, readFile, readdir, rm, stat } from 'node:fs/promises';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { after, before, test } from 'node:test';
import { createMediaServer } from './index.js';

const fixtureRoot = await mkdtemp(path.join(os.tmpdir(), 'media-traffic-upload-test-'));
const fixturePath = path.join(fixtureRoot, 'rights-cleared-bars.mp4');
const movFixturePath = path.join(fixtureRoot, 'rights-cleared-bars.mov');
const webmFixturePath = path.join(fixtureRoot, 'rights-cleared-bars.webm');
let server: http.Server;
let baseUrl: string;
let dataDirectory: string;

before(async () => {
  execFileSync('ffmpeg', [
    '-nostdin', '-hide_banner', '-loglevel', 'error', '-y',
    '-f', 'lavfi', '-i', 'color=c=blue:s=319x239:r=12:d=1',
    '-output_ts_offset', '2', '-c:v', 'mpeg4', '-pix_fmt', 'yuv420p', fixturePath,
  ]);
  execFileSync('ffmpeg', [
    '-nostdin', '-hide_banner', '-loglevel', 'error', '-y',
    '-f', 'lavfi', '-i', 'color=c=green:s=320x240:r=10:d=0.5',
    '-c:v', 'mpeg4', '-q:v', '5', '-an', '-f', 'mov', movFixturePath,
  ]);
  execFileSync('ffmpeg', [
    '-nostdin', '-hide_banner', '-loglevel', 'error', '-y',
    '-f', 'lavfi', '-i', 'color=c=red:s=320x240:r=10:d=0.5',
    '-c:v', 'libvpx-vp9', '-deadline', 'realtime', '-cpu-used', '8', '-an', '-f', 'webm', webmFixturePath,
  ]);
  dataDirectory = await mkdtemp(path.join(os.tmpdir(), 'media-traffic-api-data-'));
  server = createMediaServer({ dataDirectory, maxUploadBytes: 1024 * 1024 });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  assert.ok(address && typeof address === 'object');
  baseUrl = `http://127.0.0.1:${address.port}`;
});

after(async () => {
  server.closeAllConnections();
  await new Promise<void>(resolve => server.close(() => resolve()));
  await rm(dataDirectory, { recursive: true, force: true });
  await rm(fixtureRoot, { recursive: true, force: true });
});

function multipart(filename: string, file: Buffer, field = 'video') {
  const boundary = `media-traffic-${Math.random().toString(16).slice(2)}`;
  const header = Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${field}"; filename="${filename}"\r\nContent-Type: video/mp4\r\n\r\n`);
  const footer = Buffer.from(`\r\n--${boundary}--\r\n`);
  return { body: Buffer.concat([header, file, footer]), contentType: `multipart/form-data; boundary=${boundary}` };
}

async function upload(filename: string, bytes: Buffer, options: { field?: string; contentType?: string } = {}) {
  const form = multipart(filename, bytes, options.field);
  return fetch(`${baseUrl}/api/videos`, {
    method: 'POST',
    headers: { 'content-type': options.contentType || form.contentType },
    body: form.body,
  });
}

async function waitForJob(id: string, expected: string) {
  const deadline = Date.now() + 10_000;
  let job: Record<string, any> | undefined;
  while (Date.now() < deadline) {
    const response = await fetch(`${baseUrl}/api/videos/${id}`);
    assert.equal(response.status, 200);
    job = await response.json() as Record<string, any>;
    if (job.status === expected) return job;
    await new Promise(resolve => setTimeout(resolve, 30));
  }
  assert.fail(`Upload job did not reach ${expected}; last state was ${job?.status}`);
}

async function filesUnder(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true }).catch(() => []);
  const result: string[] = [];
  for (const entry of entries) {
    const item = path.join(directory, entry.name);
    if (entry.isDirectory()) result.push(...await filesUnder(item));
    else result.push(item);
  }
  return result;
}

test('limits endpoint is the authoritative UI contract', async () => {
  const response = await fetch(`${baseUrl}/api/uploads/limits`);
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    supportedFormats: ['.mp4', '.mov', '.webm'],
    maxUploadBytes: 1024 * 1024,
    maxUploadMegabytes: 1,
    durationLimitSeconds: null,
    fieldName: 'video',
  });
});

test('rejects unsupported extension, empty file, corrupt video, and over-limit body', async () => {
  const unsupported = await upload('traffic.avi', Buffer.from('not a video'));
  assert.equal(unsupported.status, 415, JSON.stringify(await unsupported.clone().json()));
  assert.equal((await unsupported.json() as any).error.code, 'UNSUPPORTED_FORMAT');

  const empty = await upload('empty.mp4', Buffer.alloc(0));
  assert.equal(empty.status, 422);
  assert.equal((await empty.json() as any).error.code, 'EMPTY_FILE');

  const corrupt = await upload('corrupt.mp4', Buffer.from('this is not an mp4 file'));
  assert.equal(corrupt.status, 422);
  assert.equal((await corrupt.json() as any).error.code, 'INVALID_MEDIA');

  const oversized = await upload('oversized.mp4', Buffer.alloc(1024 * 1024 + 1, 1));
  assert.equal(oversized.status, 413);
  assert.equal((await oversized.json() as any).error.code, 'FILE_TOO_LARGE');

  const files = await filesUnder(path.join(dataDirectory, 'videos'));
  assert.deepEqual(files, [], 'rejected uploads leave no source, derivative, job or partial files');
});

test('valid upload stores an immutable source and generates a separately playable derivative', async () => {
  const sourceBytes = await readFile(fixturePath);
  const response = await upload('../../unsafe-name.mp4', sourceBytes);
  assert.equal(response.status, 201, JSON.stringify(await response.clone().json()));
  const accepted = await response.json() as Record<string, any>;
  assert.equal(accepted.schemaVersion, 1);
  assert.equal(accepted.originalName, 'unsafe-name.mp4');
  assert.equal(accepted.upload.status, 'completed');
  assert.equal(accepted.preview.status, 'processing');
  assert.equal('analysis' in accepted, false, 'upload job must not imply analysis ran');

  const completed = await waitForJob(accepted.id, 'completed');
  assert.equal(completed.preview.status, 'completed');
  assert.equal(completed.error, undefined);
  assert.equal(completed.source.sizeBytes, sourceBytes.length);
  assert.equal(completed.source.sha256, accepted.source.sha256);
  assert.equal(completed.derivative.media.formatName.includes('mp4'), true);
  assert.deepEqual([completed.source.media.width, completed.source.media.height], [319, 239]);
  assert.deepEqual([completed.derivative.media.width, completed.derivative.media.height], [320, 240]);
  assert.equal(completed.derivative.coordinateMapping.xSourcePixelsPerPreviewPixel, 319 / 320);
  assert.equal(completed.derivative.coordinateMapping.ySourcePixelsPerPreviewPixel, 239 / 240);
  assert.equal(completed.source.media.sourceStartTimeSeconds, 2);
  assert.equal(completed.derivative.timestampMapping.offsetSeconds, 2);

  const jobDirectory = path.join(dataDirectory, 'videos', accepted.id);
  const sourceFiles = (await readdir(jobDirectory)).filter(name => name.startsWith('source.'));
  assert.equal(sourceFiles.length, 1);
  assert.deepEqual(await readFile(path.join(jobDirectory, sourceFiles[0])), sourceBytes, 'source bytes remain unchanged after transcoding');

  const range = await fetch(`${baseUrl}${completed.derivative.url}`, { headers: { range: 'bytes=0-31' } });
  assert.equal(range.status, 206);
  assert.equal(range.headers.get('content-type'), 'video/mp4');
  assert.equal(range.headers.get('accept-ranges'), 'bytes');
  assert.equal((await range.arrayBuffer()).byteLength, 32);
  const unsatisfiable = await fetch(`${baseUrl}${completed.derivative.url}`, { headers: { range: 'bytes=999999999-' } });
  assert.equal(unsatisfiable.status, 416);
  assert.match(unsatisfiable.headers.get('content-range') || '', /^bytes \*\//);
});

test('accepts and creates MP4 previews from valid MOV and WebM source containers', async () => {
  for (const fixture of [
    { path: movFixturePath, extension: '.mov', expectedFormat: 'mov' },
    { path: webmFixturePath, extension: '.webm', expectedFormat: 'webm' },
  ]) {
    const response = await upload(`camera-test${fixture.extension}`, await readFile(fixture.path));
    assert.equal(response.status, 201, `${fixture.extension} should upload: ${JSON.stringify(await response.clone().json())}`);
    const accepted = await response.json() as Record<string, any>;
    assert.equal(accepted.schemaVersion, 1);
    const completed = await waitForJob(accepted.id, 'completed');
    assert.match(completed.source.media.formatName, new RegExp(fixture.expectedFormat));
    assert.equal(completed.upload.status, 'completed');
    assert.equal(completed.preview.status, 'completed');
    assert.match(completed.derivative.media.formatName, /mp4/);
    assert.ok(completed.derivative.sizeBytes > 0);
  }
});

test('preview-generation failure stays visible and retains the uploaded source for retry', async () => {
  const failingServer = createMediaServer({ dataDirectory: path.join(dataDirectory, 'failing'), maxUploadBytes: 1024 * 1024, ffmpegPath: '/no-such-ffmpeg' });
  await new Promise<void>(resolve => failingServer.listen(0, '127.0.0.1', resolve));
  const address = failingServer.address();
  assert.ok(address && typeof address === 'object');
  try {
    const form = multipart('source.mp4', await readFile(fixturePath));
    const response = await fetch(`http://127.0.0.1:${address.port}/api/videos`, { method: 'POST', headers: { 'content-type': form.contentType }, body: form.body });
    assert.equal(response.status, 201, JSON.stringify(await response.clone().json()));
    const accepted = await response.json() as Record<string, any>;
    const failed = await waitForJobAt(`http://127.0.0.1:${address.port}`, accepted.id, 'failed');
    assert.equal(failed.upload.status, 'completed');
    assert.equal(failed.preview.status, 'failed');
    assert.equal(failed.error.code, 'MEDIA_TOOL_UNAVAILABLE');
    const preview = await fetch(`http://127.0.0.1:${address.port}${failed.preview.url}`);
    assert.equal(preview.status, 409);
    assert.equal((await preview.json() as any).error.code, 'PREVIEW_UNAVAILABLE');
    assert.equal(await stat(path.join(dataDirectory, 'failing', 'videos', accepted.id, 'source.mp4')).then(info => info.isFile()), true);
  } finally {
    failingServer.closeAllConnections();
    await new Promise<void>(resolve => failingServer.close(() => resolve()));
  }
});

async function waitForJobAt(origin: string, id: string, expected: string) {
  const deadline = Date.now() + 10_000;
  let job: Record<string, any> | undefined;
  while (Date.now() < deadline) {
    const response = await fetch(`${origin}/api/videos/${id}`);
    assert.equal(response.status, 200);
    job = await response.json() as Record<string, any>;
    if (job.status === expected) return job;
    await new Promise(resolve => setTimeout(resolve, 30));
  }
  assert.fail(`Upload job did not reach ${expected}; last state was ${job?.status}`);
}

test('cleans a temporary upload file when the client interrupts the request', async () => {
  const boundary = 'interrupted-upload';
  const partialBody = Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="video"; filename="partial.mp4"\r\nContent-Type: video/mp4\r\n\r\npartial`);
  await new Promise<void>(resolve => {
    const request = http.request(new URL('/api/videos', baseUrl), {
      method: 'POST',
      headers: { 'content-type': `multipart/form-data; boundary=${boundary}`, 'content-length': partialBody.length + 1000 },
    });
    request.on('error', () => resolve());
    request.write(partialBody);
    setTimeout(() => { request.destroy(); resolve(); }, 50);
  });
  await new Promise(resolve => setTimeout(resolve, 150));
  const files = await filesUnder(path.join(dataDirectory, 'videos'));
  assert.equal(files.some(file => file.includes('.uploading')), false);
});
