import { expect, test, type Page } from '@playwright/test';
import { stat, writeFile, mkdir, rm } from 'node:fs/promises';
import path from 'node:path';

const fixturePath = path.join(process.cwd(), 'e2e/fixtures/rights-cleared-blue.mp4');
const metricsPath = path.join(process.cwd(), 'reports/per87/upload-observations.json');
const ffmpegFailureMarker = path.join(process.cwd(), '.local-data/per87-ffmpeg-failed-once');

test.beforeEach(async ({}, testInfo) => {
  if (testInfo.title.includes('real preview-transcode failure')) {
    await rm(ffmpegFailureMarker, { force: true });
    return;
  }
  await mkdir(path.dirname(ffmpegFailureMarker), { recursive: true });
  await writeFile(ffmpegFailureMarker, 'already-used\n', { flag: 'w', mode: 0o600 });
});

async function openUpload(page: Page) {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Upload a video' })).toBeVisible();
  await expect(page.getByLabel('Upload requirements')).toContainText('MP4, MOV, WEBM');
}

test('shows limits, uploads a supported clip, and replays preview without claiming analysis', async ({ page }) => {
  await openUpload(page);
  const input = page.getByLabel('Choose a video to upload');
  await input.setInputFiles(fixturePath);
  await expect(page.getByText('rights-cleared-blue.mp4')).toBeVisible();

  const startedAt = performance.now();
  const uploadResponsePromise = page.waitForResponse(response => response.request().method() === 'POST' && response.url().endsWith('/api/videos'));
  await page.getByRole('button', { name: 'Upload video' }).click();
  const uploadResponse = await uploadResponsePromise;
  const uploadAcceptedAt = performance.now();
  expect(uploadResponse.status()).toBe(201);
  const accepted = await uploadResponse.json();
  expect(accepted.upload.status).toBe('completed');
  expect(accepted.status).toBe('processing');
  expect(accepted.analysis).toBeUndefined();

  await expect(page.getByText('Preview ready')).toBeVisible({ timeout: 15_000 });
  const previewReadyAt = performance.now();
  await expect(page.getByText('ANALYSIS NOT STARTED')).toBeVisible();
  const video = page.getByLabel('Preview of rights-cleared-blue.mp4');
  await expect(video).toBeVisible();
  await video.evaluate(element => {
    const player = element as HTMLVideoElement;
    if (player.readyState < HTMLMediaElement.HAVE_METADATA) {
      return new Promise<void>((resolve, reject) => {
        player.addEventListener('loadedmetadata', () => resolve(), { once: true });
        player.addEventListener('error', () => reject(new Error('Preview failed to load in Chromium.')), { once: true });
      });
    }
    return Promise.resolve();
  });

  const completedResponse = await page.request.get(`/api/videos/${accepted.id}`);
  expect(completedResponse.status()).toBe(200);
  const completed = await completedResponse.json();
  const previewResponse = await page.request.get(completed.derivative.url);
  expect(previewResponse.status()).toBe(200);
  expect(previewResponse.headers()['content-type']).toContain('video/mp4');

  const fixture = await stat(fixturePath);
  const outputBytes = Buffer.from(await previewResponse.body()).byteLength;
  await page.screenshot({ path: path.join(process.cwd(), 'reports/per87/preview-ready.png'), fullPage: true });
  const observation = {
    classification: 'observed, no agreed performance threshold',
    runtime: { node: process.version, platform: process.platform, architecture: process.arch, browser: { name: 'Chromium', version: page.context().browser()?.version() || 'unknown' } },
    input: { path: 'e2e/fixtures/rights-cleared-blue.mp4', provenance: 'synthetic FFmpeg lavfi blue frame; no traffic imagery or ground truth', format: 'MP4/H.264', durationSeconds: 0.6, bytes: fixture.size },
    response: { uploadHttpStatus: uploadResponse.status(), previewHttpStatus: previewResponse.status(), previewContentType: previewResponse.headers()['content-type'], outputBytes },
    elapsedMs: { uploadAccepted: Math.round(uploadAcceptedAt - startedAt), previewReady: Math.round(previewReadyAt - startedAt) },
    analysis: 'not started; no analysis result was returned',
  };
  await mkdir(path.dirname(metricsPath), { recursive: true });
  await writeFile(metricsPath, `${JSON.stringify(observation, null, 2)}\n`);
  await test.info().attach('upload-observations.json', { body: JSON.stringify(observation, null, 2), contentType: 'application/json' });
});

