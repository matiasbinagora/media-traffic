import { expect, test, type Page, type Route } from '@playwright/test';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

const fixturePath = path.join(process.cwd(), 'e2e/fixtures/rights-cleared-blue.mp4');
const videoId = 'd78d4663-448b-45d1-b77b-b130756125ab';
const runId = '7bc376cb-cc0c-4d2e-a59d-02bf48db4f39';

async function fulfillSeekablePreview(route: Route) {
  const video = await readFile(fixturePath);
  const range = route.request().headers().range;
  if (!range) {
    await route.fulfill({
      status: 200,
      headers: { 'accept-ranges': 'bytes', 'content-length': String(video.byteLength), 'content-type': 'video/mp4' },
      body: video,
    });
    return;
  }

  const match = /^bytes=(\d+)-(\d*)$/.exec(range);
  if (!match) {
    await route.fulfill({ status: 416, headers: { 'accept-ranges': 'bytes', 'content-range': `bytes */${video.byteLength}` } });
    return;
  }
  const start = Number(match[1]);
  const end = match[2] ? Math.min(Number(match[2]), video.byteLength - 1) : video.byteLength - 1;
  if (start > end || start >= video.byteLength) {
    await route.fulfill({ status: 416, headers: { 'accept-ranges': 'bytes', 'content-range': `bytes */${video.byteLength}` } });
    return;
  }
  const chunk = video.subarray(start, end + 1);
  await route.fulfill({
    status: 206,
    headers: {
      'accept-ranges': 'bytes',
      'cache-control': 'private, no-store',
      'content-length': String(chunk.byteLength),
      'content-range': `bytes ${start}-${end}/${video.byteLength}`,
      'content-type': 'video/mp4',
    },
    body: chunk,
  });
}

async function moveDrawingCursor(editor: ReturnType<Page['getByRole']>, key: 'ArrowLeft' | 'ArrowRight' | 'ArrowUp' | 'ArrowDown', steps: number) {
  for (let index = 0; index < steps; index += 1) await editor.press(`Shift+${key}`);
}

