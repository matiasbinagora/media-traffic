# PER-86 Current Sample Visual Qualification

Reviewed: 2026-10-28. This report supersedes the pre-PER-103 candidate review, which described the previous source hash and is retained in Git history. The current sample is `example/demo-traffic-video/source.mp4`, merged on `origin/main` at PR #6.

## Asset and signal timeline

FFprobe reports H.264, 1920×1080, 30/1 fps, 300 decoded frames and 10.000 seconds. Source SHA-256: `0a1d32f82239e18fcbd1ae105a58343eb263e2c4bb48935c4d771270fdd53918`. Ground-truth SHA-256: `e1854684c36a5d0d3dda99df3ffc33bb9651a93c18efac7ca0c90d8afff957ed`, recorded in `example/demo-traffic-video/manifest.json` and validated by the manifest test.

The complete signal timeline uses zero-based frame indices with inclusive starts and exclusive ends; timestamps are frame/fps boundaries at 30 fps: green `[0,61)` / `[0,61/30)` s; amber `[61,91)` / `[61/30,91/30)` s; red `[91,210)` / `[91/30,7)` s; green `[210,300)` / `[7,10)` s. FFmpeg enables overlays with inclusive time endpoints, composited red then amber then green. Consequently frame 60 is green, frame 90 amber, and frame 210 green. Direct decoded lamp-pixel checks cover frames 59/60/61, 89/90/91 and 209/210/211, as well as green-crossing frames 33/36 and red-crossing frames 178/179. See [the transition contact sheet](evidence/signal-transition-frames-20261028.jpg), arranged left-to-right across rows in this order: 59, 60, 61, 89, 90, 91, 209, 210, 211. No ambiguous signal-state intervals were observed. The blue-car stop window `[3,7)` s includes amber at frame 90 and red at frames 91–209; green returns at frame 210 after the stop window ends. The red crossing’s near-line judgement remains explicitly described in the event annotation and independent manual QA.

The independent expected events remain separate from detector output: gold-car green crossing at 1.100–1.200 s, red-car crossing at 5.933–5.967 s, and blue-car correct stop during `[3,7)` s. These frames show a fixed synthetic camera and readable signal. The review does not establish real-world generalization.

## Superseded inference-readiness decision

The previous readiness report predates the sample redesign and is superseded by the current result in [`reports/per103/qualification.md`](../per103/qualification.md), [`reports/per103/manual-qa-review.md`](../per103/manual-qa-review.md), and [`reports/per103/yolo-inference.json`](../per103/yolo-inference.json). The actual `yolo26n.pt` run used Ultralytics 8.4.190, PyTorch 2.14.1, Python 3.12.13, macOS arm64 CPU, 640-pixel input, COCO car class 2, confidence 0.25, and all 300 decoded frames (5.262 seconds). It detected both crossing boundary cars and the stopped target in 120/120 red-window frames (100%; story-specific gate >=80%).

The saved inference artifact was produced before the signal timeline was added; its recorded ground-truth digest is the prior version (`59f6238d0a62fbf8973e175d9529f9a46b5c2ab4b08b8601c29ec2fd9eb3b23e`). Its source-video digest still matches the current MP4. The new signal timeline is manually reviewed reference data and was not an inference input. Qualification applies only to this synthetic sample, not tracking robustness, signal inference, event classification, or production accuracy.
