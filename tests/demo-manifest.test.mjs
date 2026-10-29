import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { validateDemoManifest } from '../scripts/demo-manifest.mjs';

const videoBytes = await readFile(new URL('../example/demo-traffic-video/source.mp4', import.meta.url));
const videoHash = createHash('sha256').update(videoBytes).digest('hex');

const defaultGroundTruth = {
  schemaVersion: 1,
  signalTimeline: [
    { startFrame: 0, endFrameExclusive: 60, startSeconds: 0, endSeconds: 2, state: 'green' },
    { startFrame: 60, endFrameExclusive: 90, startSeconds: 2, endSeconds: 3, state: 'amber' },
    { startFrame: 90, endFrameExclusive: 210, startSeconds: 3, endSeconds: 7, state: 'red' },
    { startFrame: 210, endFrameExclusive: 300, startSeconds: 7, endSeconds: 10, state: 'green' },
  ],
  signalAmbiguityReview: {
    status: 'none_observed',
    intervals: [],
    reviewedBoundaryFrames: [0, 59, 60, 89, 90, 209, 210, 299],
    basis: 'Manual review of decoded source frames, independent of detector output. No signal-state intervals were ambiguous; the red-crossing boundary judgement is documented with its event annotation.',
  },
  events: [
    { eventId: 'red-1', type: 'red_crossing', startSeconds: 5.933, endSeconds: 5.967 },
    { eventId: 'green-1', type: 'green_crossing', startSeconds: 1.1, endSeconds: 1.2 },
    { eventId: 'stop-1', type: 'correct_stop', startSeconds: 3, endSeconds: 7 },
  ],
};

async function createAsset(t, { annotations, manifestOverrides = {} } = {}) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'media-traffic-demo-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(path.join(root, 'inference'), { recursive: true });
  await writeFile(path.join(root, 'source.mp4'), videoBytes);

  const groundTruth = annotations
    ? { ...structuredClone(defaultGroundTruth), ...annotations }
    : structuredClone(defaultGroundTruth);
  const annotationBytes = Buffer.from(`${JSON.stringify(groundTruth, null, 2)}\n`);
  const annotationHash = createHash('sha256').update(annotationBytes).digest('hex');
  await writeFile(path.join(root, 'ground-truth.json'), annotationBytes);
  await writeFile(path.join(root, 'manifest.json'), JSON.stringify({
    schemaVersion: 1,
    synthetic: true,
    video: {
      path: 'source.mp4',
      sha256: videoHash,
      mimeType: 'video/mp4',
      codec: 'h264',
      width: 1920,
      height: 1080,
      durationSeconds: 10,
      frameRate: 30,
    },
    groundTruth: { path: 'ground-truth.json', sha256: annotationHash },
    ...manifestOverrides,
  }, null, 2));
  return root;
}

test('validates the independent ground-truth file and verifies both asset hashes', async (t) => {
  const root = await createAsset(t);

  const result = await validateDemoManifest(path.join(root, 'manifest.json'));

  assert.deepEqual(result.eventTypes, ['correct_stop', 'green_crossing', 'red_crossing']);
  assert.equal(result.synthetic, true);
});

test('records crossing windows at the decoded frames where the rendered car noses cross the stop line', async () => {
  const groundTruthPath = new URL('../example/demo-traffic-video/ground-truth.json', import.meta.url);
  const groundTruth = JSON.parse(await readFile(groundTruthPath, 'utf8'));
  const greenCrossing = groundTruth.events.find((event) => event.type === 'green_crossing');
  const redCrossing = groundTruth.events.find((event) => event.type === 'red_crossing');

  assert.deepEqual([greenCrossing.startSeconds, greenCrossing.endSeconds], [1.1, 1.2]);
  assert.deepEqual([redCrossing.startSeconds, redCrossing.endSeconds], [5.933, 5.967]);
});

