# PER-93 Functional QA — PR #13

**Verdict: FAIL — one reproducible failure-stage defect.**

## Review target and environment

- PR: [#13 — Expose truthful analysis progress and provenance](https://github.com/matiasbinagora/media-traffic/pull/13)
- Exact head: `f0a395491b066dcd72da0dea04c4661a55589e6b` (`feature/show-progress-and-provenance`)
- Worktree: `.worktrees/show-progress-and-provenance`
- Review date: 2026-10-29
- Runtime: Node `v26.8.2`, FFmpeg `9.0.2`, local API on `127.0.0.1:8787`
- `YOLO_MODEL_PATH` was not configured. The repository requires Node `22.23.2`; this review used the available Node 26 runtime, so runtime behavior under the pinned version remains unverified.
- Technical review: no submitted GitHub PR review was present when checked.

## Risk-based checks and results

| Acceptance area | Result | Runtime evidence |
|---|---|---|
| Queued/running stages accurately describe processing | **FAIL** | POST returned `status=queued`, `phase=queued`. Polling immediately reached `status=failed`; the same response labeled `error.code=YOLO_MODEL_NOT_CONFIGURED` as `error.stage=media_inspection`. This failure is raised when the tracker checks model configuration, before media inspection. The run therefore exposes a false stage. |
| Actionable, sanitized model failure; no fallback detections | **PASS** (except stage above) | The API returned the actionable message “Set YOLO_MODEL_PATH to the qualified yolo26n.pt checkpoint, then start a new analysis run.” No local path, stderr, or result/detection field was returned. The run stayed terminally failed. |
| Reruns retain distinct identities | **PASS** | Two POSTs using the same uploaded source and saved configuration returned run IDs `81ed9aa2-8da9-4b7f-b399-36af992b063e` and `987a50fc-089b-47f3-b55f-fe7e387fa352`; both independently reached failed status. |
| Unknown synthetic source remains unverified | **PASS** | Uploaded review clip SHA-256 `fafd5e67a08a5496197bf1a5c97c2ca27544cfb30bb69f6b418d99e734b01c08` was classified as `not-identified` / `no-matching-manifest`, not as the checked-in demo. |
| Preview availability and persistence | **PARTIAL PASS** | FFmpeg prepared the playable derivative; `GET /preview` with `Range: bytes=0-31` returned `206 Partial Content` and MP4 bytes. After stopping and restarting the server, GET of the terminal run returned the same persisted failed run ID and error. A successful result persisted through restart was not exercised. |
| Successful phases, result persistence, no-candidate/indeterminate distinction | **NOT VERIFIED** | No model was configured, so no successful inference or result was produced. This QA makes no detection or accuracy claim. |
| Inference timeout and recovery of queued/running work after restart | **NOT VERIFIED** | No inference worker could be started, and no queued/running run was available to interrupt. |
| UI progress, accessibility and TestSprite journeys | **NOT VERIFIED / NOT RUN** | This PR implements backend behavior; UI phase display is outside its scope. TestSprite’s paid file-upload feature is unavailable and local evidence was authorized instead. |

## Reproduction

1. Start the PR worktree API with `npm run server` while `YOLO_MODEL_PATH` is unset.
2. Generate a two-second review-only clip: `ffmpeg -hide_banner -loglevel error -f lavfi -i testsrc=size=320x240:rate=8 -t 2 -pix_fmt yuv420p -c:v mpeg4 -y /private/tmp/per93-manual-synthetic.mp4`.
3. Upload it with `curl -sS -F 'video=@/private/tmp/per93-manual-synthetic.mp4;filename=review-synthetic.mp4' http://127.0.0.1:8787/api/videos`.
4. Save a valid scene configuration matching the returned video ID, source SHA-256 and dimensions, then POST `/api/videos/<video-id>/analysis-runs` with that configuration ID.
5. GET `/api/videos/<video-id>/analysis-runs/<run-id>` until terminal. Observe `YOLO_MODEL_NOT_CONFIGURED`, sanitized actionable text, no result, and the incorrect `stage=media_inspection`.
6. Repeat the POST and compare run IDs. Stop and restart the server, then GET the first terminal record to confirm persistence.

The review used generated color bars only to exercise the API contract. It did not run YOLO, validate road-video detection, or establish accuracy. No product code or tests were changed; this report is the only review artifact.

## Defect

**Severity: Medium — misleading operational diagnosis.** With `YOLO_MODEL_PATH` absent, a run fails at tracker/model initialization but records `error.stage=media_inspection`. A caller or operator may investigate the uploaded video/FFprobe instead of the missing model configuration. Smallest next step: report the `preparation` or `car_tracking` stage for model-configuration/load/runtime failures, and rerun this API scenario to confirm the stage remains sanitized and actionable.
