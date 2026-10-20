# Design

Linear issue IDs and URLs: see [proposal.md — Linear Traceability](proposal.md#linear-traceability); each requirement also links its own issue.

## Context

See proposal.md for the motivation and delta specs for behavior. This repository contains tooling and planning artifacts only. The sibling `../media-ads/package.json` uses React/Vite/TypeScript, a Node server and Vitest; its video workflow is the reference, not existing Media Traffic implementation. This change prepares implementation and does not deploy or implement a product.

## Goals / Non-Goals

Goals: preserve temporal evidence, reproducible analysis, honest uncertainty and independent review for one configured movement. Keep model output, synthetic ground truth and human decisions distinct.

Non-goals: legal adjudication, traffic enforcement, live feeds, plates, accounts, public hosting and multiple signals/movements in one run.

## Decisions

1. **Proposed stack:** reuse React/Vite/TypeScript for browser playback/configuration, Node for upload/job orchestration, FFmpeg for validated media metadata/evidence, and Python YOLO for car inference. This fits the sibling's separation of concerns without pretending its code is already imported. A single Python web stack is an alternative; confirm the final stack and model/license suitability in task 1.1 before scaffolding.
2. **Temporal contract:** frame presentation timestamps share the video's timebase; each observation retains run/track ID, timestamp, frame dimensions, box, confidence and observed/lost state. Signal observations carry timestamp, red/yellow/green/unknown and supporting confidence. Keep gaps explicit. A single representative box per track cannot prove crossing; fixed 1fps sampling is unsuitable unless qualification proves event resolution.
3. **Geometry proposal:** normalized coordinates store stop-line endpoints, allowed direction and associated signal ROI. Use a documented vehicle reference point and signed line-side changes, limited to the segment and allowed direction. Qualify hysteresis, maximum interpolation gap and transition timing tolerance with fixtures before enabling classification. Alternative region-only occupancy cannot establish direction or crossing time.
4. **Conservative event rule:** issue one candidate for each supported track/line crossing during observed red; ignore green crossings and stopped cars. Mark ambiguous crossing/signal timing or lost identity as indeterminate. Yellow alone cannot produce a red candidate. Hysteresis prevents oscillating duplicate events; any track-ID-switch handling must remain conservative and observable. Store event reason, time interval, vehicle ID and source observation references.
5. **Job/result separation:** persist explicit queued/running/completed/failed stages and immutable run configuration. Re-runs create new provenance records; changes in geometry do not mutate old results. Never convert failure to a successful fixture result. Store source identity, model/version/checksum, tracking parameters, sampling/timebase and signal/crossing settings.
6. **Evidence and review:** replay before/after the crossing with synchronized boxes, trajectory, line and signal; preserve machine verdict and store reviewer confirmed/dismissed/indeterminate separately. Synthetic labels are visibly identified and never consumed as inference inputs.
7. **Validation layers:** deterministic timing/geometry fixtures test rules; TestSprite covers upload, configuration, processing/error and review journeys; actual YOLO and signal inference run against independently annotated demo video. Report candidate-level false positives/misses plus timing/localization and identity problems. Functional passing status alone does not certify model quality.

## Risks / Trade-offs

- [Generated-video discontinuity or invisible signal] → qualify continuity and real detector usability before accepting the asset; regenerate if unsuitable.
- [Occlusion, ID switches, signal transitions] → preserve gaps, uncertainty and evidence rather than force a red verdict.
- [Model and code licensing] → review selected YOLO distribution/weights and reuse licenses before implementation distribution.
- [Inference load and oversized files] → agree limits, measure on recorded hardware and expose failures; do not promise realtime performance.
- [Overfitting one synthetic clip] → retain deterministic edge cases and disclose that the demo does not establish real-road generalization.

## Delivery and Rollback

Implement in dependency order from tasks.md using repository-local worktrees and scoped branches. Start with local execution and documented setup; deployment is separate authorization. Keep source media and versioned run records distinct from derived artifacts so a failed pipeline revision can be disabled and re-run with the previous version. No existing application/data requires migration now.

## Acceptance Decisions Before Final Validation

Document supported formats and file/duration limits, detector/weights/hardware, numeric timing/confidence/gap settings, evidence context duration and acceptable accuracy/latency thresholds before claiming final acceptance. These are tracked qualification tasks, not implied promises. Changes to the approved single-movement scope require user review.