test('records the full signal timeline and explicit signal ambiguity review', async (t) => {
  const groundTruthPath = new URL('../example/demo-traffic-video/ground-truth.json', import.meta.url);
  const groundTruth = JSON.parse(await readFile(groundTruthPath, 'utf8'));

  assert.deepEqual(groundTruth.signalTimeline, [
    { startFrame: 0, endFrameExclusive: 60, startSeconds: 0, endSeconds: 2, state: 'green' },
    { startFrame: 60, endFrameExclusive: 90, startSeconds: 2, endSeconds: 3, state: 'amber' },
    { startFrame: 90, endFrameExclusive: 210, startSeconds: 3, endSeconds: 7, state: 'red' },
    { startFrame: 210, endFrameExclusive: 300, startSeconds: 7, endSeconds: 10, state: 'green' },
  ]);
  assert.deepEqual(groundTruth.signalAmbiguityReview, {
    status: 'none_observed',
    intervals: [],
    reviewedBoundaryFrames: [0, 59, 60, 89, 90, 209, 210, 299],
    basis: 'Manual review of decoded source frames, independent of detector output. No signal-state intervals were ambiguous; the red-crossing boundary judgement is documented with its event annotation.',
  });

  const root = await createAsset(t);
  const result = await validateDemoManifest(path.join(root, 'manifest.json'));
  assert.equal(result.signalTimelineIntervalCount, 4);
  assert.equal(result.signalTimelineFrameCount, 300);
});

test('rejects ground truth without an explicit signal ambiguity review', async (t) => {
  const annotations = { signalAmbiguityReview: undefined };
  const root = await createAsset(t, { annotations });

  await assert.rejects(
    validateDemoManifest(path.join(root, 'manifest.json')),
    /must include an explicit signalAmbiguityReview record/,
  );
});

test('rejects signal timeline gaps or overlaps', async (t) => {
  const annotations = structuredClone(defaultGroundTruth);
  annotations.signalTimeline[1].startFrame = 61;
  const root = await createAsset(t, { annotations });

  await assert.rejects(
    validateDemoManifest(path.join(root, 'manifest.json')),
    /signalTimeline intervals must cover every decoded frame exactly once/,
  );
});

test('CLI reports a verified manifest as JSON', async (t) => {
  const root = await createAsset(t);
  const cli = new URL('../scripts/demo-manifest.mjs', import.meta.url);

  const result = spawnSync(process.execPath, [cli.pathname, path.join(root, 'manifest.json')], { encoding: 'utf8' });

  assert.equal(result.status, 0, result.stderr);
  const output = JSON.parse(result.stdout);
  assert.equal(output.valid, true);
  assert.equal(output.synthetic, true);
  assert.equal(output.videoSha256, videoHash);
  assert.deepEqual(output.eventTypes, ['correct_stop', 'green_crossing', 'red_crossing']);
  assert.equal(output.eventCount, 3);
  assert.equal(output.signalTimelineIntervalCount, 4);
  assert.equal(output.signalTimelineFrameCount, 300);
  assert.equal(output.signalAmbiguityReviewStatus, 'none_observed');
});

test('rejects annotations when a required event class is missing', async (t) => {
  const root = await createAsset(t, {
    annotations: {
      schemaVersion: 1,
      events: [{ eventId: 'red-1', type: 'red_crossing', startSeconds: 2, endSeconds: 3 }],
    },
  });

  await assert.rejects(
    validateDemoManifest(path.join(root, 'manifest.json')),
    /must contain exactly one red_crossing, green_crossing, and correct_stop event/,
  );
});

test('rejects an annotation path that escapes the demo asset directory', async (t) => {
  const root = await createAsset(t, {
    manifestOverrides: { groundTruth: { path: '../outside.json', sha256: '0'.repeat(64) } },
  });

  await assert.rejects(
    validateDemoManifest(path.join(root, 'manifest.json')),
    /must stay inside the asset directory/,
  );
});

test('rejects a video symlink that resolves outside the demo asset directory', async (t) => {
  const root = await createAsset(t);
  const outsideVideoPath = `${root}-external.mp4`;
  t.after(() => rm(outsideVideoPath, { force: true }));
  await writeFile(outsideVideoPath, videoBytes);
  await symlink(outsideVideoPath, path.join(root, 'source-link.mp4'));
  const manifestPath = path.join(root, 'manifest.json');
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
  manifest.video.path = 'source-link.mp4';
  await writeFile(manifestPath, JSON.stringify(manifest, null, 2));

  await assert.rejects(
    validateDemoManifest(manifestPath),
    /must stay inside the asset directory/,
  );
});

