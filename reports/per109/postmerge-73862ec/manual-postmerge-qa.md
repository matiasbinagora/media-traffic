# PER-109 Post-merge Functional QA

**Overall verdict: PASS for the verified post-merge UI behavior.**

## Revision and environment

- GitHub merge commit on `main`: `73862ecff679b94aac705c7574b23bf126c4f6f4`.
- Tested checkout: `c36f38aa2ea6b216878360c538ecff6a909c1943` in `.worktrees/qa-per109-pr16-c36f38aa`.
- GitHub confirmed the merge and reviewed head have identical tree `59b0138b8913de0e58dfa68713921a9bdbe2cf59`; local `git rev-parse HEAD^{tree}` returned the same tree. This report therefore tests the merged product tree through the exact reviewed checkout.
- Node 22.23.2; local API `127.0.0.1:18897`; Vite `127.0.0.1:5197`.

## Acceptance checks

| Criterion | Result | Evidence |
|---|---|---|
| Real upload, playable preview, and scene configuration | PASS | Local API accepted the 2,416,868-byte source; browser loaded a 1920×1080, 10 s MP4 preview and saved configuration with the matching source SHA. See `runtime-observations.json`. |
| Playback, seeking, and overlay synchronization | PASS | Seek to 1.19 s selected frame 36; playback advanced the overlay label from 1.19 s to 1.32 s. At desktop 1440 px and mobile 390 px, measured overlay geometry remained within 0.018 normalized units. |
| Track 2 at exactly 5.25 s between frames 157 and 158 | PASS | At desktop and 390 px the UI showed one Track 2 box/count. Its raw SVG geometry matched frame 157 exactly; frame 158 differed by at least 0.000055 in a normalized coordinate. |
| Gap uncertainty and no trajectory bridge | PASS (controlled case) | A replay response with frame 39 removed from Track 1 displayed “1 frame unobserved … identity continuity unverified.” No line crossed the gap; line counts were 38 at the gap midpoint and after it, at desktop and mobile. |
| Responsive width at 390 px | PASS | Viewport and document widths were both 390 px. |
| Focused frontend test | PASS | 9 tests passed. |
| Repeated repository Playwright test command | NOT VERIFIED | The additional `npm run test:playwright` invocation was interrupted by the user before a result was returned. The independent Chromium manual journey below completed successfully. |

## Commands and artifacts

- `git rev-parse HEAD` → `c36f38aa2ea6b216878360c538ecff6a909c1943`; `git rev-parse HEAD^{tree}` → `59b0138b8913de0e58dfa68713921a9bdbe2cf59`.
- `npm run test:frontend -- src/TrafficAnalysisOverlay.test.tsx` (Node 22.23.2) → 1 file, 9 tests passed.
- Manual Chromium journey → PASS. It used the real local upload/preview/config API and routed only analysis responses to the persisted replay. The one-off runner was in a temporary directory and was not retained; observations and screenshots are persisted here.
- The replay source hash was verified against `example/demo-traffic-video/manifest.json` and `reports/per90/postmerge/run-result.json`: `0a1d32f82239e18fcbd1ae105a58343eb263e2c4bb48935c4d771270fdd53918`.
- Measurements: [`runtime-observations.json`](runtime-observations.json). Screenshots: [`qualified-replay-desktop.png`](qualified-replay-desktop.png), [`qualified-replay-390.png`](qualified-replay-390.png), [`midpoint-5-25-desktop.png`](midpoint-5-25-desktop.png), [`midpoint-5-25-390.png`](midpoint-5-25-390.png), [`controlled-gap-desktop.png`](controlled-gap-desktop.png), [`controlled-gap-390.png`](controlled-gap-390.png).

## Limitations

- Fresh YOLO inference and real-world detection accuracy: **NOT VERIFIED**. No model checkpoint was configured; the saved, hash-verified PER-90 result was replay data, not new inference.
- The replay has no natural tracking gaps. The gap scenario was deliberately injected into a replay response, so it verifies UI behavior for that controlled case only.
- TestSprite: **NOT VERIFIED / NOT RUN**; its paid upload-file feature is unavailable in this account.
- No product code or Linear state was changed.
