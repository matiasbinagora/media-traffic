import { expect, test, type Page } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';

const fixturePath = path.join(process.cwd(), 'e2e/fixtures/rights-cleared-blue.mp4');
type Bounds = { x: number; y: number; width: number; height: number };

async function openConfiguredUpload(page: Page) {
  await page.goto('/');
  await page.getByLabel('Choose a video to upload').setInputFiles(fixturePath);
  await page.getByRole('button', { name: 'Upload video' }).click();
  await expect(page.getByRole('heading', { name: 'Mark the movement' })).toBeVisible();
  await page.getByLabel('Video for scene configuration').evaluate(element => {
    const video = element as HTMLVideoElement;
    if (video.readyState >= HTMLMediaElement.HAVE_METADATA) return;
    return new Promise<void>((resolve, reject) => {
      video.addEventListener('loadedmetadata', () => resolve(), { once: true });
      video.addEventListener('error', () => reject(new Error('The configured preview fixture did not load metadata.')), { once: true });
    });
  });
}

async function openScaledPreview(page: Page) {
  await page.route('**/api/uploads/limits', route => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({ supportedFormats: ['.mp4', '.mov', '.webm'], maxUploadBytes: 3 * 1024 * 1024, maxUploadMegabytes: 3, durationLimitSeconds: null, fieldName: 'video' }),
  }));
  await page.route('**/api/videos', route => route.fulfill({
    status: 201,
    contentType: 'application/json',
    body: JSON.stringify({
      schemaVersion: 1,
      id: 'd78d4663-448b-45d1-b77b-b130756125ab',
      originalName: 'rights-cleared-blue.mp4',
      status: 'completed',
      upload: { status: 'completed', sizeBytes: 2134, sha256: 'a'.repeat(64) },
      preview: { status: 'completed', contentType: 'video/mp4', url: '/api/videos/d78d4663-448b-45d1-b77b-b130756125ab/preview' },
      source: { sizeBytes: 2134, sha256: 'a'.repeat(64), media: { durationSeconds: 0.6, width: 640, height: 480 } },
      derivative: { url: '/api/videos/d78d4663-448b-45d1-b77b-b130756125ab/preview', media: { durationSeconds: 0.6, width: 320, height: 240 }, coordinateMapping: { sourceWidth: 640, sourceHeight: 480, previewWidth: 320, previewHeight: 240, xSourcePixelsPerPreviewPixel: 2, ySourcePixelsPerPreviewPixel: 2, origin: 'top-left' } },
      createdAt: '2026-10-20T00:00:00.000Z',
      updatedAt: '2026-10-20T00:00:01.000Z',
    }),
  }));
  await page.route('**/api/videos/*/preview', route => route.fulfill({ path: fixturePath, contentType: 'video/mp4' }));
  await page.route('**/api/videos/*/configurations', async route => {
    await route.fulfill({ status: 201, contentType: 'application/json', body: JSON.stringify(route.request().postDataJSON()) });
  });
  await page.goto('/');
  await page.getByLabel('Choose a video to upload').setInputFiles(fixturePath);
  await page.getByRole('button', { name: 'Upload video' }).click();
  await expect(page.getByRole('heading', { name: 'Mark the movement' })).toBeVisible();
  await page.getByLabel('Video for scene configuration').evaluate(element => {
    const video = element as HTMLVideoElement;
    if (video.readyState >= HTMLMediaElement.HAVE_METADATA) return;
    return new Promise<void>((resolve, reject) => {
      video.addEventListener('loadedmetadata', () => resolve(), { once: true });
      video.addEventListener('error', () => reject(new Error('The scaled-preview fixture did not load metadata.')), { once: true });
    });
  });
}

