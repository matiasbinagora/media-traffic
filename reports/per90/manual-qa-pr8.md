# PER-90 Manual QA — PR #8

**Verdict: BLOCKED for the complete PER-90 story.** Backend signal inference passed live checks on the final PR head, including configured-ROI state recognition, absent/unreadable input, competing colors, a brief transition, and an unreadable/occluded interval. The playback UI criterion remains unverified because it belongs to PER-104 and is not included in PR #8.

## Scope and environment

- Issue: [PER-90 — Recognize the associated traffic signal over time](https://linear.app/matias-personal/issue/PER-90/recognize-the-associated-traffic-signal-over-time).
- Pull request/head: [PR #8](https://github.com/matiasbinagora/media-traffic/pull/8), `36dc5fb0aafe8c147527ed865f27870e97703c7b` (`feature/recognize-signal-state`).
- Worktree: `.worktrees/recognize-signal-state`; product tree was clean during this revalidation.
- Runtime: macOS arm64; Python 3.12.13, OpenCV 5.0.0, Ultralytics 8.4.190, PyTorch 2.14.1; CPU; qualified `yolo26n.pt` SHA-256 `9b09cc8bf347f0fc8a5f7657480587f25db09b34bf33b0652110fb03a8ad4fef`.
- Main video: `example/demo-traffic-video/source.mp4`, 1920×1080, 10 s, 30 fps, SHA-256 `0a1d32f82239e18fcbd1ae105a58343eb263e2c4bb48935c4d771270fdd53918`.
- API: local server on `127.0.0.1:18791`, isolated data directory `.local-data/per90-qa-final/`.

## Acceptance criteria

| Criterion | Result | Evidence |
| --- | --- | --- |
| Read the configured signal region and produce timestamped red/yellow/green/unknown observations. | **PASS** | Live analysis run `94fb0933-276e-46bb-a25f-c494d824873b` returned schema v2 and 300 frame-aligned observations from configured ROI `{x:0.155,y:0.04,width:0.055,height:0.19}`. Inferred phases were green `[0,61)`, yellow `[61,91)`, red `[91,210)`, green `[210,300)`, matching annotations compared after inference. Checked boundaries: frame 60 green (2.000 s), 61 yellow (2.033 s), 90 yellow (3.000 s), 91 red (3.033 s), 209 red (6.967 s), 210 green (7.000 s). |
| Show state and temporal context alongside playback. | **NOT VERIFIED** | The synchronized playback timeline is tracked by [PER-104](https://linear.app/matias-personal/issue/PER-104/render-the-inferred-traffic-signal-timeline-alongside-video), outside this PR. This remains a whole-story blocker. |
| Return unknown for occluded, missing, ambiguous, or unreadable signals. | **PASS** | Live API runs against controlled video inputs verified all relevant fallback paths: off-signal ROI run `ecb79113-1956-46ce-a1b2-a2ddcc1cd4d5` returned `unknown`/`no_readable_signal` on 300/300 frames; an undersized ROI run `615fa113-981c-489e-8dd3-1bdda436512b` returned `unknown`/`signal_region_too_small` on 300/300; a controlled red+green competing-pixel clip run `7ebda411-c200-4027-be82-6e6df6c72eb3` returned `unknown`/`multiple_colors` and interval rationale `ambiguous_signal` on 30/30; a one-frame red phase run `5ad66bd8-d817-4155-ac30-63ee770bcf45` exposed the one-frame interval as `unknown`/`transition_not_stable`; and a clip with a black obscured interval run `e482cfff-f092-43a9-a99a-2cf49df4b530` returned green, unknown/`no_readable_signal`, red intervals. Occlusion was represented as fully unreadable pixels in a controlled clip; natural-camera occlusion was not available. |
| Document stability rule and retain evidence supporting transitions. | **PASS** | Runtime timeline reports `consecutive-decoded-frames`, `requiredFrames: 3`. Stable phases retained their first three support frames. The one-frame red flash did not become a stable red interval and was returned as a one-frame unknown interval with `transition_not_stable`. |
| Keep reference annotations evaluation-only and separate from generic YOLO traffic-light detection. | **PASS** | Analysis used the uploaded original and saved ROI. Runtime provenance says `signalRecognition.method: configured-region-hsv`; YOLO class filter is `{id:2,name:"car"}`. The adapter receives no ground-truth path; annotations were consulted only after inference to compare timelines. |
| Preserve compatibility with traffic-analysis `schemaVersion: 2`. | **PASS** | All completed live API runs returned `schemaVersion: 2`, with `result.signalTimeline` additive under that existing response schema. |

## Reproduction and checks

1. Start the API: `YOLO_MODEL_PATH=/private/tmp/per86-yolo-check/yolo26n.pt YOLO_PYTHON_PATH=/private/tmp/per86-yolo-check/bin/python LOCAL_DATA_DIR=.local-data/per90-qa-final PORT=18791 npm run server`.
2. Upload the demo: `curl -F 'video=@example/demo-traffic-video/source.mp4;type=video/mp4' http://127.0.0.1:18791/api/videos`; save configuration at `POST /api/videos/:videoId/configurations`, then start with `POST /api/videos/:videoId/analysis-runs` and poll the run URL.
3. Controlled probes were generated as 320×240, 30 fps, one-second H.264 videos with `ffmpeg -y -loglevel error -f lavfi -i 'color=c=black:s=320x240:r=30:d=1' -vf <filter> -c:v libx264 -pix_fmt yuv420p -movflags +faststart <output>`, then uploaded and analyzed through the same API. The competing-color filter was `drawbox=x=80:y=80:w=40:h=40:color=red:t=fill,drawbox=x=160:y=80:w=40:h=40:color=green:t=fill`. The one-frame flash filter was `drawbox=x=150:y=80:w=24:h=48:color=green:t=fill:enable='lt(n,10)+gte(n,21)',drawbox=x=150:y=80:w=24:h=48:color=yellow:t=fill:enable='gte(n,10)*lt(n,20)',drawbox=x=150:y=80:w=24:h=48:color=red:t=fill:enable='eq(n,20)'`. The obscured-interval filter was `drawbox=x=150:y=80:w=24:h=48:color=green:t=fill:enable='lt(n,10)',drawbox=x=150:y=80:w=24:h=48:color=red:t=fill:enable='gte(n,20)'`.
4. `node --import tsx --test server/signal-analysis.test.ts` passed 6/6; `PYTHONPATH=. /private/tmp/per86-yolo-check/bin/python -m unittest server.inference.test_signal_observation` passed 4/4. The parent QA handoff reports `npm test` passed with 43 backend tests, 4 Python image tests, and 24 frontend tests, plus `npm run typecheck:server`, `npm run build`, `npm run spec:validate`, Python compile, and `git diff --check` passing on this head.

Run JSON is preserved locally under `.local-data/per90-qa-final/` for the main-video and custom-probe run IDs above. TestSprite was not run under the user's paid-plan upload limitation. This qualifies the generated test input and sample video only; it is not a general accuracy claim.

## Follow-up before PER-90 can pass

Complete PER-104 and independently verify signal state synchronized with playback. Do not mark PER-90 Done until that criterion passes. No Linear state or issue was changed during this QA.
