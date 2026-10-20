import { expect, test, type Page } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';

const fixturePath = path.join(process.cwd(), 'e2e/fixtures/rights-cleared-blue.mp4');
type Bounds = { x: number; y: number; width: number; height: number };

async function openConfiguredUpload(page: Page) {
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
      source: { sizeBytes: 2134, sha256: 'a'.repeat(64), media: { durationSeconds: 0.6, width: 1920, height: 1080, formatName: 'mov,mp4', sourceStartTimeSeconds: 0 } },
      derivative: { url: '/api/videos/d78d4663-448b-45d1-b77b-b130756125ab/preview', sizeBytes: 2134, media: { durationSeconds: 0.6, width: 960, height: 540, formatName: 'mov,mp4', sourceStartTimeSeconds: 0 }, timestampMapping: { sourceSeconds: 'previewSeconds', previewSeconds: 'MP4 presentation time from zero', offsetSeconds: 0 }, coordinateMapping: { sourceWidth: 1920, sourceHeight: 1080, previewWidth: 960, previewHeight: 540, xSourcePixelsPerPreviewPixel: 2, ySourcePixelsPerPreviewPixel: 2, origin: 'top-left' } },
      createdAt: '2026-10-20T00:00:00.000Z',
      updatedAt: '2026-10-20T00:00:01.000Z',
    }),
  }));
  await page.route('**/api/videos/*/preview', route => route.fulfill({ path: fixturePath, contentType: 'video/mp4' }));
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

async function dragWithinMediaFrame(page: Page, start: { x: number; y: number }, end: { x: number; y: number }) {
  const canvas = page.getByRole('application', { name: 'Scene geometry editor' });
  const box = await canvas.boundingBox();
  if (!box) throw new Error('Scene geometry editor has no rendered bounds.');
  const scale = Math.min(box.width / 960, box.height / 540);
  const mediaWidth = 960 * scale;
  const mediaHeight = 540 * scale;
  const left = box.x + (box.width - mediaWidth) / 2;
  const top = box.y + (box.height - mediaHeight) / 2;
  await page.mouse.move(left + start.x * mediaWidth, top + start.y * mediaHeight);
  await page.mouse.down();
  await page.mouse.move(left + end.x * mediaWidth, top + end.y * mediaHeight);
  await page.mouse.up();
}

function expectRegionInContainedFrame(region: Bounds, canvas: Bounds, expected: { x: number; y: number; width: number; height: number }) {
  const mediaWidth = Math.min(canvas.width, canvas.height * (960 / 540));
  const mediaHeight = Math.min(canvas.height, canvas.width / (960 / 540));
  const mediaLeft = (canvas.width - mediaWidth) / 2;
  const mediaTop = (canvas.height - mediaHeight) / 2;
  expect(Math.abs(region.x - canvas.x - (mediaLeft + mediaWidth * expected.x))).toBeLessThan(2);
  expect(Math.abs(region.y - canvas.y - (mediaTop + mediaHeight * expected.y))).toBeLessThan(2);
  expect(Math.abs(region.width - mediaWidth * expected.width)).toBeLessThan(4);
  expect(Math.abs(region.height - mediaHeight * expected.height)).toBeLessThan(4);
}

function expectLineInContainedFrame(line: Bounds, canvas: Bounds) {
  const mediaWidth = Math.min(canvas.width, canvas.height * (960 / 540));
  const mediaHeight = Math.min(canvas.height, canvas.width / (960 / 540));
  const mediaLeft = (canvas.width - mediaWidth) / 2;
  const mediaTop = (canvas.height - mediaHeight) / 2;
  expect(Math.abs(line.x - canvas.x - (mediaLeft + mediaWidth * 0.2))).toBeLessThan(3);
  expect(Math.abs(line.y + line.height / 2 - canvas.y - (mediaTop + mediaHeight * 0.6))).toBeLessThan(3);
  expect(Math.abs(line.width - mediaWidth * 0.6)).toBeLessThan(5);
  expect(line.height).toBeLessThan(8);
}

test('keeps drawn normalized geometry aligned through letterboxing and player resizing', async ({ page }) => {
  await page.setViewportSize({ width: 1024, height: 900 });
  await openConfiguredUpload(page);
  const player = page.locator('.scene-player');
  await player.evaluate(element => { (element as HTMLElement).style.aspectRatio = '4 / 3'; });

  await page.getByRole('button', { name: 'Draw vehicle region' }).click();
  await dragWithinMediaFrame(page, { x: 0.2, y: 0.2 }, { x: 0.8, y: 0.8 });
  await page.getByRole('button', { name: 'Draw stop line' }).click();
  await dragWithinMediaFrame(page, { x: 0.2, y: 0.6 }, { x: 0.8, y: 0.6 });
  await page.getByRole('button', { name: 'Draw signal region' }).click();
  await dragWithinMediaFrame(page, { x: 0.75, y: 0.05 }, { x: 0.9, y: 0.2 });
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
  expectRegionInContainedFrame(beforeResize!, beforeCanvas!, { x: 0.2, y: 0.2, width: 0.6, height: 0.6 });
  expectLineInContainedFrame(stopLineBeforeResize!, beforeCanvas!);
  expectRegionInContainedFrame(signalBeforeResize!, beforeCanvas!, { x: 0.75, y: 0.05, width: 0.15, height: 0.15 });

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
  expectRegionInContainedFrame(afterResize!, afterCanvas!, { x: 0.2, y: 0.2, width: 0.6, height: 0.6 });
  expectLineInContainedFrame(stopLineAfterResize!, afterCanvas!);
  expectRegionInContainedFrame(signalAfterResize!, afterCanvas!, { x: 0.75, y: 0.05, width: 0.15, height: 0.15 });
  await expect(page.getByRole('button', { name: 'Save scene configuration' })).toBeDisabled();
  await expect(page.getByRole('button', { name: 'Start analysis' })).toBeDisabled();
  await expect(page.locator('.scene-service-note').first()).toContainText('Scene saving is unavailable');
  const evidencePath = path.join(process.cwd(), 'reports/per88/scene-configuration-mobile.png');
  await mkdir(path.dirname(evidencePath), { recursive: true });
  await page.screenshot({ path: evidencePath, fullPage: true });
});
