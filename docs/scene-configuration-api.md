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

## Capture configuration for a run

`POST /api/videos/:videoId/analysis-runs` accepts `{ "configurationId": "<saved-configuration-id>" }`. It returns `201` with a unique immutable run record containing a deep copy of that configuration:

The response example abbreviates the full `configurationSnapshot` object; its value is the complete snapshot returned by the save route.

```json
{
  "schemaVersion": 1,
  "id": "<analysis-run-id>",
  "videoId": "<uploaded-video-id>",
  "status": "not_started",
  "analysisStarted": false,
  "configurationSnapshot": { "schemaVersion": 1, "id": "<saved-configuration-id>" },
  "createdAt": "2026-10-20T12:00:00.000Z"
}
```

This route captures run provenance only. It does not queue work, start inference, or report analysis completion. A missing or unsaved configuration returns `422 SCENE_CONFIGURATION_REQUIRED`; analysis remains unavailable until a processing service is implemented. Later scene edits use a new configuration ID and cannot change the saved configuration or any earlier run record. Retrieve a record with `GET /api/videos/:videoId/analysis-runs/:runId`.

Scene configuration and run records are persisted as JSON files under the upload's private data directory. The API limits JSON request bodies to 128 KB and does not expose an update or delete route for these immutable records.

## Validation

Run `npm run typecheck:server`, `node --import tsx --test server/scene-configuration.test.ts`, and `npm run test:backend`. Configuration records do not certify that traffic detection ran or passed.