test('shows a real preview-transcode failure and recovers on the next upload', async ({ page }) => {
  await openUpload(page);
  const input = page.getByLabel('Choose a video to upload');
  await input.setInputFiles(fixturePath);
  await page.getByRole('button', { name: 'Upload video' }).click();
  await expect(page.getByText('Preview could not be prepared')).toBeVisible({ timeout: 15_000 });
  await expect(page.getByText('Your uploaded source is preserved. Try another MP4, MOV, or WebM export.')).toBeVisible();

  await page.getByRole('button', { name: 'Choose another video' }).click();
  await input.setInputFiles(fixturePath);
  await page.getByRole('button', { name: 'Upload video' }).click();
  await expect(page.getByText('Preview ready')).toBeVisible({ timeout: 15_000 });
  await expect(page.getByText('ANALYSIS NOT STARTED')).toBeVisible();
});

test('rejects an unsupported extension before sending an upload request', async ({ page }) => {
  await openUpload(page);
  let uploadRequests = 0;
  page.on('request', request => {
    if (request.method() === 'POST' && request.url().endsWith('/api/videos')) uploadRequests += 1;
  });

  await page.getByLabel('Choose a video to upload').setInputFiles({
    name: 'traffic.avi',
    mimeType: 'video/x-msvideo',
    buffer: Buffer.from('unsupported test file'),
  });
  await expect(page.getByText('Choose an MP4, MOV, or WebM video.')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Upload video' })).toBeDisabled();
  expect(uploadRequests).toBe(0);
});

test('rejects corrupt media with retry guidance and recovers with a valid upload', async ({ page }) => {
  await openUpload(page);
  await page.getByLabel('Choose a video to upload').setInputFiles({
    name: 'corrupt.mp4',
    mimeType: 'video/mp4',
    buffer: Buffer.from('not an MP4 container'),
  });
  await page.getByRole('button', { name: 'Upload video' }).click();
  await expect(page.getByRole('alert')).toContainText('not a readable video', { timeout: 10_000 });
  await expect(page.getByRole('button', { name: 'Retry upload' })).toBeEnabled();
  await expect(page.getByText('Preview ready')).toHaveCount(0);

  await page.locator('#video-file').setInputFiles(fixturePath);
  await page.getByRole('button', { name: 'Upload video' }).click();
  await expect(page.getByText('Preview ready')).toBeVisible({ timeout: 15_000 });
  await expect(page.getByText('ANALYSIS NOT STARTED')).toBeVisible();
});

test('rejects a file larger than the server-provided limit without uploading it', async ({ page }) => {
  await page.route('**/api/uploads/limits', route => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({ supportedFormats: ['.mp4', '.mov', '.webm'], maxUploadBytes: 64, maxUploadMegabytes: 0.000061, durationLimitSeconds: null, fieldName: 'video' }),
  }));
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Upload a video' })).toBeVisible();
  await expect(page.getByText('Maximum size')).toBeVisible();
  let uploadRequests = 0;
  page.on('request', request => {
    if (request.method() === 'POST' && request.url().endsWith('/api/videos')) uploadRequests += 1;
  });
  await page.getByLabel('Choose a video to upload').setInputFiles({ name: 'large.mp4', mimeType: 'video/mp4', buffer: Buffer.alloc(65) });
  await expect(page.getByText(/larger than the .* limit/)).toBeVisible();
  await expect(page.getByRole('button', { name: 'Upload video' })).toBeDisabled();
  expect(uploadRequests).toBe(0);
});