async function dragWithinMediaFrame(page: Page, start: { x: number; y: number }, end: { x: number; y: number }, mediaAspect: number) {
  const canvas = page.getByRole('application', { name: 'Scene geometry editor' });
  const box = await canvas.boundingBox();
  if (!box) throw new Error('Scene geometry editor has no rendered bounds.');
  const scale = Math.min(box.width / mediaAspect, box.height);
  const mediaWidth = mediaAspect * scale;
  const mediaHeight = scale;
  const left = box.x + (box.width - mediaWidth) / 2;
  const top = box.y + (box.height - mediaHeight) / 2;
  await page.mouse.move(left + start.x * mediaWidth, top + start.y * mediaHeight);
  await page.mouse.down();
  await page.mouse.move(left + end.x * mediaWidth, top + end.y * mediaHeight);
  await page.mouse.up();
}

function expectRegionInContainedFrame(region: Bounds, canvas: Bounds, expected: { x: number; y: number; width: number; height: number }, mediaAspect: number) {
  const mediaWidth = Math.min(canvas.width, canvas.height * mediaAspect);
  const mediaHeight = Math.min(canvas.height, canvas.width / mediaAspect);
  const mediaLeft = (canvas.width - mediaWidth) / 2;
  const mediaTop = (canvas.height - mediaHeight) / 2;
  expect(Math.abs(region.x - canvas.x - (mediaLeft + mediaWidth * expected.x))).toBeLessThan(2);
  expect(Math.abs(region.y - canvas.y - (mediaTop + mediaHeight * expected.y))).toBeLessThan(2);
  expect(Math.abs(region.width - mediaWidth * expected.width)).toBeLessThan(4);
  expect(Math.abs(region.height - mediaHeight * expected.height)).toBeLessThan(4);
}

function expectLineInContainedFrame(line: Bounds, canvas: Bounds, mediaAspect: number) {
  const mediaWidth = Math.min(canvas.width, canvas.height * mediaAspect);
  const mediaHeight = Math.min(canvas.height, canvas.width / mediaAspect);
  const mediaLeft = (canvas.width - mediaWidth) / 2;
  const mediaTop = (canvas.height - mediaHeight) / 2;
  expect(Math.abs(line.x - canvas.x - (mediaLeft + mediaWidth * 0.2))).toBeLessThan(3);
  expect(Math.abs(line.y + line.height / 2 - canvas.y - (mediaTop + mediaHeight * 0.6))).toBeLessThan(3);
  expect(Math.abs(line.width - mediaWidth * 0.6)).toBeLessThan(5);
  expect(line.height).toBeLessThan(8);
}

async function waitForRunStatus(page: Page, videoId: string, runId: string, status: 'completed' | 'failed') {
  await expect.poll(async () => {
    const response = await page.request.get(`/api/videos/${videoId}/analysis-runs/${runId}`);
    if (!response.ok()) return 'unavailable';
    return (await response.json()).status;
  }, { timeout: 10_000 }).toBe(status);
  const response = await page.request.get(`/api/videos/${videoId}/analysis-runs/${runId}`);
  return await response.json();
}

