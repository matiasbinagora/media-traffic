# PER-86 Inference Qualification Addendum

Reviewed: 2026-10-28. This supersedes the 2026-10-26 readiness decision below, which predates the redesigned sample. The original investigation is retained in Git history; the merged current sample has a successful real inference record in [`reports/per103/qualification.md`](../per103/qualification.md) and [`reports/per103/yolo-inference.json`](../per103/yolo-inference.json).

## Selected prototype runtime and license direction

The evaluated runtime was Ultralytics 8.4.190 with PyTorch 2.14.1 on Python 3.12.13, macOS arm64 CPU. The official `yolo26n.pt` asset from Ultralytics assets release v8.4.0 was pinned by SHA-256 `9b09cc8bf347f0fc8a5f7657480587f25db09b34bf33b0652110fb03a8ad4fef`. The user's selected direction is a public AGPL-3.0 prototype. Ultralytics states that its trained YOLO models are offered under AGPL-3.0 by default and also offers Enterprise licensing; see [Ultralytics licensing](https://www.ultralytics.com/license). This records the product direction and upstream statement, not a legal opinion. A private, closed-source, or commercial deployment is outside this selection and requires a separate license review.

## Reproducible sample result

Inference was run on `example/demo-traffic-video/source.mp4` at 640-pixel input, COCO class 2 (`car`), confidence threshold 0.25, full-frame over all 300 decoded frames. Wall-clock time was 5.262 seconds. Video SHA-256: `0a1d32f82239e18fcbd1ae105a58343eb263e2c4bb48935c4d771270fdd53918`. The run detected cars at the green crossing boundaries (frames 33 and 36; confidence 0.8870 and 0.8699) and red crossing boundaries (frames 178 and 179; 0.8646 and 0.8673). The stopped blue target was detected in its predefined region in 120/120 frames during the red interval (100%; story-specific sample gate >=80%).

The original inference output records ground-truth SHA-256 `59f6238d0a62fbf8973e175d9529f9a46b5c2ab4b08b8601c29ec2fd9eb3b23e`, the annotation version before the signal timeline was added. The inference run used the video, not ground-truth labels. Current ground-truth SHA-256 is `e1854684c36a5d0d3dda99df3ffc33bb9651a93c18efac7ca0c90d8afff957ed`; only independent reference annotations changed, not the MP4 or inference output. The annotation uses frame-derived boundaries at 30 fps and accounts for the renderer's inclusive overlay endpoints and red→amber→green compositing priority. Direct decoded lamp-pixel assertions cover all phase boundaries and both crossing event brackets.

This qualifies one synthetic sample only. It does not demonstrate real-world detection quality, signal-state inference, multi-object tracking robustness, crossing classification, or production accuracy. The project must continue to keep inference output and reference annotations separate.
