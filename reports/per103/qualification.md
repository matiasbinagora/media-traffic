# PER-103 Sample Qualification

This is a story-specific qualification of `example/demo-traffic-video/source.mp4`; its thresholds do not set a product-wide accuracy target. The source is a synthetic composite: a generated static intersection, generated transparent car cutouts, authored signal-state overlays, and deterministic FFmpeg motion. Provenance is recorded in `video/demo-traffic/assets/README.md`. The independent expected events live in `example/demo-traffic-video/ground-truth.json`; inference output is kept separately in `yolo-inference.json`.

## Reproducible Inference

Run `reports/per103/run-inference.py` with OpenCV, PyTorch, and Ultralytics installed, and set `YOLO_MODEL_PATH` to the official pretrained `yolo26n.pt` COCO checkpoint. The script rejects any checkpoint whose SHA-256 differs from the recorded official asset and writes both video and ground-truth hashes into `yolo-inference.json`. This run used Ultralytics 8.4.190, PyTorch 2.14.1, Python 3.12.13, macOS arm64 CPU, image size 640, class id 2 (`car`), confidence threshold 0.25, full-frame inference, and all 300 decoded frames. Wall-clock inference time was 5.262 seconds. Source SHA-256: `0a1d32f82239e18fcbd1ae105a58343eb263e2c4bb48935c4d771270fdd53918`; ground-truth SHA-256: `59f6238d0a62fbf8973e175d9529f9a46b5c2ab4b08b8601c29ec2fd9eb3b23e`; checkpoint SHA-256: `9b09cc8bf347f0fc8a5f7657480587f25db09b34bf33b0652110fb03a8ad4fef`.

## Results

| Event | Annotated decoded frames | YOLO car confidence | Result |
| --- | --- | ---: | --- |
| Green crossing, gold car | 33 at 1.100 s; 36 at 1.200 s | 0.8870; 0.8699 | Detected in both boundary frames; decoded images show the nose move from before to beyond the line while green is displayed. |
| Red crossing, red car | 178 at 5.933 s; 179 at 5.967 s | 0.8646; 0.8673 | Detected in both boundary frames. Independent native-frame review uses the leading front-bumper/headlight tip: it reaches the stripe at frame 178 and is about 2 px beyond at frame 179; red is displayed in both. |
| Correct stop, blue car | Frames 90–209, 3.000–6.967 s | 120/120 frames | 100% screen-region coverage; the car remains stationary behind the line through the red interval and proceeds after green returns. |

The stop-car region is `[x=500..950, y=650..950]` in 1920×1080 pixels, separating it from the red crossing car. Stop-car confidence ranged from 0.8881 to 0.8928. This region-based match is specific to the known synthetic composition, not a general identity tracker. `final-contact-sheet.png` shows the decoded crossing-boundary and stop-window frames in order: frames 33, 36, 178, 179, 90, and 209.

## Qualification and Limitations

The sample asset meets the numeric detection gate at the corrected annotated boundaries, and the stopped target is detected in 100% of evaluated decoded frames, exceeding the story-specific 80% threshold. The manifest's `qualificationStatus: qualified` describes this asset gate only. Independent QA, PR review, and the Linear workflow still determine when PER-103 itself is complete. The sample remains synthetic, uses a static generated camera scene and composited car sprites, and does not establish performance on real footage, signal-state inference, tracking robustness, event classification, or production accuracy. HyperFrames structural checks passed, but its browser render failed before frame 0 (`Target.setDiscoverTargets: Target closed`); the delivered video was rendered and decoded with FFmpeg instead.
