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

`POST /api/videos` accepts one `multipart/form-data` file in the `video` field. A valid media container with a video stream returns `201` and an upload job. The source is written under a UUID path and SHA-256 recorded; the client filename is sanitized for display and never used as a path. Upload is complete when this response arrives; preview generation continues asynchronously.

The job contains `id`, `originalName`, overall `status`, `upload`, `preview`, `source`, and timestamps. `upload.status` is `completed` after server validation. `preview.status` progresses from `processing` to `completed` or `failed`; poll `GET /api/videos/:id` for changes. A completed job adds `derivative` metadata with source-to-preview timestamp offset and pixel-coordinate scale derived from the measured dimensions. The source remains immutable and is retained if transcoding fails.

`GET /api/videos/:id/preview` returns `409 PREVIEW_PROCESSING` while transcoding, `409 PREVIEW_UNAVAILABLE` after a terminal conversion failure, or the `video/mp4` preview when ready. It supports single byte ranges (`206`); malformed or unsatisfiable ranges return `416` with `Content-Range: bytes */<size>`.

Error responses have `{ "error": { "code": "...", "message": "..." } }`. Empty or unreadable video returns `422`; unsupported extension/container returns `415`; uploads over the configured byte cap return `413`; invalid multipart requests and interrupted uploads return `400` with retry guidance where applicable. Rejected uploads leave no source or temporary file. Conversion failures remain visible in the job and are not converted into successful placeholder results.

## Verification

Run `npm run typecheck:server` and `npm run test:backend`. The backend suite creates a rights-cleared synthetic blue test clip with FFmpeg's `color` source; it contains no traffic imagery, annotations, or expected traffic events. Tests exercise validation errors, source immutability, real preview transcoding, range playback, conversion failure, and interrupted-upload cleanup.
