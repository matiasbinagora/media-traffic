import { expect, test, type Page } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';

const fixturePath = path.join(process.cwd(), 'e2e/fixtures/rights-cleared-blue.mp4');
const videoId = 'd78d4663-448b-45d1-b77b-b130756125ab';
const runId = '7bc376cb-cc0c-4d2e-a59d-02bf48db4f39';

function mediaPoint(bounds: { x: number; y: number; width: number; height: number }, point: { x: number; y: number }) {
  const mediaAspect = 640 / 480;
  const mediaWidth = Math.min(bounds.width, bounds.height * mediaAspect);
  const mediaHeight = Math.min(bounds.height, bounds.width / mediaAspect);
  const mediaLeft = bounds.x + (bounds.width - mediaWidth) / 2;
  const mediaTop = bounds.y + (bounds.height - mediaHeight) / 2;
  return { x: mediaLeft + point.x * mediaWidth, y: mediaTop + point.y * mediaHeight };
}

async function setRegion(page: Page, mode: 'Draw signal region', start: { x: number; y: number }, end: { x: number; y: number }) {
  const canvas = page.getByRole('application', { name: 'Scene geometry editor' });
  const bounds = await canvas.boundingBox();
  if (!bounds) throw new Error('Scene editor has no rendered bounds.');
  const startPoint = mediaPoint(bounds, start);
  const endPoint = mediaPoint(bounds, end);
  await page.getByRole('button', { name: mode }).click();
  await page.mouse.move(startPoint.x, startPoint.y);
  await page.mouse.down();
  await page.mouse.move(endPoint.x, endPoint.y);
  await page.mouse.up();
}

