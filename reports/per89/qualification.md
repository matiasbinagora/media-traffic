# PER-89 Car Tracking Qualification

This report records a real API run against the qualified synthetic reference video uploaded through `POST /api/videos`. Ground truth is not used by the tracker. This qualifies the sample/API contract only; it is not an accuracy or latency target for other footage.

## Reproduction

With the local server running and an operator-provided inference environment configured, upload the reference source, save a scene configuration, start a run, and poll the returned run URL:

```sh
YOLO_PYTHON_PATH=/path/to/python YOLO_MODEL_PATH=/path/to/yolo26n.pt npm run server
curl -F 'video=@example/demo-traffic-video/source.mp4;type=video/mp4' http://127.0.0.1:8787/api/videos
# Save the returned source id/hash and dimensions as a configuration:
curl -H 'content-type: application/json' -d @configuration.json http://127.0.0.1:8787/api/videos/$VIDEO_ID/configurations
curl -H 'content-type: application/json' -d '{"configurationId":"<saved-configuration-id>"}' http://127.0.0.1:8787/api/videos/$VIDEO_ID/analysis-runs
curl http://127.0.0.1:8787/api/videos/$VIDEO_ID/analysis-runs/$RUN_ID
```

The run used uploaded-source SHA-256 `0a1d32f82239e18fcbd1ae105a58343eb263e2c4bb48935c4d771270fdd53918`; run `e3ee07a3-9154-4168-9875-26a503bb49df` completed with 300 decoded frames and 3 distinct ByteTrack IDs. The retained tracks were: ID 1, 76 boxes from 0.000–2.500 s; ID 2, 284 boxes from 0.533–9.967 s; ID 3, 112 boxes from 3.600–7.300 s. Two tracks were simultaneously observed in 172 frames. There were no missing-observation intervals in this sample; deterministic regression coverage separately checks that gaps are surfaced without interpolation.

## Provenance

- Detector: Ultralytics YOLO26 `yolo26n.pt`; checkpoint SHA-256 `9b09cc8bf347f0fc8a5f7657480587f25db09b34bf33b0652110fb03a8ad4fef`.
- Runtime: Ultralytics 8.4.190, PyTorch 2.14.1, Python 3.12.13; macOS 27.0.1 arm64 CPU.
- Tracker: ByteTrack config `server/inference/bytetrack.yaml`, SHA-256 `4e4a91e815e198c2ac6e3b1def0cdd7020534e2d228ca638ec4dd87eae6179bc`; high/low/new-track thresholds 0.25/0.1/0.25, buffer 30 frames, match threshold 0.8, score fusion enabled.
- Sampling/filter: every decoded source frame, timestamps from FFprobe `best_effort_timestamp_time`, 640 input, COCO class 2 (`car`), confidence 0.25. Measured tracker-stage time was 5.320 seconds on the 10-second, 1920×1080 sample, including model load and frame inference. It excludes upload/preview processing and FFprobe timestamp extraction. This is a measurement, not an agreed performance threshold.

## Limits and prototype license decision

The sample contains composited vehicles on a fixed generated scene. Three stable identities and two concurrent tracks were observed on this clip, but this is not evidence of real-world tracking accuracy, identity continuity under challenging occlusion, signal inference, crossing classification, or production performance. The user selected GNU AGPL-3.0 for the public prototype; the repository license text is at root. This is a documented project choice, not legal advice or clearance for broader commercial, private-SaaS, or production use. Ultralytics, PyTorch, OpenCV, model weights and their third-party terms remain operator-provided and are not bundled. OpenSpec task 1.4 is complete for the public prototype's selected runtime/license and recorded hardware qualification; broader distribution/deployment clearance remains open. The API process queue is in-memory; startup recovery marks abandoned runs failed, but this is not a durable worker system.

## Independent QA evidence

Playwright completed **9/9** with no skipped or flaky tests on 2026-10-27. The JSON report and browser artifacts are in [`reports/per89/playwright-final`](./playwright-final/); this includes synthetic UI coverage for distinct timestamped observations, explicit gaps, unverified identity continuity, no interpolation, and honest failed-run behavior. The tracking and failure-response UI data are explicitly synthetic and do not qualify model output. Real API routes also verified immutable configuration/run behavior with the model unavailable. Upload/transcode checks use a synthetic blue-frame fixture and do not count as detection evidence.

The three TestSprite V3 local runs reached the web app but are all **BLOCKED at upload prerequisite**, so they provide no product verdict for scene setup, inference, failed-run handling, or tracking. The TestSprite cloud browser had no access to the developer workstation's `example/demo-traffic-video/source.mp4`; it stopped before upload. The successful real API sample above remains separate qualification evidence.

| TestSprite case | Run ID | Result and evidence |
| --- | --- | --- |
| Incomplete scene configuration prevents car tracking | `d04cdb88-ea2b-4bb1-b36a-583c3a22c3d8` | BLOCKED at step 2: no demo file available. [Dashboard](https://www.testsprite.com/dashboard-v3/o/28a80924-c39d-5b00-844c-74372658d763/projects/c0d461ac-6a7e-475c-bdfd-b773ecc52513/test-cases/4412ffab-129f-4f80-8cbc-bf7df8aeae0a); [pinned steps](./testsprite/d04cdb88-ea2b-4bb1-b36a-583c3a22c3d8-steps.json). |
| Completed car tracking shows synchronized temporal observations | `ec8b736e-f102-4dbf-8c78-087ff25c9f90` | BLOCKED at step 2: no video fixture available; inference never began. [Dashboard](https://www.testsprite.com/dashboard-v3/o/28a80924-c39d-5b00-844c-74372658d763/projects/c0d461ac-6a7e-475c-bdfd-b773ecc52513/test-cases/868a5cb5-89b9-40e7-9206-f20e87761450); [pinned steps](./testsprite/ec8b736e-f102-4dbf-8c78-087ff25c9f90-steps.json). |
| Unavailable YOLO model produces an honest failed analysis run | `9fd0635a-079c-4331-b277-7de40b918cdd` | BLOCKED at step 2 with the API correctly running without YOLO variables: no video fixture available; scene setup/model behavior were not reached. [Dashboard](https://www.testsprite.com/dashboard-v3/o/28a80924-c39d-5b00-844c-74372658d763/projects/c0d461ac-6a7e-475c-bdfd-b773ecc52513/test-cases/106ef885-9060-47d3-8d22-fe723f5ad006); [pinned steps](./testsprite/9fd0635a-079c-4331-b277-7de40b918cdd-steps.json). |

The V3 commands used `--local 5188 --local-host 127.0.0.1 --wait --output json`. The first pair ran with the operator-qualified model configured on API port 8789; the missing-model run used a separately restarted API with both YOLO environment variables unset. The CLI's project/test commands do not expose file-fixture upload; TestSprite documents its project-level Files & Fixtures feature in the portal, but no browser surface was available in this session. TestSprite withheld downloadable failure bundles after temporary local environments were removed; the pinned step records above preserve the sanitized step evidence. Attach the rights-cleared video under project Files & Fixtures and rerun the existing cases before treating them as end-to-end TestSprite validation.
