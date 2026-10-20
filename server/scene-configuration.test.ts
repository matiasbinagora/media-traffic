import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { after, before, test } from 'node:test';
import { createMediaServer } from './index.js';

const fixtureRoot = await mkdtemp(path.join(os.tmpdir(), 'media-traffic-scene-test-'));
const fixturePath = path.join(fixtureRoot, 'scene-source.mp4');
let server: http.Server;
let baseUrl: string;
let dataDirectory: string;
let videoId: string;
let sourceSha256: string;

before(async () => {
  execFileSync('ffmpeg', [
    '-nostdin', '-hide_banner', '-loglevel', 'error', '-y',
    '-f', 'lavfi', '-i', 'color=c=blue:s=320x240:r=10:d=0.5',
    '-c:v', 'mpeg4', '-pix_fmt', 'yuv420p', fixturePath,
  ]);
  dataDirectory = await mkdtemp(path.join(os.tmpdir(), 'media-traffic-scene-data-'));
  server = createMediaServer({ dataDirectory, maxUploadBytes: 1024 * 1024 });
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
  assert.equal(firstRunResponse.status, 201, JSON.stringify(await firstRunResponse.clone().json()));
  const firstRun = await firstRunResponse.json() as Record<string, any>;
  assert.equal(firstRun.status, 'not_started');
  assert.equal(firstRun.analysisStarted, false);
  assert.deepEqual(firstRun.configurationSnapshot, first);

  const second = configuration('10000000-0000-4000-8000-000000000003', 0.9);
  const saveSecond = await saveConfiguration(second);
  assert.equal(saveSecond.status, 201, JSON.stringify(await saveSecond.clone().json()));

  const firstEvidenceResponse = await fetch(`${baseUrl}/api/videos/${videoId}/analysis-runs/${firstRun.id}`);
  assert.equal(firstEvidenceResponse.status, 200);
  const firstEvidence = await firstEvidenceResponse.json() as Record<string, any>;
  assert.deepEqual(firstEvidence.configurationSnapshot, first);
  assert.equal(firstEvidence.configurationSnapshot.geometry.stopLine.end.x, 0.8);

  const secondRunResponse = await fetch(`${baseUrl}/api/videos/${videoId}/analysis-runs`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ configurationId: second.id }),
  });
  assert.equal(secondRunResponse.status, 201, JSON.stringify(await secondRunResponse.clone().json()));
  const secondRun = await secondRunResponse.json() as Record<string, any>;
  assert.notEqual(secondRun.id, firstRun.id);
  assert.deepEqual(secondRun.configurationSnapshot, second);

  const duplicate = await saveConfiguration(first);
  assert.equal(duplicate.status, 409);
  assert.equal((await duplicate.json() as any).error.code, 'SCENE_CONFIGURATION_IMMUTABLE');
});

test('cannot create an analysis run without an explicitly saved configuration', async () => {
  const response = await fetch(`${baseUrl}/api/videos/${videoId}/analysis-runs`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ configurationId: '10000000-0000-4000-8000-000000000004' }),
  });
  assert.equal(response.status, 422);
  assert.equal((await response.json() as any).error.code, 'SCENE_CONFIGURATION_REQUIRED');
});
