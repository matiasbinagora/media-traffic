import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { expect, test } from '@playwright/test';

const sourcePath = path.join(process.cwd(), 'example/demo-traffic-video/source.mp4');
const qualifiedRunPath = path.join(process.cwd(), 'reports/per90/postmerge/run-result.json');

type QualifiedRun = {
  id: string;
  videoId: string;
  status: 'completed';
  analysisStarted: true;
  createdAt: string;
  updatedAt: string;
  configurationSnapshot: Record<string, unknown>;
  provenance: { source: { videoId: string; sha256: string; [key: string]: unknown }; [key: string]: unknown };
  result: {
    sampledFrameCount: number;
    tracks: Array<{ trackId: string; observations: Array<{ timeSeconds: number; normalizedBox: { x: number; y: number; width: number; height: number } }> }>;
    signalTimeline: { intervals: Array<{ state: string; startSeconds: number; endSeconds: number }> };
  };
};

function distanceTo(value: number, target: number) {
  return Math.abs(value - target);
}

async function drawGeometry(page: import('@playwright/test').Page, tool: string, start: { x: number; y: number }, end: { x: number; y: number }) {
  await page.getByRole('button', { name: tool }).click();
  const canvas = page.getByRole('application', { name: 'Scene geometry editor' });
  await canvas.scrollIntoViewIfNeeded();
  const bounds = await canvas.boundingBox();
  if (!bounds) throw new Error('Scene editor canvas is not visible.');
  await page.mouse.move(bounds.x + start.x * bounds.width, bounds.y + start.y * bounds.height);
  await page.mouse.down();
  await page.mouse.move(bounds.x + end.x * bounds.width, bounds.y + end.y * bounds.height, { steps: 4 });
  await page.mouse.up();
}

