# Video Upload API

This local API implements the backend slice of [PER-87](https://linear.app/matias-personal/issue/PER-87/upload-and-play-a-traffic-video). It stores each original upload separately from an H.264/AAC MP4 browser preview. Upload completion and preview generation do not mean traffic analysis has run; response objects intentionally contain no analysis result.

## Run locally

Use Node 22.23.2 and install FFmpeg/FFprobe on `PATH` (or set `FFMPEG_PATH` and `FFPROBE_PATH`). In separate terminals, run `npm run server` and `npm run dev`. Vite forwards `/api` requests to `http://127.0.0.1:8787`. The backend binds to loopback by default.

Set `PORT` (default `8787`), `HOST` (default `127.0.0.1`), `LOCAL_DATA_DIR` (default `.local-data`), and `MAX_UPLOAD_BYTES` (default `209715200`, or 200 MiB). There is no duration limit. `MEDIA_PROCESS_TIMEOUT_MS` sets the per-command media tool timeout (30 seconds by default for probing; 30 minutes for preview transcoding when unset). Storage directories and source files are local, ignored, and created with owner-only permissions where supported.

## Contract

`GET /api/uploads/limits` returns the authoritative UI limits:

```json
{
  "supportedFormats": [".mp4", ".mov", ".webm"],
  "maxUploadBytes": 209715200,
  "maxUploadMegabytes": 200,
  "durationLimitSeconds": null,
  "fieldName": "video"
}
```

`POST /api/videos` accepts one `multipart/form-data` file in the `video` field. A valid media container with a video stream returns `201` and an upload job with `schemaVersion: 1`. The source is written under a UUID path and SHA-256 recorded; the client filename is sanitized for display and never used as a path. Upload is complete when this response arrives; preview generation continues asynchronously. `schemaVersion` versions the job JSON shape and should change when a backwards-incompatible field or meaning changes.

The job contains `schemaVersion`, `id`, `originalName`, overall `status`, `upload`, `preview`, `source`, and timestamps. `upload.status` is `completed` after server validation. `status` and `preview.status` move from `processing` to `completed` or `failed`; poll `GET /api/videos/:id` for changes. A completed job adds `derivative` metadata with source-to-preview timestamp offset and pixel-coordinate scale derived from the measured dimensions. The source remains immutable and is retained if transcoding fails.

The current lifecycle intentionally has no persisted `queued` or `running` status. The server cannot issue a job ID until the request body is fully received, validated, and its source file is safely persisted; failures before that point return a structured upload error and leave no job. Once the job exists, the Node server immediately starts FFmpeg in-process, so a separate `queued` state would be an unobservable scheduling instant and `running` would duplicate the visible `processing` stage. This server has no durable queue or scheduler. `processing` means preview preparation only; future traffic analysis must have its own explicit job lifecycle and must not be inferred from this status.

`GET /api/videos/:id/preview` returns `409 PREVIEW_PROCESSING` while transcoding, `409 PREVIEW_UNAVAILABLE` after a terminal conversion failure, or the `video/mp4` preview when ready. It supports single byte ranges (`206`); malformed or unsatisfiable ranges return `416` with `Content-Range: bytes */<size>`.

## Traffic analysis runs (PER-93)

Save a scene configuration, then `POST /api/videos/:id/analysis-runs` with its `configurationId`. The server accepts a run only while the persisted playable preview is present. Each response keeps the existing run `schemaVersion: 2` and includes a distinct `id`, `status` (`queued`, `running`, `completed`, or `failed`), and `phase`. Phases move through actual media inspection, preparation, car tracking, signal analysis, and result generation; clients should show the returned value instead of estimating progress. `GET /api/videos/:id/analysis-runs/:runId` returns the persisted record.

`completed` is stored atomically with the result only after the preview file is still available and result metadata has been generated. `failed` responses include a sanitized `error.stage`, stable `error.code`, and actionable `error.message`; raw Python diagnostics and local paths are not part of the API. After restart, queued/running records become failed and a retry must create a new run ID. The source SHA-256 is compared to the checked-in demo manifest independently of inference: only an exact match is `manifest-verified`; every other upload is `not-identified`, not presumed real or synthetic. Provenance retains the source identity, immutable configuration snapshot, model/runtime versions when available, tracking/signal parameters, and timebase. A successful run with no tracks remains a completed empty result.

Error responses have `{ "error": { "code": "...", "message": "..." } }`. Empty or unreadable video returns `422`; unsupported extension/container returns `415`; uploads over the configured byte cap return `413`; invalid multipart requests and interrupted uploads return `400` with retry guidance where applicable. Rejected uploads leave no source or temporary file. Conversion failures remain visible in the job and are not converted into successful placeholder results.

## Verification

Run `npm run typecheck:server` and `npm run test:backend`. The backend suite creates rights-cleared synthetic clips locally with FFmpeg's `color` source: a blue 319×239 MP4 (12 fps, 1 second, MPEG-4 Part 2, timestamp offset 2 seconds), a green 320×240 MOV (10 fps, 0.5 seconds, MPEG-4 Part 2), and a red 320×240 WebM (10 fps, 0.5 seconds, VP9). These are codec/container fixtures only; they contain no traffic imagery, annotations, or expected traffic events. Tests exercise validation errors, source immutability, successful MP4/MOV/WebM uploads, real preview transcoding, range playback, conversion failure, and interrupted-upload cleanup.