test('shows inferred signal state and keeps its timeline synchronized with playback and seeking', async ({ page }) => {
  await page.route('**/api/uploads/limits', route => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({ supportedFormats: ['.mp4'], maxUploadBytes: 3 * 1024 * 1024, maxUploadMegabytes: 3, durationLimitSeconds: null, fieldName: 'video' }),
  }));
  await page.route('**/api/videos', route => route.fulfill({
    status: 201,
    contentType: 'application/json',
    body: JSON.stringify({
      schemaVersion: 1,
      id: videoId,
      originalName: 'rights-cleared-blue.mp4',
      status: 'completed',
      upload: { status: 'completed', sizeBytes: 2134, sha256: 'a'.repeat(64) },
      preview: { status: 'completed', contentType: 'video/mp4', url: `/api/videos/${videoId}/preview` },
      source: { sizeBytes: 2134, sha256: 'a'.repeat(64), media: { durationSeconds: 0.6, width: 640, height: 480 } },
      derivative: { url: `/api/videos/${videoId}/preview`, media: { durationSeconds: 0.6, width: 640, height: 480 }, timestampMapping: { sourceSeconds: 'previewSeconds + offsetSeconds', previewSeconds: 'MP4 presentation time from zero', offsetSeconds: 0 } },
      createdAt: '2026-10-28T00:00:00.000Z',
      updatedAt: '2026-10-28T00:00:01.000Z',
    }),
  }));
  await page.route(`**/api/videos/${videoId}/preview`, route => route.fulfill({ path: fixturePath, contentType: 'video/mp4' }));
  await page.route(`**/api/videos/${videoId}/configurations`, async route => {
    await route.fulfill({ status: 201, contentType: 'application/json', body: JSON.stringify(route.request().postDataJSON()) });
  });

  let savedConfiguration: Record<string, any> | undefined;
  await page.route(`**/api/videos/${videoId}/analysis-runs`, async route => {
    const configuration = route.request().postDataJSON();
    const snapshot = savedConfiguration || { id: configuration.configurationId, source: { videoId }, geometry: {}, createdAt: '2026-10-28T00:00:00.000Z', schemaVersion: 1 };
    await route.fulfill({ status: 202, contentType: 'application/json', body: JSON.stringify({
      schemaVersion: 2, id: runId, videoId, status: 'queued', analysisStarted: true, configurationSnapshot: snapshot,
      createdAt: '2026-10-28T00:00:00.000Z', updatedAt: '2026-10-28T00:00:00.000Z',
      provenance: {
        source: { videoId, sha256: 'a'.repeat(64), path: 'uploaded-original', durationSeconds: 0.6, width: 640, height: 480 },
        detector: { family: 'YOLO26', weights: 'test.pt', runtime: 'Ultralytics', device: 'cpu' },
        tracker: { name: 'ByteTrack', configFile: 'server/inference/bytetrack.yaml' },
        sampling: { strategy: 'every-decoded-frame', framesPerSample: 1, timestampSource: 'ffprobe.best_effort_timestamp_time' },
        thresholds: { confidence: 0.25, imageSize: 640, classFilter: { id: 2, name: 'car' } },
      },
    }) });
  });
  await page.route(`**/api/videos/${videoId}/analysis-runs/${runId}`, route => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({
      schemaVersion: 2, id: runId, videoId, status: 'completed', analysisStarted: true,
      configurationSnapshot: savedConfiguration,
      createdAt: '2026-10-28T00:00:00.000Z', updatedAt: '2026-10-28T00:00:01.000Z',
      provenance: {
        source: { videoId, sha256: 'a'.repeat(64), path: 'uploaded-original', durationSeconds: 0.6, width: 640, height: 480 },
        detector: { family: 'YOLO26', weights: 'test.pt', runtime: 'Ultralytics', device: 'cpu' },
        tracker: { name: 'ByteTrack', configFile: 'server/inference/bytetrack.yaml' },
        sampling: { strategy: 'every-decoded-frame', framesPerSample: 1, timestampSource: 'ffprobe.best_effort_timestamp_time' },
        thresholds: { confidence: 0.25, imageSize: 640, classFilter: { id: 2, name: 'car' } },
      },
      result: { frameWidth: 640, frameHeight: 480, sampledFrameCount: 7, tracks: [], possibleIdentitySwitches: [], signalTimeline: {
        stabilityRule: { method: 'consecutive-decoded-frames', requiredFrames: 3 }, observations: [], intervals: [
          { state: 'red', startFrameIndex: 0, endFrameExclusive: 3, startSeconds: 0, endSeconds: 0.3, rationale: 'stable_for_three_consecutive_frames', transitionEvidence: { supportingFrameIndices: [0, 1, 2] } },
          { state: 'unknown', startFrameIndex: 3, endFrameExclusive: 4, startSeconds: 0.3, endSeconds: 0.4, rationale: 'ambiguous_signal' },
          { state: 'green', startFrameIndex: 4, endFrameExclusive: 7, startSeconds: 0.4, endSeconds: 0.6, rationale: 'stable_for_three_consecutive_frames', transitionEvidence: { supportingFrameIndices: [4, 5, 6] } },
        ],
      } },
    }),
  }));

  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto('/');
  await page.getByLabel('Choose a video to upload').setInputFiles(fixturePath);
  await page.getByRole('button', { name: 'Upload video' }).click();
  await expect(page.getByRole('heading', { name: 'Mark the movement' })).toBeVisible();
  await page.getByLabel('Video for scene configuration').evaluate(element => {
    const video = element as HTMLVideoElement;
    if (video.readyState >= HTMLMediaElement.HAVE_METADATA) return;
    return new Promise<void>((resolve, reject) => {
      video.addEventListener('loadedmetadata', () => resolve(), { once: true });
      video.addEventListener('error', () => reject(new Error('The signal timeline fixture did not load metadata.')), { once: true });
    });
  });
  await page.getByRole('button', { name: 'Draw vehicle region' }).click();
  const editor = page.getByRole('application', { name: 'Scene geometry editor' });
  await editor.focus();
  await editor.press('Enter');
  await editor.press('ArrowRight');
  await editor.press('ArrowRight');
  await editor.press('ArrowDown');
  await editor.press('ArrowDown');
  await editor.press('Enter');
  await page.getByRole('button', { name: 'Draw stop line' }).click();
  const canvas = await page.getByRole('application', { name: 'Scene geometry editor' }).boundingBox();
  if (!canvas) throw new Error('Scene editor has no rendered bounds.');
  const lineStart = mediaPoint(canvas, { x: 0.2, y: 0.6 });
  const lineEnd = mediaPoint(canvas, { x: 0.8, y: 0.6 });
  await page.mouse.move(lineStart.x, lineStart.y);
  await page.mouse.down();
  await page.mouse.move(lineEnd.x, lineEnd.y);
  await page.mouse.up();
  await setRegion(page, 'Draw signal region', { x: 0.75, y: 0.05 }, { x: 0.9, y: 0.2 });
  await page.getByLabel('Crossing direction').selectOption('top-to-bottom');
  await page.getByLabel('Governing signal').selectOption('traffic-signal-1');
  const savePromise = page.waitForResponse(response => response.url().includes('/configurations') && response.request().method() === 'POST');
  await page.getByRole('button', { name: 'Save scene configuration' }).click();
  savedConfiguration = await (await savePromise).json();
  await page.getByRole('button', { name: 'Start traffic analysis' }).click();
  const timeline = page.getByRole('region', { name: 'Inferred traffic signal timeline' });
  await expect(timeline).toBeVisible();
  await expect(timeline.getByRole('status')).toContainText('Red · stable for three consecutive frames');
  const slider = timeline.getByRole('slider', { name: 'Signal timeline playback position' });
  await page.getByLabel('Video for scene configuration').evaluate(element => {
    const video = element as HTMLVideoElement;
    Object.defineProperty(video, 'currentTime', { configurable: true, value: 0.3 });
    video.dispatchEvent(new Event('timeupdate', { bubbles: true }));
  });
  await expect(slider).toHaveValue('0.3');
  await expect(timeline.getByRole('status')).toContainText('Unknown · ambiguous signal');

  const evidenceDirectory = path.join(process.cwd(), 'reports/per104');
  await mkdir(evidenceDirectory, { recursive: true });
  await page.screenshot({ path: path.join(evidenceDirectory, 'signal-timeline-desktop.png'), fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(timeline).toBeVisible();
  await expect(page.locator('body')).toHaveJSProperty('scrollWidth', 390);
  await page.screenshot({ path: path.join(evidenceDirectory, 'signal-timeline-mobile.png'), fullPage: true });
});
