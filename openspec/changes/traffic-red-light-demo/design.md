# Design

Linear issue IDs and URLs: see [proposal.md — Linear Traceability](proposal.md#linear-traceability); each requirement also links its own issue.

## Context

See proposal.md for the motivation and delta specs for behavior. This repository contains tooling and planning artifacts only. The sibling `../media-ads/package.json` uses React/Vite/TypeScript, a Node server and Vitest; its video workflow is the reference, not existing Media Traffic implementation. This change prepares implementation and does not deploy or implement a product.

## Goals / Non-Goals

Goals: preserve temporal evidence, reproducible analysis, honest uncertainty and independent review for one configured movement. Keep model output, synthetic ground truth and human decisions distinct.

Non-goals: legal adjudication, traffic enforcement, live feeds, plates, accounts, public hosting and multiple signals/movements in one run.

## Decisions

1. **MVP web and media stack:** use React, Vite, and TypeScript for the browser application; a Node.js/TypeScript server for uploads and job orchestration; and FFmpeg/FFprobe for media inspection and a browser-playable derivative. This is grounded in `../media-ads`, whose package and scripts use this division of responsibilities, but none of its code is imported. Accept MP4, MOV, and WebM inputs with a configurable upload cap defaulting to 200 MB. Preserve the uploaded source as the immutable input for any later inference; use the derivative for browser playback and keep timestamps mapped to the source. This decision does not select an inference runtime or model, promise a maximum duration, or assert a performance target. Measure and report actual behavior on the available hardware.
2. **Inference readiness is a separate gate:** before implementing US-04 or US-05, record the selected YOLO runtime and weights, verify distribution and weights licenses for the intended use, and qualify the chosen runtime on the available inference hardware. Keep this gate independent from the upload scaffold so upload work can proceed without prematurely selecting a model. The actual model and hardware qualification must use the source video and retain real inference evidence; synthetic annotations are not inference inputs.
3. **Temporal contract:** frame presentation timestamps share the source video's timebase; each observation retains run/track ID, timestamp, frame dimensions, box, confidence and observed/lost state. Signal observations carry timestamp, red/yellow/green/unknown and supporting confidence. Keep gaps explicit. A single representative box per track cannot prove crossing; fixed 1fps sampling is unsuitable unless qualification proves event resolution.
4. **Geometry proposal:** normalized coordinates store stop-line endpoints, allowed direction and associated signal ROI. Use a documented vehicle reference point and signed line-side changes, limited to the segment and allowed direction. Qualify hysteresis, maximum interpolation gap and transition timing tolerance with fixtures before enabling classification. Alternative region-only occupancy cannot establish direction or crossing time.
5. **Conservative event rule:** issue one candidate for each supported track/line crossing during observed red; ignore green crossings and stopped cars. Mark ambiguous crossing/signal timing or lost identity as indeterminate. Yellow alone cannot produce a red candidate. Hysteresis prevents oscillating duplicate events; any track-ID-switch handling must remain conservative and observable. Store event reason, time interval, vehicle ID and source observation references.
6. **Job/result separation:** persist explicit queued/running/completed/failed stages and immutable run configuration. Re-runs create new provenance records; changes in geometry do not mutate old results. Never convert failure to a successful fixture result. Store source identity, model/version/checksum, tracking parameters, sampling/timebase and signal/crossing settings. The playable derivative is not an inference source.
7. **Evidence and review:** replay before/after the crossing with synchronized boxes, trajectory, line and signal; preserve machine verdict and store reviewer confirmed/dismissed/indeterminate separately. Synthetic labels are visibly identified and never consumed as inference inputs.
8. **Validation layers:** deterministic timing/geometry fixtures test rules; TestSprite covers upload, configuration, processing/error and review journeys; actual YOLO and signal inference run against independently annotated demo video. Report candidate-level false positives/misses plus timing/localization and identity problems. Functional passing status alone does not certify model quality.

## Risks / Trade-offs

- [Generated-video discontinuity or invisible signal] → qualify continuity and real detector usability before accepting the asset; regenerate if unsuitable.
- [Occlusion, ID switches, signal transitions] → preserve gaps, uncertainty and evidence rather than force a red verdict.
- [Model and code licensing] → review selected YOLO distribution/weights and reuse licenses before implementation distribution.
- [Oversized files or slow conversion] → enforce the configurable 200 MB default cap, expose failures, and report measured behavior without promising a performance target.
- [Unlicensed or hardware-incompatible inference dependencies] → resolve the separate model/weights license and hardware qualification gate before US-04/05 implementation.
- [Overfitting one synthetic clip] → retain deterministic edge cases and disclose that the demo does not establish real-road generalization.

## Delivery and Rollback

Implement in dependency order from tasks.md using repository-local worktrees and scoped branches. Start with local execution and documented setup; deployment is separate authorization. Keep source media and versioned run records distinct from derived artifacts so a failed pipeline revision can be disabled and re-run with the previous version. No existing application/data requires migration now.

## Acceptance Decisions Before Final Validation

The MVP input formats and configurable 200 MB default upload cap are selected. Before final acceptance, document any duration limit, detector/weights/hardware, numeric timing/confidence/gap settings, evidence context duration, and agreed accuracy/latency thresholds. No performance target is currently asserted. These are tracked qualification tasks, not implied promises. Changes to the approved single-movement scope require user review.
