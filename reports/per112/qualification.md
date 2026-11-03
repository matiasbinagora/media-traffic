# PER-112 YOLO Crossing Qualification

## Verdict

The single-clip demo gate **passes** on the replacement source using the repository's actual YOLO/ByteTrack adapter, signal pixel classifier, and crossing-analysis implementation. This qualifies this synthetic sample for the agreed task gate only; it does not establish broad precision/recall or p95 performance.

| Check | Result | Evidence |
| --- | --- | --- |
| Red crossing | PASS: one red candidate | Track 3, frames 178–179; candidate time 5.945557 s |
| Timing | PASS: 12.22 ms from conservative annotation midpoint | Annotation bracket 5.900000–5.966667 s; midpoint 5.933333 s; limit ±33.3 ms |
| Green crossing | PASS: zero red candidates | Track 1 at 1.000000 s, classified `not_candidate / signal_not_red` |
| Correct stop during red | PASS: zero red candidates | Track 2 remains upstream/stationary during [3, 7) s; no crossing assessment in the stop window |
| Signal timeline | PASS | Pixel-derived stable intervals: green [0, 2), yellow [2, 3), red [3, 7), green [7, 10) |

Track 2 subsequently crosses at 7.816670 s after green returns and is classified `not_candidate / signal_not_red`. It is not counted as a red candidate.

## Source and independent annotation

- Video: `example/demo-traffic-video/source.mp4`, SHA-256 `981154c80389850d83d8621b43ca638d38737d2179ce1734efac60f7b8267ab3`.
- Ground truth: `example/demo-traffic-video/ground-truth.json`, SHA-256 `de3f821a37a99b8e6d0e2a3e0963a2d43c37597b90b1943cfaa8c2c569cad2ed`.
- Applied scene configuration: `reports/per112/scene-configuration.json`; stop-line and signal-region geometry are preserved with source identity and dimensions.
- Before the final qualification run, a blind manual review inspected only decoded source frames and confirmed the signal boundaries and visual controls without seeing ground truth or inference outputs. It corrected the signal intervals to green frames 0–59, amber 60–89, red 90–209, green 210–299, and conservatively bracketed the rotated red vehicle's leading-edge midpoint from frames 177–179. The gold crossing interval was also reconciled to frames 27–33 (0.900–1.100 s). No labels were derived or tuned from model output. The final annotation hash was recorded before the final inference run.
- FFprobe: H.264, 1920×1080, 30/1 fps, 300 frames, 10.000 seconds.
- HyperFrames lint/check passed with zero errors and warnings; reviewed frame snapshots and contact sheets are in `evidence/`.

## Inference provenance

- Checkpoint: official Ultralytics assets release v8.4.0 `yolo26n.pt`, SHA-256 `9b09cc8bf347f0fc8a5f7657480587f25db09b34bf33b0652110fb03a8ad4fef`.
- Runtime: Ultralytics 8.4.190, PyTorch 2.14.1, Python 3.12.13, macOS arm64 CPU.
- Tracker: ByteTrack with `server/inference/bytetrack.yaml` (SHA-256 `4e4a91e815e198c2ac6e3b1def0cdd7020534e2d228ca638ec4dd87eae6179bc`).
- Sampling: every decoded frame using FFprobe presentation timestamps; 300 frames; confidence ≥0.25; image size 640; COCO class 2 (`car`).
- Video-only model input: the final inference command received the source video, checkpoint, tracker settings, and signal crop. It did not receive the ground-truth file.
- Signal crop configured around all three visible lamp positions: `(315, 70, 70, 170)` pixels in the 1920×1080 frame. A preliminary diagnostic run with an undersized crop omitted the red lamp; the final crop follows visible source geometry and produced stable phase observations. Final qualification inference was rerun after the blind annotation review and final GT hash were recorded.
- Recorded final tracking duration: 8.406 seconds, including model initialization; this is one run, not a p95 measurement.

Commands:

```bash
/private/tmp/per112-yolo-venv/bin/python server/inference/track-cars.py \
  --source example/demo-traffic-video/source.mp4 \
  --weights /private/tmp/per112-yolo26n.pt \
  --tracker server/inference/bytetrack.yaml \
  --output reports/per112/yolo-tracking.json \
  --signal-region-json '{"x":0.1640625,"y":0.0648148,"width":0.0364583,"height":0.1574074}'

env PATH=/Users/matiasbinagora/.nvm/versions/node/v22.23.2/bin:/opt/homebrew/bin:/usr/bin:/bin \
  npx --yes --package=tsx@4.23.15 tsx reports/per112/evaluate-crossings.mjs
```

The evaluator imports `assembleTrackResult`, `classifySignalObservation`, `assembleSignalTimeline`, and `assessCrossingEvents` from the server modules and reads the recorded scene configuration before writing `crossing-assessments.json`. It verifies the video, frozen ground-truth, and configuration source identity before analysis.

## Artifacts and limits

- Raw real tracker/signal output: `reports/per112/yolo-tracking.json` (SHA-256 `6e5de969ea2b35af3d923ae03b28300fee560d44c489e4e378aa034227e1c307`).
- Reproducible production-rule assessment: `reports/per112/crossing-assessments.json` (SHA-256 `d9483a737678b1d449bf9bfc4d1872f3f4089824168cec30144b4a41a83f4b8e`).
- Evaluator: `reports/per112/evaluate-crossings.mjs`.
- The one red, one green, and one stop control pass the approved demo gate. No claim is made about broad event accuracy, unseen cameras, legal determinations, or p95 latency.
- Independent technical review and manual QA on the final PR head remain required before PER-91 can be unblocked. No PR has been created or merged by this report.
