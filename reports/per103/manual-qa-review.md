# PER-103 Independent Manual QA

**Verdict: PASS for the story-specific synthetic asset qualification gate.** Manual review was performed in `.worktrees/improve-per86-yolo-detectability`, branch `feature/improve-per86-yolo-detectability`, HEAD `eddf8b60681dfd999211d2fed4844185d1624832`. Review covered the generated MP4, decoded event boundaries, signal states, provenance and a separately executed full-video detector run. This is not a product-wide accuracy claim.

## Acceptance results

| Criterion | Result | Evidence |
| --- | --- | --- |
| Synthetic asset provenance and GT/inference separation | PASS | `manifest.json` declares `synthetic: true` and links the MP4 and separate `ground-truth.json`. Manifest validation returned `valid: true`, 3 expected event types, and matching SHA-256 values: video `0a1d32f82239e18fcbd1ae105a58343eb263e2c4bb48935c4d771270fdd53918`; ground truth `59f6238d0a62fbf8973e175d9529f9a46b5c2ab4b08b8601c29ec2fd9eb3b23e`. |
| Video decodes and scene/signal are readable | PASS | FFprobe: H.264, 1920×1080, 30 fps, 300 frames, 10.000 seconds. Inspected decoded frames and [contact sheet](final-contact-sheet.png); the fixed camera scene is continuous and signal phases are visible. |
| Green crossing and detection at both annotated boundaries | PASS | Visually inspected frames 33 (1.100 s) and 36 (1.200 s): gold-car nose moves from before to beyond the stripe while the signal is green. Independent full inference detected class `car` at confidence 0.8870 and 0.8699. |
| Red crossing bracket is semantically correct and detected | PASS | At native resolution, using the leading front-bumper/headlight tip against the diagonal stripe centerline, frame 178 (5.9333 s) reaches the stripe and frame 179 (5.9667 s) is approximately 2 px beyond it; the signal is red in both. YOLO confidence was 0.8646 and 0.8673. Earlier proposed brackets 167/168 and 174/175 were still before the crossing and are invalid. See [native-resolution boundary evidence](manual-qa-boundaries.jpg). |
| Correctly stopped blue target coverage during red window | PASS | Blue car remains stationary behind the line in the reviewed video. In `[3, 7)` seconds, the predefined target region contained a car detection in 120/120 decoded frames (100%, gate >=80%). |

## Independent inference and checks

I independently reran a temporary copy of `run-inference.py` against a temporary snapshot, redirecting its output outside the worktree so the stored inference artifact was not changed. Command:

```sh
YOLO_MODEL_PATH=/private/tmp/per86-yolo-check/yolo26n.pt \
  /private/tmp/per86-yolo-check/bin/python \
  /private/tmp/per103-manual-qa/final-178-179-inference.py
```

The run processed all 300 decoded frames in 5.137 seconds on macOS arm64 CPU: Ultralytics 8.4.190, PyTorch 2.14.1, Python 3.12.13, `yolo26n.pt` (official Ultralytics v8.4.0 asset; SHA-256 `9b09cc8bf347f0fc8a5f7657480587f25db09b34bf33b0652110fb03a8ad4fef`), image size 640, COCO class 2 (`car`), confidence >=0.25. The independent output reported source and ground-truth hashes identical to the manifest, both red and green boundary detections, and 120/120 stop-window detections.

Additional commands: `node scripts/demo-manifest.mjs example/demo-traffic-video/manifest.json` (valid); `ffprobe -v error -select_streams v:0 -show_entries stream=codec_name,width,height,r_frame_rate,nb_frames,duration -of default=noprint_wrappers=1 example/demo-traffic-video/source.mp4` (metadata above); `shasum -a 256 example/demo-traffic-video/source.mp4 example/demo-traffic-video/ground-truth.json` (hashes above).

## Limits

This verifies one synthetic, fixed-camera sample and its stated detection gate only. It does not establish real-world detection quality, tracking, signal-state inference, crossing classification or production performance. HyperFrames browser rendering failed before frame 0 (`Target.setDiscoverTargets: Target closed`); the delivered MP4 was rendered with FFmpeg and its decoded frames were reviewed here. Automated unit, frontend and OpenSpec results are reported separately and were not treated as manual runtime evidence. No Linear transition or external status change was made.