test('renders qualified inference tracks and signal evidence in synchronized video playback', async ({ page }) => {
  const [videoBytes, runText] = await Promise.all([readFile(sourcePath), readFile(qualifiedRunPath, 'utf8')]);
  const qualifiedRun = JSON.parse(runText) as QualifiedRun;
  const uploadedHash = createHash('sha256').update(videoBytes).digest('hex');
  expect(uploadedHash).toBe(qualifiedRun.provenance.source.sha256);
  expect(qualifiedRun.result.sampledFrameCount).toBe(300);
  expect(qualifiedRun.result.tracks.length).toBeGreaterThan(1);

  let uploadedVideoId = '';
  let savedConfiguration: Record<string, unknown> | undefined;
  const replayedRun = {
    ...qualifiedRun,
    provenance: {
      ...qualifiedRun.provenance,
      source: { ...qualifiedRun.provenance.source, videoId: '' },
    },
  };

  // Keep upload, preview conversion, and scene saving on the real local API.
  // Only the analysis response is replayed from the exact recorded YOLO + signal
  // inference run above because this test environment has no model checkpoint.
  await page.route('**/api/videos/*/analysis-runs**', async route => {
    const request = route.request();
    const videoId = new URL(request.url()).pathname.split('/')[3];
    uploadedVideoId = videoId;
    if (request.method() === 'POST') {
      if (!savedConfiguration) throw new Error('Expected a real saved configuration before starting analysis.');
      return route.fulfill({
        status: 202,
        contentType: 'application/json',
        body: JSON.stringify({
          schemaVersion: 2,
          id: qualifiedRun.id,
          videoId,
          status: 'queued',
          phase: 'queued',
          analysisStarted: true,
          configurationSnapshot: savedConfiguration,
          createdAt: qualifiedRun.createdAt,
          updatedAt: qualifiedRun.updatedAt,
          provenance: { ...qualifiedRun.provenance, source: { ...qualifiedRun.provenance.source, videoId } },
        }),
      });
    }
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        ...replayedRun,
        videoId,
        configurationSnapshot: savedConfiguration,
        provenance: { ...qualifiedRun.provenance, source: { ...qualifiedRun.provenance.source, videoId } },
      }),
    });
  });

  await page.goto('/');
  await page.getByLabel('Choose a video to upload').setInputFiles(sourcePath);
  await page.getByRole('button', { name: 'Upload video' }).click();
  await expect(page.getByRole('heading', { name: 'Mark the movement' })).toBeVisible({ timeout: 30_000 });

  const video = page.getByLabel('Video for scene configuration');
  await video.evaluate(element => {
    const media = element as HTMLVideoElement;
    if (media.readyState >= HTMLMediaElement.HAVE_METADATA) return;
    return new Promise<void>((resolve, reject) => {
      media.addEventListener('loadedmetadata', () => resolve(), { once: true });
      media.addEventListener('error', () => reject(new Error('Uploaded source preview failed to load.')), { once: true });
    });
  });

  await drawGeometry(page, 'Draw vehicle region', { x: 0.1, y: 0.2 }, { x: 0.9, y: 0.9 });
  await drawGeometry(page, 'Draw stop line', { x: 0.2, y: 0.6 }, { x: 0.8, y: 0.6 });
  await drawGeometry(page, 'Draw signal region', { x: 0.155, y: 0.04 }, { x: 0.21, y: 0.23 });
  await page.getByLabel('Crossing direction').selectOption('top-to-bottom');
  await page.getByLabel('Governing signal').selectOption('traffic-signal-1');
  const configurationResponse = page.waitForResponse(response => response.request().method() === 'POST' && response.url().endsWith('/configurations'));
  await page.getByRole('button', { name: 'Save scene configuration' }).click();
  savedConfiguration = await (await configurationResponse).json() as Record<string, unknown>;
  expect((savedConfiguration.source as { sha256: string }).sha256).toBe(uploadedHash);

  await page.getByRole('button', { name: 'Start traffic analysis' }).click();
  const overlay = page.getByTestId('traffic-analysis-overlay');
  await expect(overlay).toBeVisible({ timeout: 15_000 });
  await expect(page.getByRole('region', { name: 'Analysis run records' })).toContainText('300 sampled frames · 3 observed vehicle tracks');

  const slider = page.getByLabel('Signal timeline playback position');
  const sliderBounds = await slider.boundingBox();
  if (!sliderBounds) throw new Error('Signal timeline slider is not visible.');
  await page.mouse.click(sliderBounds.x + sliderBounds.width * 0.115, sliderBounds.y + sliderBounds.height / 2);
  await expect.poll(async () => video.evaluate(element => (element as HTMLVideoElement).currentTime), { timeout: 5000 }).toBeGreaterThan(1);
  await expect(overlay).toHaveAttribute('aria-label', /Traffic detections at 1\.\d\d seconds/);
  await expect(page.getByRole('status').filter({ hasText: 'Green · stable for three consecutive frames' })).toBeVisible();

  const targetTime = await video.evaluate(element => (element as HTMLVideoElement).currentTime);
  const trackWithObservation = qualifiedRun.result.tracks.find(track => track.trackId === '1');
  const expectedObservation = trackWithObservation?.observations.reduce((nearest, observation) => (
    distanceTo(observation.timeSeconds, targetTime) < distanceTo(nearest.timeSeconds, targetTime) ? observation : nearest
  ));
  expect(expectedObservation).toBeDefined();
  expect(distanceTo(expectedObservation!.timeSeconds, targetTime)).toBeLessThan(0.02);
  await expect(overlay.locator('g[data-track-id="1"][data-overlay-kind="observation"]')).toHaveCount(1);
  await expect(overlay.locator('g[data-track-id="2"][data-overlay-kind="observation"]')).toHaveCount(1);
  expect(await overlay.locator('line[data-track-id="1"][data-overlay-kind="trajectory"]').count()).toBeGreaterThan(0);

  const assertTrackOneAlignment = async () => {
    const box = await overlay.locator('g[data-track-id="1"][data-overlay-kind="observation"] rect').boundingBox();
    const canvas = await page.getByRole('application', { name: 'Scene geometry editor' }).boundingBox();
    if (!box || !canvas) throw new Error('Expected a rendered inference box and scene canvas.');
    const normalizedLeft = (box.x - canvas.x) / canvas.width;
    const normalizedWidth = box.width / canvas.width;
    expect(Math.abs(normalizedLeft - expectedObservation!.normalizedBox.x)).toBeLessThan(0.02);
    expect(Math.abs(normalizedWidth - expectedObservation!.normalizedBox.width)).toBeLessThan(0.02);
  };
  await assertTrackOneAlignment();

  await video.evaluate(element => {
    const media = element as HTMLVideoElement;
    media.muted = true;
    return media.play();
  });
  await expect.poll(async () => video.evaluate(element => (element as HTMLVideoElement).currentTime), { timeout: 5000 }).toBeGreaterThan(targetTime + 0.1);
  await video.evaluate(element => (element as HTMLVideoElement).pause());
  await expect.poll(async () => overlay.getAttribute('aria-label')).toContain('Traffic detections at');

  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.getByRole('application', { name: 'Scene geometry editor' })).toBeVisible();
  await assertTrackOneAlignment();
  await expect(page.getByRole('status').filter({ hasText: /Red|Yellow|Green|Unknown/ })).toBeVisible();
  expect(uploadedVideoId).toBeTruthy();
});
