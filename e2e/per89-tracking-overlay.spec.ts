import { expect, test, type Page } from '@playwright/test';
import path from 'node:path';

const fixturePath = path.join(process.cwd(), 'e2e/fixtures/rights-cleared-blue.mp4');
const videoId = 'd78d4663-448b-45d1-b77b-b130756125ab';
const runId = 'd78d4663-448b-45d1-b77b-b130756125ac';

const provenance = {
  source: { videoId, sha256: 'a'.repeat(64), path: 'uploaded-original', durationSeconds: 0.6, width: 320, height: 240 },
  detector: { family: 'YOLO26', weights: 'synthetic-test-only', sha256: 'b'.repeat(64), runtime: 'Ultralytics', device: 'cpu' },
  tracker: { name: 'ByteTrack', configFile: 'server/inference/bytetrack.yaml', configSha256: 'c'.repeat(64), config: { syntheticFixture: true } },
  sampling: { strategy: 'every-decoded-frame', framesPerSample: 1, timestampSource: 'ffprobe.best_effort_timestamp_time', decodedFrameCount: 4 },
  thresholds: { confidence: 0.25, imageSize: 640, classFilter: { id: 2, name: 'car' } },
};

function response(body: unknown, status = 200) {
  return { status, contentType: 'application/json', body: JSON.stringify(body) };
}

function completedRun(configurationSnapshot: any) {
  return {
    schemaVersion: 2,
    id: runId,
    videoId,
    status: 'completed',
    analysisStarted: true,
    configurationSnapshot,
    createdAt: '2026-10-27T12:00:00.000Z',
    updatedAt: '2026-10-27T12:00:01.000Z',
    provenance,
    result: {
      frameWidth: 320,
      frameHeight: 240,
      sampledFrameCount: 5,
      tracks: [
        {
          trackId: 'car-7', firstSeenSeconds: 0, lastSeenSeconds: 0.3,
          observations: [
            { frameIndex: 0, timeSeconds: 0, frameWidth: 320, frameHeight: 240, box: { x: 32, y: 48, width: 64, height: 48 }, normalizedBox: { x: 0.1, y: 0.2, width: 0.2, height: 0.2 }, confidence: 0.91, state: 'observed' },
            { frameIndex: 3, timeSeconds: 0.3, frameWidth: 320, frameHeight: 240, box: { x: 64, y: 48, width: 64, height: 48 }, normalizedBox: { x: 0.2, y: 0.2, width: 0.2, height: 0.2 }, confidence: 0.87, state: 'observed' },
          ],
          gaps: [{ afterFrameIndex: 0, beforeFrameIndex: 3, missingFrameCount: 2, startSeconds: 0.1, endSeconds: 0.3, reason: 'not_observed', identityContinuity: 'unverified' }],
        },
        {
          trackId: 'car-8', firstSeenSeconds: 0, lastSeenSeconds: 0,
          observations: [
            { frameIndex: 0, timeSeconds: 0, frameWidth: 320, frameHeight: 240, box: { x: 192, y: 48, width: 64, height: 48 }, normalizedBox: { x: 0.6, y: 0.2, width: 0.2, height: 0.2 }, confidence: 0.84, state: 'observed' },
          ],
          gaps: [],
        },
        {
          trackId: 'car-9', firstSeenSeconds: 0.4, lastSeenSeconds: 0.4,
          observations: [
            { frameIndex: 4, timeSeconds: 0.4, frameWidth: 320, frameHeight: 240, box: { x: 68, y: 48, width: 64, height: 48 }, normalizedBox: { x: 0.2125, y: 0.2, width: 0.2, height: 0.2 }, confidence: 0.82, state: 'observed' },
          ],
          gaps: [],
        },
      ],
      possibleIdentitySwitches: [{ fromTrackId: 'car-7', toTrackId: 'car-9', fromFrameIndex: 3, toFrameIndex: 4, fromTimeSeconds: 0.3, toTimeSeconds: 0.4, spatialEvidence: 'overlap', identityContinuity: 'unverified' }],
    },
  };
}

