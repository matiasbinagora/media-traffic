# Proposal

## Why

Reviewers need a web demo that makes potential red-light crossings inspectable through actual video analysis. The approved MVP adapts the upload, processing, playback and results journey of `../media-ads` while adding temporal car tracking and signal-aware crossing rules.

## What Changes

- Generate a fixed-camera demonstration with known red crossing, green crossing and correct stop cases, keeping annotations independent of inference.
- Upload and replay video; configure one movement, stop line and associated visible signal.
- Run YOLO car tracking and signal-state inference with timestamps, uncertainty and honest job status.
- Produce deduplicated candidate red-light events with evidence and separate reviewer decisions.
- Validate broad web journeys with TestSprite and evaluate real inference against independent annotations.
- Publish all new stories and requirements in English, with Linear traceability.

## Capabilities

### New Capabilities

- `demo-video`: US-01; create and qualify the synthetic evaluation video.
- `video-upload`: US-02; validate, upload and replay video.
- `scene-configuration`: US-03; configure geometry, direction and signal region.
- `traffic-analysis`: US-04–US-06; track cars, infer signal states and determine crossings.
- `event-review`: US-07; inspect evidence and record human review decisions.
- `processing-provenance`: US-08; expose actual job states, errors and reproducibility metadata.
- `acceptance-validation`: US-09; exercise journeys, rule behavior and real inference quality.

### Modified Capabilities

None. Existing `delivery-workflow` requirements continue to apply.

## Impact

Future work introduces a web interface, asynchronous video-analysis service, media/result storage and YOLO runtime; none are implemented by this planning change. Proposed stack reuse from media-ads is documented in design.md, not claimed as approved. Local pinned OpenSpec, agents-cli and TestSprite remain the tooling entrypoints.

The accountable coordinator is m-traffic-orchestrator; specialist ownership and dependencies appear in tasks.md. Users are demo evaluators and event reviewers. Public hosting, accounts, live feeds, plate recognition, fines, multi-camera and multi-movement analysis are out of scope. Numeric quality thresholds and resource limits must be agreed before final acceptance; reporting measurements alone does not establish acceptance.

## Linear Traceability

- US-01: [PER-86](https://linear.app/matias-personal/issue/PER-86/generate-a-verifiable-traffic-demonstration-video)
- US-02: [PER-87](https://linear.app/matias-personal/issue/PER-87/upload-and-play-a-traffic-video)
- US-03: [PER-88](https://linear.app/matias-personal/issue/PER-88/configure-the-stop-line-movement-and-traffic-signal)
- US-04: [PER-89](https://linear.app/matias-personal/issue/PER-89/detect-cars-and-preserve-their-trajectories-with-yolo)
- US-05: [PER-90](https://linear.app/matias-personal/issue/PER-90/recognize-the-associated-traffic-signal-over-time)
- US-06: [PER-91](https://linear.app/matias-personal/issue/PER-91/identify-candidate-red-light-crossing-events)
- US-07: [PER-92](https://linear.app/matias-personal/issue/PER-92/review-crossing-candidates-with-synchronized-evidence)
- US-08: [PER-93](https://linear.app/matias-personal/issue/PER-93/show-truthful-analysis-progress-failures-and-provenance)
- US-09: [PER-94](https://linear.app/matias-personal/issue/PER-94/validate-the-full-traffic-analysis-experience-and-detection-rules)

All nine issues are in Backlog. Accountable specialist roles are planning ownership; no assignee, implementation dispatch, merge or completion is implied. Dependencies: US-03 follows US-02; US-04 and US-05 follow US-03; US-06 follows both; US-07 follows US-06; US-08 follows US-02; US-09 follows US-01 through US-08.