test('persists scene configuration and immutable run records through real API routes', async ({ page }) => {
  await page.setViewportSize({ width: 1024, height: 900 });
  await openConfiguredUpload(page);
  const video = page.getByLabel('Video for scene configuration');
  const mediaAspect = await video.evaluate(element => {
    const player = element as HTMLVideoElement;
    return player.videoWidth / player.videoHeight;
  });
  const player = page.locator('.scene-player');
  await player.evaluate(element => { (element as HTMLElement).style.aspectRatio = '16 / 9'; });

  await page.getByRole('button', { name: 'Draw vehicle region' }).click();
  await dragWithinMediaFrame(page, { x: 0.2, y: 0.2 }, { x: 0.8, y: 0.8 }, mediaAspect);
  await page.getByRole('button', { name: 'Draw stop line' }).click();
  await dragWithinMediaFrame(page, { x: 0.2, y: 0.6 }, { x: 0.8, y: 0.6 }, mediaAspect);
  await page.getByRole('button', { name: 'Draw signal region' }).click();
  await dragWithinMediaFrame(page, { x: 0.75, y: 0.05 }, { x: 0.9, y: 0.2 }, mediaAspect);
  await page.getByLabel('Crossing direction').selectOption('top-to-bottom');
  await page.getByLabel('Governing signal').selectOption('traffic-signal-1');
  await expect(page.getByRole('alert')).toHaveCount(0);

  const vehicleRegion = page.locator('[data-geometry="vehicle-region"]');
  const stopLine = page.locator('[data-geometry="stop-line"]');
  const signalRegion = page.locator('[data-geometry="signal-region"]');
  const beforeResize = await vehicleRegion.boundingBox();
  const stopLineBeforeResize = await stopLine.boundingBox();
  const signalBeforeResize = await signalRegion.boundingBox();
  const beforeCanvas = await page.getByRole('application', { name: 'Scene geometry editor' }).boundingBox();
  expect(beforeResize).not.toBeNull();
  expect(stopLineBeforeResize).not.toBeNull();
  expect(signalBeforeResize).not.toBeNull();
  expect(beforeCanvas).not.toBeNull();
  expectRegionInContainedFrame(beforeResize!, beforeCanvas!, { x: 0.2, y: 0.2, width: 0.6, height: 0.6 }, mediaAspect);
  expectLineInContainedFrame(stopLineBeforeResize!, beforeCanvas!, mediaAspect);
  expectRegionInContainedFrame(signalBeforeResize!, beforeCanvas!, { x: 0.75, y: 0.05, width: 0.15, height: 0.15 }, mediaAspect);

  await page.setViewportSize({ width: 640, height: 900 });
  await expect.poll(async () => (await page.getByRole('application', { name: 'Scene geometry editor' }).boundingBox())?.width).toBeLessThan(beforeCanvas!.width);
  const afterResize = await vehicleRegion.boundingBox();
  const stopLineAfterResize = await stopLine.boundingBox();
  const signalAfterResize = await signalRegion.boundingBox();
  const afterCanvas = await page.getByRole('application', { name: 'Scene geometry editor' }).boundingBox();
  expect(afterResize).not.toBeNull();
  expect(stopLineAfterResize).not.toBeNull();
  expect(signalAfterResize).not.toBeNull();
  expect(afterCanvas).not.toBeNull();
  expectRegionInContainedFrame(afterResize!, afterCanvas!, { x: 0.2, y: 0.2, width: 0.6, height: 0.6 }, mediaAspect);
  expectLineInContainedFrame(stopLineAfterResize!, afterCanvas!, mediaAspect);
  expectRegionInContainedFrame(signalAfterResize!, afterCanvas!, { x: 0.75, y: 0.05, width: 0.15, height: 0.15 }, mediaAspect);
  const saveResponsePromise = page.waitForResponse(response => response.url().includes('/configurations') && response.request().method() === 'POST');
  await page.getByRole('button', { name: 'Save scene configuration' }).click();
  const firstSaveResponse = await saveResponsePromise;
  expect(firstSaveResponse.status()).toBe(201);
  const firstConfiguration = await firstSaveResponse.json();
  await expect(page.getByRole('status').filter({ hasText: 'Configuration snapshot' })).toContainText(firstConfiguration.id);

  const invalidResponse = await page.request.post(`/api/videos/${firstConfiguration.source.videoId}/configurations`, {
    data: { ...firstConfiguration, id: crypto.randomUUID(), geometry: { ...firstConfiguration.geometry, vehicleRegion: { x: 0.9, y: 0.9, width: 0.5, height: 0.5 } } },
  });
  expect(invalidResponse.status()).toBe(422);
  expect((await invalidResponse.json()).error.details.invalidFields).toContain('vehicleRegion');
  const duplicateResponse = await page.request.post(`/api/videos/${firstConfiguration.source.videoId}/configurations`, { data: firstConfiguration });
  expect(duplicateResponse.status()).toBe(409);

  const createFirstRunResponsePromise = page.waitForResponse(response => response.url().endsWith('/analysis-runs') && response.request().method() === 'POST');
  await page.getByRole('button', { name: 'Start traffic analysis' }).click();
  const firstRunResponse = await createFirstRunResponsePromise;
  expect(firstRunResponse.status()).toBe(202);
  const firstRun = await firstRunResponse.json();
  expect(firstRun).toMatchObject({ status: 'queued', analysisStarted: true, configurationSnapshot: firstConfiguration });
  const firstTerminalRun = await waitForRunStatus(page, firstRun.videoId, firstRun.id, 'failed');
  expect(firstTerminalRun).not.toHaveProperty('result');
  const firstRunCard = page.getByRole('region', { name: 'Analysis run records' }).getByRole('listitem').first();
  await expect(firstRunCard).toContainText(firstConfiguration.id);
  await expect(firstRunCard).toContainText('Failed · Stage: Analysis failed');
  await expect(firstRunCard.getByRole('alert')).toContainText('Set YOLO_MODEL_PATH');
  await firstRunCard.getByText('Inspect run evidence and provenance').click();
  await expect(firstRunCard).toContainText('Source is not identified as the synthetic demo.');
  await expect(firstRunCard).toContainText('YOLO26');
  await expect(firstRunCard).toContainText('ByteTrack');
  await expect(firstRunCard).not.toContainText('.local-data/');
  const provenanceEvidencePath = path.join(process.cwd(), 'reports/per107/analysis-run-failure-and-provenance.png');
  await mkdir(path.dirname(provenanceEvidencePath), { recursive: true });
  await firstRunCard.screenshot({ path: provenanceEvidencePath });

  await page.getByLabel('Crossing direction').selectOption('bottom-to-top');
  const secondSavePromise = page.waitForResponse(response => response.url().includes('/configurations') && response.request().method() === 'POST');
  await page.getByRole('button', { name: 'Save scene configuration' }).click();
  const secondSaveResponse = await secondSavePromise;
  expect(secondSaveResponse.status()).toBe(201);
  const secondConfiguration = await secondSaveResponse.json();
  expect(secondConfiguration.id).not.toBe(firstConfiguration.id);
  const createSecondRunResponsePromise = page.waitForResponse(response => response.url().endsWith('/analysis-runs') && response.request().method() === 'POST');
  await page.getByRole('button', { name: 'Start traffic analysis' }).click();
  const secondRunResponse = await createSecondRunResponsePromise;
  expect(secondRunResponse.status()).toBe(202);
  const secondRun = await secondRunResponse.json();
  expect(secondRun.configurationSnapshot.id).toBe(secondConfiguration.id);
  const secondTerminalRun = await waitForRunStatus(page, secondRun.videoId, secondRun.id, 'failed');
  expect(secondTerminalRun).not.toHaveProperty('result');
  await expect(page.getByRole('region', { name: 'Analysis run records' }).getByRole('listitem')).toHaveCount(2);
  await expect(page.getByRole('region', { name: 'Analysis run records' })).toContainText(firstConfiguration.id);
  await expect(page.getByRole('region', { name: 'Analysis run records' })).toContainText(secondConfiguration.id);
  await expect(page.getByRole('region', { name: 'Analysis run records' })).toContainText('Set YOLO_MODEL_PATH');

  await page.reload();
  await expect(page.getByRole('heading', { name: 'Mark the movement' })).toBeVisible();
  const restoredRuns = page.getByRole('region', { name: 'Analysis run records' });
  await expect(restoredRuns.getByRole('listitem')).toHaveCount(2);
  await expect(restoredRuns).toContainText(firstConfiguration.id);
  await expect(restoredRuns).toContainText(secondConfiguration.id);
  const restoredItems = restoredRuns.getByRole('listitem');
  await restoredItems.nth(1).getByText('Inspect run evidence and provenance').click();
  await expect(restoredItems.nth(1)).toContainText('top-to-bottom');
  await restoredItems.nth(0).getByText('Inspect run evidence and provenance').click();
  await expect(restoredItems.nth(0)).toContainText('bottom-to-top');
  const firstRunReadBack = await page.request.get(`/api/videos/${firstRun.videoId}/analysis-runs/${firstRun.id}`);
  expect(firstRunReadBack.status()).toBe(200);
  const firstRunReadBackBody = await firstRunReadBack.json();
  expect(firstRunReadBackBody.status).toBe('failed');
  expect(firstRunReadBackBody.configurationSnapshot).toEqual(firstConfiguration);
  const secondRunReadBack = await page.request.get(`/api/videos/${secondRun.videoId}/analysis-runs/${secondRun.id}`);
  expect(secondRunReadBack.status()).toBe(200);
  const secondRunReadBackBody = await secondRunReadBack.json();
  expect(secondRunReadBackBody.status).toBe('failed');
  expect(secondRunReadBackBody.configurationSnapshot).toEqual(secondConfiguration);

  const reportDirectory = process.env.PLAYWRIGHT_REPORT_DIR || 'reports/per88';
  const evidencePath = path.join(process.cwd(), reportDirectory, 'revalidation-mobile.png');
  await mkdir(path.dirname(evidencePath), { recursive: true });
  await page.screenshot({ path: evidencePath, fullPage: true });
});

