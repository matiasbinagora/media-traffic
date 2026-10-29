# Scene configuration API

This API implements the backend configuration contract for [PER-88](https://linear.app/matias-personal/issue/PER-88/configure-the-stop-line-movement-and-traffic-signal). Coordinates are normalized to the uploaded source frame, with the top-left as `(0, 0)` and the bottom-right as `(1, 1)`. The API checks the source video ID, SHA-256 checksum, and dimensions against the saved upload before accepting geometry.

## Save an immutable configuration

`POST /api/videos/:videoId/configurations` accepts the `SceneConfigurationSnapshot` shape used by `SceneConfigurationEditor.onSave`:

```json
{
  "schemaVersion": 1,
  "id": "10000000-0000-4000-8000-000000000002",
  "source": {
    "videoId": "<uploaded-video-id>",
    "sha256": "<uploaded-source-sha256>",
    "width": 320,
    "height": 240
  },
  "geometry": {
    "vehicleRegion": { "x": 0.1, "y": 0.2, "width": 0.8, "height": 0.7 },
    "stopLine": { "start": { "x": 0.2, "y": 0.6 }, "end": { "x": 0.8, "y": 0.6 } },
    "crossingDirection": "top-to-bottom",
    "signalRegion": { "x": 0.72, "y": 0.08, "width": 0.12, "height": 0.32 },
    "signalAssociation": "traffic-signal-1"
  },
  "createdAt": "2026-10-20T12:00:00.000Z"
}
```

Successful saves return `201` and the normalized snapshot. Each snapshot ID is create-only; saving edits requires a new ID. A repeated ID returns `409 SCENE_CONFIGURATION_IMMUTABLE`. Incomplete or out-of-frame geometry returns `422 SCENE_CONFIGURATION_INVALID` with `error.details.invalidFields`; possible fields are `vehicleRegion`, `stopLine`, `crossingDirection`, `signalRegion`, and `signalAssociation`. The stop line must have distinct endpoints, directions must use one of the four supported values, and signal association must be an explicit non-empty value.

## Start car tracking

`POST /api/videos/:videoId/analysis-runs` accepts `{ "configurationId": "<saved-configuration-id>" }`. It returns `202` with a unique run in `queued` state and a deep copy of the immutable scene configuration. The backend reads the uploaded original source, decodes every frame and persists timestamped YOLO/ByteTrack observations. Poll `GET /api/videos/:videoId/analysis-runs/:runId` until the status is `completed` or `failed`.

A completed run includes `result.tracks[]`. Each track contains its `trackId`, first/last source presentation time, all observed boxes with confidence, decoded frame index, pixel and normalized coordinates, plus explicit gaps for missing observations. `result.possibleIdentitySwitches[]` conservatively links distinct IDs whose observed track endpoints are 1–3 decoded frames apart and spatially overlap or are close; links are marked `identityContinuity: "unverified"` and never merge IDs or add boxes. No boxes are interpolated over a gap. `result.sampledFrameCount` reports all decoded frames. Source timestamps come from FFprobe `best_effort_timestamp_time`; for synchronized preview overlays convert preview time to source time using the upload derivative's `timestampMapping.offsetSeconds` (`sourceSeconds = previewSeconds + offsetSeconds`).

The run also records source hash, model/version/checkpoint hash, runtime/platform/device, tracker config/hash, frame sampling and thresholds. Runs progress `queued` → `running` → `completed` or `failed`; failures have an actionable error and never substitute fixtures. Inference defaults to a 15-minute timeout; set `YOLO_INFERENCE_TIMEOUT_MS` to a positive integer to change it. A timed-out inference process is terminated and persisted as `ANALYSIS_INFERENCE_TIMEOUT`. If saving the `running` transition fails, the server attempts to persist `ANALYSIS_RUN_STATE_PERSIST_FAILED` and does not start inference; repeated storage failure is logged, and startup recovery later fails the still-queued record. On startup, persisted `queued` or `running` runs are marked failed with `ANALYSIS_WORKER_INTERRUPTED` so clients do not poll indefinitely. A missing or unsaved configuration returns `422 SCENE_CONFIGURATION_REQUIRED`; the original source missing from storage returns `404 VIDEO_SOURCE_NOT_FOUND`. Later scene edits use a new configuration ID and cannot change prior run evidence.

Completed run responses include `result.signalTimeline`, derived frame-by-frame from the saved `configurationSnapshot.geometry.signalRegion` in the uploaded original source. It does not read `ground-truth.json` or use the generic YOLO traffic-light class. The current recognizer counts saturated red, yellow, and green pixels in HSV ranges inside the configured rectangle; it reports `unknown` if no color reaches 0.5% of the region, if multiple colors compete (runner-up at least half the leading score), or if the pixel crop is smaller than 3×3. For crops at least 3×3, `evidenceScore` is the leading colored-pixel fraction even when the state is unknown because the evidence is weak or competing; for an undersized crop no pixels are sampled and the score is zero. It is a pixel ratio, not a calibrated probability. Raw observations and their color ratios remain available for review.

The temporal rule requires three consecutive decoded frames with the same readable color (about 100 ms at 30 fps) before that phase is exposed as a stable interval. Short color runs become `unknown` with rationale `transition_not_stable`; other unknown rationales are `no_readable_signal`, `ambiguous_signal`, and `signal_region_too_small`. Readable-color intervals preserve the first three supporting frame indices. Adjacent unknown intervals are kept separate when their raw causes differ so a change in rationale is not hidden. Intervals use half-open frame and time bounds. This is a conservative prototype rule, not a production accuracy claim. The API provides the synchronized timeline; rendering it alongside playback requires a frontend change.

The optional inference adapter requires an operator-provided Python runtime and `YOLO_MODEL_PATH` pointing to the qualified `yolo26n.pt` checkpoint. Set `YOLO_PYTHON_PATH` when Python with OpenCV, PyTorch, PyYAML and Ultralytics is not available as `python3`. The adapter verifies checkpoint SHA-256 `9b09cc8bf347f0fc8a5f7657480587f25db09b34bf33b0652110fb03a8ad4fef` and uses the repository's pinned ByteTrack YAML. No model weights or Python dependency are bundled.

**Prototype license decision:** the user selected GNU AGPL-3.0 for this public prototype; the canonical text is in [`LICENSE`](../LICENSE). This records the prototype scope, not legal advice or clearance for broader commercial, private-SaaS, or production use. Ultralytics software and trained weights are offered under AGPL-3.0 or Enterprise terms; this repository does not bundle those dependencies or weights, and the repository license does not relicense third-party materials. Review applicable third-party terms and obtain separate clearance before broader distribution or deployment.

Scene configuration and run records are persisted as JSON files under the upload's private data directory. The API limits JSON request bodies to 128 KB and does not expose an update or delete route for these immutable records.

## Validation

Run `npm run typecheck:server`, `node --import tsx --test server/analysis-run.test.ts server/scene-configuration.test.ts server/traffic-analysis.test.ts`, and `npm run test:backend`. The recorded qualification run is in [`reports/per89/qualification.md`](../reports/per89/qualification.md).