async function drawValidScene(page: Page) {
  const canvas = page.getByRole('application', { name: 'Scene geometry editor' });
  await canvas.focus();

  await page.getByRole('button', { name: 'Draw vehicle region' }).click();
  await canvas.focus();
  await canvas.press('Enter');
  await moveDrawingCursor(canvas, 'ArrowLeft', 4);
  await moveDrawingCursor(canvas, 'ArrowUp', 4);
  await canvas.press('Enter');

  await page.getByRole('button', { name: 'Draw stop line' }).click();
  await canvas.focus();
  await moveDrawingCursor(canvas, 'ArrowLeft', 2);
  await moveDrawingCursor(canvas, 'ArrowDown', 6);
  await canvas.press('Enter');
  await moveDrawingCursor(canvas, 'ArrowRight', 12);
  await canvas.press('Enter');

  await page.getByRole('button', { name: 'Draw signal region' }).click();
  await canvas.focus();
  await moveDrawingCursor(canvas, 'ArrowLeft', 1);
  await moveDrawingCursor(canvas, 'ArrowUp', 11);
  await canvas.press('Enter');
  await moveDrawingCursor(canvas, 'ArrowRight', 3);
  await moveDrawingCursor(canvas, 'ArrowDown', 3);
  await canvas.press('Enter');

  await page.getByLabel('Crossing direction').selectOption('top-to-bottom');
  await page.getByLabel('Governing signal').selectOption('traffic-signal-1');
  await expect(page.getByRole('alert')).toHaveCount(0);
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
      derivative: { url: `/api/videos/${videoId}/preview`, media: { durationSeconds: 0.6, width: 640, height: 480 }, timestampMapping: { sourceSeconds: 'previewSeconds + offsetSeconds', previewSeconds: 'MP4 presentation time from zero', offsetSeconds: 12 } },
      createdAt: '2026-10-28T00:00:00.000Z',
      updatedAt: '2026-10-28T00:00:01.000Z',
    }),
  }));
  await page.route(`**/api/videos/${videoId}/preview`, fulfillSeekablePreview);
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
          { state: 'red', startFrameIndex: 0, endFrameExclusive: 3, startSeconds: 12, endSeconds: 12.3, rationale: 'stable_for_three_consecutive_frames', transitionEvidence: { supportingFrameIndices: [0, 1, 2] } },
          { state: 'unknown', startFrameIndex: 3, endFrameExclusive: 4, startSeconds: 12.3, endSeconds: 12.4, rationale: 'ambiguous_signal' },
          { state: 'green', startFrameIndex: 4, endFrameExclusive: 7, startSeconds: 12.4, endSeconds: 12.6, rationale: 'stable_for_three_consecutive_frames', transitionEvidence: { supportingFrameIndices: [4, 5, 6] } },
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
  const video = page.getByLabel('Video for scene configuration');
  await expect.poll(() => video.evaluate(element => {
    const media = element as HTMLVideoElement;
    return media.seekable.length ? media.seekable.end(0) : 0;
  })).toBeGreaterThan(0);
  await drawValidScene(page);
  const savePromise = page.waitForResponse(response => response.url().includes('/configurations') && response.request().method() === 'POST');
  await page.getByRole('button', { name: 'Save scene configuration' }).click();
  savedConfiguration = await (await savePromise).json();
  expect(savedConfiguration.geometry).toMatchObject({
    vehicleRegion: expect.objectContaining({ width: expect.any(Number), height: expect.any(Number) }),
    stopLine: expect.objectContaining({ start: expect.any(Object), end: expect.any(Object) }),
    signalRegion: expect.objectContaining({ width: expect.any(Number), height: expect.any(Number) }),
    crossingDirection: 'top-to-bottom',
    signalAssociation: 'traffic-signal-1',
  });
  await page.getByRole('button', { name: 'Start traffic analysis' }).click();
  const timeline = page.getByRole('region', { name: 'Inferred traffic signal timeline' });
  await expect(timeline).toBeVisible();
  await expect(timeline.getByRole('status')).toContainText('Red · stable for three consecutive frames');
  const slider = timeline.getByRole('slider', { name: 'Signal timeline playback position' });
  await expect.poll(() => video.evaluate(element => (element as HTMLVideoElement).duration)).toBeCloseTo(0.6, 1);
  await page.evaluate(() => {
    const slider = document.querySelector<HTMLInputElement>('.signal-timeline-slider')!;
    const video = document.querySelector<HTMLVideoElement>('.scene-video')!;
    const events: Array<Record<string, unknown>> = [];
    Object.assign(window, { __signalSeekEvents: events });
    const snapshot = (type: string, sliderValue = slider.value) => events.push({
      type,
      sliderValue,
      currentTime: video.currentTime,
      seeking: video.seeking,
      seekable: Array.from({ length: video.seekable.length }, (_, index) => [video.seekable.start(index), video.seekable.end(index)]),
      buffered: Array.from({ length: video.buffered.length }, (_, index) => [video.buffered.start(index), video.buffered.end(index)]),
    });
    slider.addEventListener('input', event => snapshot('input', (event.currentTarget as HTMLInputElement).value));
    slider.addEventListener('change', event => snapshot('change', (event.currentTarget as HTMLInputElement).value));
    for (const type of ['seeking', 'seeked', 'timeupdate']) video.addEventListener(type, () => snapshot(type));
  });

  const initialTime = await video.evaluate(element => (element as HTMLVideoElement).currentTime);
  await video.evaluate(element => (element as HTMLVideoElement).play());
  await expect.poll(() => video.evaluate(element => (element as HTMLVideoElement).paused)).toBe(false);
  await expect.poll(() => video.evaluate(element => (element as HTMLVideoElement).currentTime)).toBeGreaterThan(initialTime + 0.05);
  await expect.poll(async () => Math.abs(Number(await slider.inputValue()) - await video.evaluate(element => (element as HTMLVideoElement).currentTime))).toBeLessThan(0.03);

  await video.evaluate(element => (element as HTMLVideoElement).pause());
  await expect.poll(() => video.evaluate(element => (element as HTMLVideoElement).paused)).toBe(true);
  const pausedTime = await video.evaluate(element => (element as HTMLVideoElement).currentTime);
  await page.waitForTimeout(150);
  expect(await video.evaluate(element => (element as HTMLVideoElement).currentTime)).toBe(pausedTime);

  const seekSteps: Array<Record<string, unknown>> = [];
  const recordSeekStep = async (step: string) => seekSteps.push(await page.evaluate(stepName => {
    const slider = document.querySelector<HTMLInputElement>('.signal-timeline-slider')!;
    const video = document.querySelector<HTMLVideoElement>('.scene-video')!;
    const ranges = (timeRanges: TimeRanges) => Array.from({ length: timeRanges.length }, (_, index) => [timeRanges.start(index), timeRanges.end(index)]);
    return {
      step: stepName,
      sliderValue: slider.value,
      sliderValueText: slider.getAttribute('aria-valuetext'),
      videoTime: video.currentTime,
      duration: video.duration,
      paused: video.paused,
      seeking: video.seeking,
      readyState: video.readyState,
      seekable: ranges(video.seekable),
      buffered: ranges(video.buffered),
    };
  }, step));

  await slider.focus();
  await slider.press('Home');
  await recordSeekStep('Home');
  for (let index = 0; index < 30; index += 1) {
    await slider.press('ArrowRight');
    await recordSeekStep(`ArrowRight ${index + 1}`);
  }
  const diagnosticsDirectory = path.join(process.cwd(), 'reports/per104/runtime-validation');
  await mkdir(diagnosticsDirectory, { recursive: true });
  const eventLog = await page.evaluate(() => (window as Window & { __signalSeekEvents: Array<Record<string, unknown>> }).__signalSeekEvents);
  await writeFile(path.join(diagnosticsDirectory, 'seek-events.json'), `${JSON.stringify({ seekSteps, events: eventLog }, null, 2)}\n`);
  await expect.poll(() => video.evaluate(element => (element as HTMLVideoElement).currentTime)).toBeCloseTo(0.3, 1);
  await expect.poll(() => slider.evaluate(element => Number((element as HTMLInputElement).value))).toBeCloseTo(0.3, 1);
  await expect(timeline.getByRole('status')).toContainText('Unknown · ambiguous signal');

  const sliderBounds = await slider.boundingBox();
  if (!sliderBounds) throw new Error('Signal timeline slider has no rendered bounds.');
  await page.mouse.click(sliderBounds.x + sliderBounds.width * 0.75, sliderBounds.y + sliderBounds.height / 2);
  await expect.poll(() => video.evaluate(element => (element as HTMLVideoElement).currentTime)).toBeCloseTo(0.45, 1);
  await expect(timeline.getByRole('status')).toContainText('Green · stable for three consecutive frames');
  await expect.poll(() => video.evaluate(element => (element as HTMLVideoElement).seeking)).toBe(false);

  expect(eventLog.some(event => event.type === 'input')).toBe(true);
  expect(eventLog.some(event => event.type === 'seeking')).toBe(true);
  expect(eventLog.some(event => event.type === 'seeked')).toBe(true);
  const visualEvidenceDirectory = path.join(process.cwd(), 'reports/per104');
  await mkdir(visualEvidenceDirectory, { recursive: true });
  await page.screenshot({ path: path.join(visualEvidenceDirectory, 'signal-timeline-desktop.png'), fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(timeline).toBeVisible();
  await expect(page.locator('body')).toHaveJSProperty('scrollWidth', 390);
  await page.screenshot({ path: path.join(visualEvidenceDirectory, 'signal-timeline-mobile.png'), fullPage: true });
});
