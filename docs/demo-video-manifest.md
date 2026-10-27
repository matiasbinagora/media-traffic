# Synthetic Demo Video Manifest

The PER-86 reference asset lives under `example/demo-traffic-video/`. Keep the generated source clip, its expected-event annotations, and any future inference output in separate files. Never send `ground-truth.json` to the analysis pipeline.

`manifest.json` identifies the synthetic source and its independently stored annotation file:

```json
{
  "schemaVersion": 1,
  "synthetic": true,
  "video": {
    "path": "source.mp4",
    "sha256": "<64-character SHA-256>",
    "mimeType": "video/mp4",
    "codec": "h264",
    "width": 1920,
    "height": 1080,
    "durationSeconds": 10,
    "frameRate": 30
  },
  "groundTruth": {
    "path": "ground-truth.json",
    "sha256": "<64-character SHA-256>"
  }
}
```

The annotation JSON has `schemaVersion: 1`. A qualifying asset needs exactly one event of each type: `red_crossing`, `green_crossing`, and `correct_stop`. For an unqualified candidate, record only events that visual review can substantiate; the validator intentionally rejects incomplete event coverage. Each event has a unique `eventId`, `startSeconds`, and `endSeconds`; its interval must fit within the source duration. The validator checks file hashes, metadata, event coverage and timing, and rejects paths outside the asset directory or embedded inference data.

Run validation with:

```bash
node scripts/demo-manifest.mjs example/demo-traffic-video/manifest.json
node --test tests/demo-manifest.test.mjs
```

The validator requires `ffprobe` (or `FFPROBE_PATH`) and compares the manifest codec, dimensions, duration, and frame rate with the source stream.

A valid manifest establishes metadata and annotation integrity only. It does not qualify visual continuity, car detectability, signal readability, or YOLO inference.