test('keeps normalized geometry aligned when the playback derivative is half-size', async ({ page }) => {
  await page.setViewportSize({ width: 1024, height: 900 });
  await openScaledPreview(page);
  const mediaAspect = 320 / 240;
  await page.locator('.scene-player').evaluate(element => { (element as HTMLElement).style.aspectRatio = '16 / 9'; });
  await page.getByRole('button', { name: 'Draw vehicle region' }).click();
  await dragWithinMediaFrame(page, { x: 0.2, y: 0.2 }, { x: 0.8, y: 0.8 }, mediaAspect);
  await page.getByRole('button', { name: 'Draw stop line' }).click();
  await dragWithinMediaFrame(page, { x: 0.2, y: 0.6 }, { x: 0.8, y: 0.6 }, mediaAspect);
  await page.getByRole('button', { name: 'Draw signal region' }).click();
  await dragWithinMediaFrame(page, { x: 0.75, y: 0.05 }, { x: 0.9, y: 0.2 }, mediaAspect);
  await page.getByLabel('Crossing direction').selectOption('top-to-bottom');
  await page.getByLabel('Governing signal').selectOption('traffic-signal-1');
  const savePromise = page.waitForResponse(response => response.url().includes('/configurations') && response.request().method() === 'POST');
  await page.getByRole('button', { name: 'Save scene configuration' }).click();
  const saved = await (await savePromise).json();
  expect(saved.source).toMatchObject({ width: 640, height: 480 });
  expect(saved.geometry.vehicleRegion.x).toBeCloseTo(0.2);
  expect(saved.geometry.vehicleRegion.y).toBeCloseTo(0.2);
  expect(saved.geometry.vehicleRegion.width).toBeCloseTo(0.6);
  expect(saved.geometry.vehicleRegion.height).toBeCloseTo(0.6);
  expect(saved.geometry.stopLine.start.x).toBeCloseTo(0.2);
  expect(saved.geometry.stopLine.start.y).toBeCloseTo(0.6);
  expect(saved.geometry.stopLine.end.x).toBeCloseTo(0.8);
  expect(saved.geometry.stopLine.end.y).toBeCloseTo(0.6);
  expect(saved.geometry.signalRegion.x).toBeCloseTo(0.75);
  expect(saved.geometry.signalRegion.y).toBeCloseTo(0.05);
  expect(saved.geometry.signalRegion.width).toBeCloseTo(0.15);
  expect(saved.geometry.signalRegion.height).toBeCloseTo(0.15);
});
