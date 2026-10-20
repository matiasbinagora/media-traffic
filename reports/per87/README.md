# PER-87 QA Evidence

## Scope

Independent QA for [PER-87](https://linear.app/matias-personal/issue/PER-87/upload-and-play-a-traffic-video) and OpenSpec `video-upload`. The suite covers published limits, valid upload and replay, explicit “analysis not started” state, invalid media rejection, and recovery. This upload story does not run YOLO; no detection accuracy metric is applicable.

## Environment and input

- macOS `darwin/arm64`, Node `v22.23.2`, FFmpeg `9.0.2`, Playwright `1.64.1`, Chromium `156.0.8078.4`.
- `e2e/fixtures/rights-cleared-blue.mp4`: synthetic FFmpeg lavfi blue frame, MP4/H.264, 320×240, 0.6 seconds, 2,134 bytes. It contains no traffic imagery or ground truth.
- `e2e/fixtures/ffmpeg-fail-once.cjs` injects one local preview-transcode failure, then delegates subsequent requests to real FFmpeg so the UI recovery journey can be observed end to end.

## Checks

| Check | Result | Evidence |
| --- | --- | --- |
| Backend and frontend typechecks | PASS | Node 22.23.2 command output in task transcript |
| Backend and frontend unit tests | PASS, 12/12 | `npm test` (6 backend, 6 frontend) |
| Production frontend build | PASS | `npm run build` |
| Strict OpenSpec validation | PASS, 2/2 | `npm run spec:validate` |
| Playwright Chromium integration | PASS, 5/5 | `playwright-results.json`; browser traces/screenshots are retained on failure only |
| TestSprite upload limits journey | PASS, 4/4 steps | Run `e1dfc820-2bf1-4774-984b-b85b432ec083`; [project dashboard](https://www.testsprite.com/dashboard-v3/o/28a80924-c39d-5b00-844c-74372658d763/projects/c0d461ac-6a7e-475c-bdfd-b773ecc52513) |
| TestSprite conversion failure/recovery journey | BLOCKED | Run `9231bbac-1207-4463-8024-abe53a651660`; remote runner had no valid MP4 to upload, so conversion/recovery could not be reached |

Playwright’s five real-browser cases verify the successful playable preview; one real FFmpeg failure followed by a successful next upload; unsupported `.avi` rejection before POST; corrupt MP4 error followed by a valid replacement; and rejection above the server-provided size limit before POST. The oversize browser case supplies a deterministic 64-byte limit response; the existing backend unit test separately verifies a real `413` at the configured byte boundary and cleanup of rejected files. Another backend test covers interrupted-upload cleanup and preview-generation failure preserving the source.

## Observed media metrics

The latest local Chromium run on Node `v22.23.2` measured upload acceptance at **HTTP 201 in 92 ms** and `Preview ready` at **1,384 ms** from clicking Upload. The source was 2,134 bytes; the H.264 MP4 preview was 1,845 bytes and returned HTTP 200 as `video/mp4`. These are single-run observations, not performance thresholds; the project has no agreed latency or size target.

Raw measurements are in `upload-observations.json`. Full Playwright run summary is `playwright-results.json`; `preview-ready.png` captures the successful upload and playback state.

## TestSprite suite and limitation

The local V3 frontend project is `c0d461ac-6a7e-475c-bdfd-b773ecc52513`. Six English plan files in `testsprite/plans/` cover limits, successful preview, unsupported format, corrupt-media recovery, transcode-failure recovery, and oversize rejection. Plan generation returned the documented local-target precondition (exit 6), so these plans were authored manually and all six passed CLI dry-run validation.

Created TestSprite test IDs by plan filename order:

1. `01-upload-limits`: `3efd51ef-f780-4413-973b-3c57e39d82c3` — PASS.
2. `02-supported-upload-preview`: `6b79e3d4-ff60-4d98-88b5-6c9290547985` — NOT RUN.
3. `03-unsupported-format`: `ec93b960-5871-4a0d-a9c6-d86d41c8706a` — NOT RUN.
4. `04-corrupt-rejection-recovery`: `4ccc28cc-dcd7-460f-a210-1dbb6b31e75f` — NOT RUN.
5. `05-preview-failure-recovery`: `008469c5-19f4-4843-874b-adc20ca0c856` — BLOCKED; the remote TestSprite runner could not provide a local file for the native file chooser. The uploaded-media assertions are independently verified by Playwright and backend tests.
6. `06-oversized-upload`: `f0364fc9-fd82-480c-b023-9c95145aad7b` — NOT RUN.

The TestSprite pass has four successful limit and disabled-button assertions. The blocked run’s steps show that it navigated successfully but did not upload a video; the service withheld its failure bundle after the environment was edited. No TestSprite screenshot was provided for either run. Do not count the blocked/not-run cases as verified by TestSprite.

## Notes

- The first Playwright attempt was blocked because Chromium could not start in the sandbox (`bootstrap_check_in … Permission denied`). After authorized execution outside the sandbox, five cases passed. One intermediate run timed out because its locator used a label that correctly changes to the selected filename; the test now targets the stable `#video-file` input. No application defect reproduced.
- `npm audit --json` reports four high-severity findings in the pre-existing dev-tool dependency chain `@fission-ai/openspec@1.13.2` → `fast-glob` → `micromatch` → `braces`; all report `fixAvailable: false`. `npm audit --omit=dev --json` reports zero findings. This is not attributable to the Playwright dependency added for QA; no dependency changes were made to address the OpenSpec findings.
- No Linear status, commit, push, PR, or merge was performed.