test('rejects annotation timestamps beyond the source duration', async (t) => {
  const root = await createAsset(t, {
    annotations: {
      schemaVersion: 1,
      events: [
        { eventId: 'red-1', type: 'red_crossing', startSeconds: 2, endSeconds: 3 },
        { eventId: 'green-1', type: 'green_crossing', startSeconds: 4, endSeconds: 5 },
        { eventId: 'stop-1', type: 'correct_stop', startSeconds: 9, endSeconds: 11 },
      ],
    },
  });

  await assert.rejects(
    validateDemoManifest(path.join(root, 'manifest.json')),
    /event stop-1 ends after the source video/,
  );
});

test('rejects a video hash that does not match the referenced source file', async (t) => {
  const root = await createAsset(t, {
    manifestOverrides: {
      video: {
        path: 'source.mp4',
        sha256: '0'.repeat(64),
        mimeType: 'video/mp4',
        width: 1280,
        height: 720,
        durationSeconds: 10,
        frameRate: 30,
      },
    },
  });

  await assert.rejects(
    validateDemoManifest(path.join(root, 'manifest.json')),
    /video SHA-256 does not match/,
  );
});

test('rejects manifest metadata that does not match the probed video stream', async (t) => {
  const root = await createAsset(t, {
    manifestOverrides: {
      video: {
        path: 'source.mp4',
        sha256: videoHash,
        mimeType: 'video/mp4',
        codec: 'h264',
        width: 1280,
        height: 720,
        durationSeconds: 10,
        frameRate: 30,
      },
    },
  });

  await assert.rejects(
    validateDemoManifest(path.join(root, 'manifest.json')),
    /video width does not match the probed stream/,
  );

  const codecRoot = await createAsset(t, {
    manifestOverrides: {
      video: {
        path: 'source.mp4',
        sha256: videoHash,
        mimeType: 'video/mp4',
        codec: 'mpeg4',
        width: 1920,
        height: 1080,
        durationSeconds: 10,
        frameRate: 30,
      },
    },
  });
  await assert.rejects(
    validateDemoManifest(path.join(codecRoot, 'manifest.json')),
    /video codec does not match the probed stream/,
  );
});

test('rejects inference data embedded in the synthetic asset manifest', async (t) => {
  const root = await createAsset(t, { manifestOverrides: { inference: { detections: [] } } });

  await assert.rejects(
    validateDemoManifest(path.join(root, 'manifest.json')),
    /inference outputs must not be stored in the asset manifest/,
  );
});

test('rejects inference data embedded in the ground-truth document', async (t) => {
  const root = await createAsset(t, {
    annotations: {
      schemaVersion: 1,
      inference: { detections: [] },
      events: [
        { eventId: 'red-1', type: 'red_crossing', startSeconds: 2.1, endSeconds: 2.8 },
        { eventId: 'green-1', type: 'green_crossing', startSeconds: 4.2, endSeconds: 4.9 },
        { eventId: 'stop-1', type: 'correct_stop', startSeconds: 6.1, endSeconds: 7.4 },
      ],
    },
  });

  await assert.rejects(
    validateDemoManifest(path.join(root, 'manifest.json')),
    /inference output must remain separate from groundTruth/,
  );
});

test('rejects detection fields embedded in ground-truth event annotations', async (t) => {
  const root = await createAsset(t, {
    annotations: {
      schemaVersion: 1,
      events: [
        { eventId: 'red-1', type: 'red_crossing', startSeconds: 2.1, endSeconds: 2.8, detections: [] },
        { eventId: 'green-1', type: 'green_crossing', startSeconds: 4.2, endSeconds: 4.9 },
        { eventId: 'stop-1', type: 'correct_stop', startSeconds: 6.1, endSeconds: 7.4 },
      ],
    },
  });

  await assert.rejects(
    validateDemoManifest(path.join(root, 'manifest.json')),
    /inference output must remain separate from groundTruth/,
  );
});