async function drawWithKeyboard(page: Page, toolName: string, moves: Array<'Shift+ArrowLeft' | 'Shift+ArrowRight' | 'Shift+ArrowUp' | 'Shift+ArrowDown'>) {
  await page.getByRole('button', { name: toolName }).click();
  const canvas = page.getByRole('application', { name: 'Scene geometry editor' });
  await canvas.focus();
  await page.keyboard.press('Enter');
  for (const move of moves) await page.keyboard.press(move);
  await page.keyboard.press('Enter');
}

async function openValidConfiguration(page: Page, failedRun = false) {
  await page.route('**/api/uploads/limits', route => route.fulfill(response({ supportedFormats: ['.mp4'], maxUploadBytes: 3_000_000, maxUploadMegabytes: 3, durationLimitSeconds: null, fieldName: 'video' })));
  await page.route('**/api/videos', route => route.fulfill(response({
    schemaVersion: 1,
    id: videoId,
    originalName: 'rights-cleared-blue.mp4',
    status: 'completed',
    upload: { status: 'completed', sizeBytes: 2134, sha256: 'a'.repeat(64) },
    preview: { status: 'completed', contentType: 'video/mp4', url: `/api/videos/${videoId}/preview` },
    source: { sizeBytes: 2134, sha256: 'a'.repeat(64), media: { durationSeconds: 0.6, width: 320, height: 240 } },
    derivative: { url: `/api/videos/${videoId}/preview`, media: { durationSeconds: 0.6, width: 320, height: 240 }, timestampMapping: { sourceSeconds: 'best_effort_timestamp_time', previewSeconds: 'best_effort_timestamp_time', offsetSeconds: 0 } },
    createdAt: '2026-10-27T12:00:00.000Z',
    updatedAt: '2026-10-27T12:00:01.000Z',
  }, 201)));
  await page.route(`**/api/videos/${videoId}/preview`, route => route.fulfill({ path: fixturePath, contentType: 'video/mp4' }));
  await page.route(`**/api/videos/${videoId}/configurations`, route => route.fulfill(response(route.request().postDataJSON(), 201)));
  await page.route(`**/api/videos/${videoId}/analysis-runs**`, async route => {
    if (route.request().method() === 'POST') {
      const { configurationId } = route.request().postDataJSON();
      const configurationSnapshot = { schemaVersion: 1, id: configurationId, source: { videoId, sha256: 'a'.repeat(64), width: 320, height: 240 }, geometry: { vehicleRegion: { x: 0.1, y: 0.1, width: 0.8, height: 0.8 }, stopLine: { start: { x: 0.2, y: 0.6 }, end: { x: 0.8, y: 0.6 } }, crossingDirection: 'top-to-bottom', signalRegion: { x: 0.75, y: 0.05, width: 0.15, height: 0.15 }, signalAssociation: 'traffic-signal-1' }, createdAt: '2026-10-27T12:00:00.000Z' };
      return route.fulfill(response({ schemaVersion: 2, id: runId, videoId, status: 'queued', analysisStarted: true, configurationSnapshot, createdAt: '2026-10-27T12:00:00.000Z', updatedAt: '2026-10-27T12:00:00.000Z', provenance } satisfies Record<string, unknown>, 202));
    }
    if (failedRun) {
      return route.fulfill(response({ schemaVersion: 2, id: runId, videoId, status: 'failed', analysisStarted: true, configurationSnapshot: { schemaVersion: 1, id: 'restored-config', source: { videoId, sha256: 'a'.repeat(64), width: 320, height: 240 }, geometry: {}, createdAt: '2026-10-27T12:00:00.000Z' }, createdAt: '2026-10-27T12:00:00.000Z', updatedAt: '2026-10-27T12:00:01.000Z', provenance, error: { code: 'YOLO_MODEL_NOT_CONFIGURED', message: 'Set YOLO_MODEL_PATH to the qualified yolo26n.pt checkpoint to enable car tracking.', stage: 'inference' } }));
    }
    const configurationSnapshot = {
      schemaVersion: 1,
      id: 'saved-config',
      source: { videoId, sha256: 'a'.repeat(64), width: 320, height: 240 },
      geometry: {
        vehicleRegion: { x: 0.1, y: 0.1, width: 0.8, height: 0.8 },
        stopLine: { start: { x: 0.2, y: 0.6 }, end: { x: 0.8, y: 0.6 } },
        crossingDirection: 'top-to-bottom',
        signalRegion: { x: 0.75, y: 0.05, width: 0.15, height: 0.15 },
        signalAssociation: 'traffic-signal-1',
      },
      createdAt: '2026-10-27T12:00:00.000Z',
    };
    return route.fulfill(response(completedRun(configurationSnapshot)));
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
      video.addEventListener('error', () => reject(new Error('Synthetic preview fixture did not load metadata.')), { once: true });
    });
  });
  await drawWithKeyboard(page, 'Draw vehicle region', [
    ...Array<'Shift+ArrowRight'>(6).fill('Shift+ArrowRight'),
    ...Array<'Shift+ArrowDown'>(4).fill('Shift+ArrowDown'),
  ]);
  await drawWithKeyboard(page, 'Draw stop line', [
    ...Array<'Shift+ArrowLeft'>(12).fill('Shift+ArrowLeft'),
    ...Array<'Shift+ArrowUp'>(2).fill('Shift+ArrowUp'),
  ]);
  await drawWithKeyboard(page, 'Draw signal region', [
    ...Array<'Shift+ArrowRight'>(12).fill('Shift+ArrowRight'),
    ...Array<'Shift+ArrowUp'>(10).fill('Shift+ArrowUp'),
  ]);
  await page.getByLabel('Crossing direction').selectOption('top-to-bottom');
  await page.getByLabel('Governing signal').selectOption('traffic-signal-1');
  await page.getByRole('button', { name: 'Save scene configuration' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Configuration snapshot' })).toBeVisible();
}

test('synthetic tracking contract draws distinct observed cars and never bridges a reported gap', async ({ page }) => {
  await openValidConfiguration(page);
  await page.getByRole('button', { name: 'Start traffic analysis' }).click();
  const overlay = page.getByTestId('traffic-analysis-overlay');
  await expect(overlay).toHaveAttribute('aria-label', 'Traffic detections at 0.00 seconds');
  const observationsAtZero = overlay.locator('g[data-overlay-kind="observation"]');
  await expect(observationsAtZero).toHaveCount(2);
  await expect(observationsAtZero.nth(0)).toHaveAttribute('data-track-id', 'car-7');
  await expect(observationsAtZero.nth(1)).toHaveAttribute('data-track-id', 'car-8');
  await expect(page.getByRole('list', { name: 'Tracking gaps and identity uncertainty' })).toContainText('2 frames unobserved');
  await expect(page.getByRole('list', { name: 'Tracking gaps and identity uncertainty' })).toContainText('identity continuity unverified');
  const identitySwitches = page.getByRole('list', { name: 'Possible identity switches; continuity unverified' });
  await expect(identitySwitches).toContainText('Track car-7');
  await expect(identitySwitches).toContainText('Track car-9');
  await expect(identitySwitches).toContainText('track IDs remain separate');

  const preview = page.getByLabel('Video for scene configuration');
  await preview.evaluate(video => {
    Object.defineProperty(video, 'currentTime', { configurable: true, value: 0.2 });
    video.dispatchEvent(new Event('timeupdate', { bubbles: true }));
  });
  await expect(overlay).toHaveAttribute('aria-label', 'Traffic detections at 0.20 seconds');
  await expect(overlay.locator('g[data-overlay-kind="observation"]')).toHaveCount(0);
  await expect(overlay.locator('line[data-overlay-kind="trajectory"]')).toHaveCount(0);
  await expect(page.getByRole('status').filter({ hasText: 'No recorded car observation at this playback time.' })).toContainText('no positions are interpolated');
});

test('synthetic failed-run response shows actionable error without a detection overlay', async ({ page }) => {
  await openValidConfiguration(page, true);
  await page.getByRole('button', { name: 'Start traffic analysis' }).click();
  const runRecords = page.getByRole('region', { name: 'Analysis run records' });
  await expect(runRecords).toContainText('Analysis failed');
  await expect(runRecords).toContainText('Set YOLO_MODEL_PATH to the qualified yolo26n.pt checkpoint');
  await expect(page.getByTestId('traffic-analysis-overlay')).toHaveCount(0);
  await expect(runRecords).not.toContainText('vehicle tracks');
});
