# Tasks

Linear issue IDs and URLs: see [proposal.md — Linear Traceability](proposal.md#linear-traceability); each requirement also links its own issue.

All checkboxes remain pending until the task has its required implementation and verification evidence. Each section names its accountable specialist; m-traffic-orchestrator coordinates dependencies and independent gates. Story links are recorded in the corresponding delta specs. Implementation branches/worktrees are assigned at handoff under `.worktrees/<task>`; creating a branch does not imply task completion.

## 1. Engineering Readiness

- [x] 1.1 Owner: m-traffic-orchestrator. Record the MVP application stack as React/Vite/TypeScript, a Node.js/TypeScript server, and FFmpeg/FFprobe for inspection and a browser-playable derivative; record MP4, MOV, and WebM inputs and a configurable 200 MB default upload cap. Verify the decision is traceable to the `../media-ads` reference and does not claim a performance target or select YOLO weights.
- [x] 1.2 Owner: m-traffic-backend-developer. Define the versioned source, upload-job, and playback-derivative contracts for US-02 (including `schemaVersion`, source identity/hash, timestamps, and upload/preview substates); verify preview lifecycle examples cover `processing`, `completed`, and `failed` plus actionable validation/conversion failures, and keep the immutable original source as the later inference input. Reserve the separate traffic-analysis job lifecycle (`queued`, `running`, `completed`, `failed`) and its immutable run provenance for task 7.1; do not treat upload/preview completion or derivative processing as traffic analysis.
- [ ] 1.3 Owner: m-traffic-orchestrator. Agree temporal geometry rules, confidence/gap tolerances and quality/latency thresholds with the user before corresponding final acceptance; verify a decision record distinguishes provisional tuning from agreed acceptance criteria (US-06, US-09).
- [x] 1.4 Owner: m-traffic-backend-developer. Selected Ultralytics YOLO26n with its checkpoint/version/hash and real hardware evidence documented in `reports/per89/qualification.md`; the user selected GNU AGPL-3.0 for the public prototype and the canonical license is at repository root. This closes the prototype selection/qualification gate only; broader commercial/private-SaaS/production clearance remains a separate review. Depends on a generated candidate video (2.1).

## 2. Qualified Demonstration Asset — US-01

- [x] 2.1 Owner: m-traffic-orchestrator. Coordinate video generation through the required video workflow and independently annotate red crossing, green crossing and correct stop; verify an asset manifest labels synthetic media and records expected timestamps separately from inference inputs (`demo-video`). Evidence: `reports/per86/candidate-visual-review.md` and `reports/per86/manual-revalidation-pr7-corrected-boundaries-20261028.md`, including corrected phase-boundary and event-frame crops.
- [x] 2.2 Owner: m-traffic-backend-developer. After the inference-readiness gate, qualify camera/vehicle/signal continuity and actual YOLO detectability on the generated asset; verify real inference output, timestamp inspection and a qualification report, revising unusable footage before acceptance. Depends on 1.4. Evidence: `reports/per103/qualification.md`, `reports/per103/yolo-inference.json`, `reports/per86/inference-readiness.md`, and independent PER-86 manual revalidation.

## 3. Upload and Configuration — US-02, US-03

- [x] 3.1 Owner: m-traffic-backend-developer. Implement bounded upload/media validation and playback delivery; verify valid MP4/MOV/WebM uploads, corrupt/unsupported/empty/oversized rejection at the configurable 200 MB default, and interrupted-upload handling with tests and documented limits (`video-upload`). Preserve the uploaded source for inference and keep a playable derivative separate. No performance target is asserted. Depends on 1.1–1.2.
- [x] 3.2 Owner: m-traffic-frontend-developer. Implement upload feedback, preview and error recovery; verify in Chromium that browser behavior distinguishes upload from analysis success, covers successful playback and failure recovery, and document the local run command (`video-upload`). Depends on 3.1.
- [x] 3.3 Owner: m-traffic-frontend-developer. Implement editable line, movement and associated signal-region configuration; verify normalized overlays remain aligned on resize and incomplete configuration blocks analysis (`scene-configuration`). Depends on 3.2. Evidence: merged [PR #2](https://github.com/matiasbinagora/media-traffic/pull/2), `reports/per88/README.md` (Playwright 2/2), and the independent [PER-88 Manual Functional Review](https://linear.app/matias-personal/issue/PER-88/configure-the-stop-line-movement-and-traffic-signal) attached to Linear. Wide 4:3 and narrow viewport captures confirm normalized geometry through letterboxing and resize.
- [x] 3.4 Owner: m-traffic-backend-developer. Validate and snapshot configuration per run; verify invalid geometry is rejected and later edits leave previous run evidence intact, with contract tests and configuration documentation (`scene-configuration`). Depends on 1.2, 3.3. Evidence: merged [PR #2](https://github.com/matiasbinagora/media-traffic/pull/2), `server/scene-configuration.test.ts`, `e2e/scene-configuration.spec.ts`, `docs/scene-configuration-api.md`, and the independent [PER-88 Manual Functional Review](https://linear.app/matias-personal/issue/PER-88/configure-the-stop-line-movement-and-traffic-signal) attached to Linear. Contract and browser/API tests verify invalid geometry rejection and that later edits preserve each run's original configuration snapshot.

## 4. Car Tracking and Signal State — US-04, US-05

- [ ] 4.1 Owner: m-traffic-backend-developer. Implement actual YOLO car tracking with retained timestamped observations; verify simultaneous cars, synchronized IDs and documented gaps using recorded outputs and regression tests (`traffic-analysis`). Depends on 1.1–1.2, 1.4, 2.2, 3.4.
- [ ] 4.2 Owner: m-traffic-backend-developer. Infer the associated red/yellow/green/unknown signal from pixels and expose its timeline; verify readable states, occlusion and transition ambiguity with independent reference observations and tests (`traffic-analysis`). Depends on 1.4, 3.4.
- [ ] 4.3 Owner: m-traffic-frontend-developer. Render synchronized boxes, IDs, trajectories and signal timeline; verify seek/replay alignment and uncertainty visibility against actual temporal outputs (`traffic-analysis`). Depends on 4.1–4.2.

## 5. Crossing Rules — US-06

- [ ] 5.1 Owner: m-traffic-backend-developer. Implement directed segment crossing, red-time association, deduplication and indeterminate reasons; verify deterministic tests for stopped/green/yellow/opposite-direction/outside-segment cars, transition boundaries, gaps, ID ambiguity and jitter (`traffic-analysis`). Depends on 1.3, 4.1–4.2.
- [ ] 5.2 Owner: m-traffic-backend-developer. Attach crossing time, source observations and original configuration to each candidate; verify real demo events can be traced end to end and document reference-point, tolerance and uncertainty rules (`traffic-analysis`). Depends on 5.1.

## 6. Evidence Review — US-07

- [ ] 6.1 Owner: m-traffic-frontend-developer. Implement event selection and contextual replay with trajectory, line and signal evidence; verify before/after context, seeking and clear missing-evidence behavior (`event-review`). Depends on 4.3, 5.2.
- [ ] 6.2 Owner: m-traffic-backend-developer. Persist confirmed/dismissed/indeterminate reviews separately from machine findings; verify save/reload leaves automatic output unchanged and document review semantics (`event-review`). Depends on 5.2.
- [ ] 6.3 Owner: m-traffic-frontend-developer. Add review controls and decision feedback; verify all three decisions survive reload and are visually distinct from automatic findings (`event-review`). Depends on 6.1–6.2.

## 7. Honest Processing and Provenance — US-08

- [ ] 7.1 Owner: m-traffic-backend-developer. Expose asynchronous stages, terminal failures and reproducible immutable run provenance; verify model-loading/media/inference failures cannot yield fixture success and reruns remain distinct (`processing-provenance`). Depends on 1.2, 3.1, 4.1–4.2.
- [ ] 7.2 Owner: m-traffic-frontend-developer. Show actual stages, errors, source labels and model/configuration details; verify loading/error/completed journeys and absence of fabricated detections, documenting limitations (`processing-provenance`). Depends on 7.1.

## 8. Independent Validation and Acceptance — US-09

- [ ] 8.1 Owner: m-traffic-qa-automator. Seed a broad TestSprite suite covering upload validation, configuration, processing/failure and evidence/review with observable assertions; verify actual run IDs, verdicts and artifacts against the executable application (`acceptance-validation`). Depends on 3.2–3.4, 6.3, 7.2.
- [ ] 8.2 Owner: m-traffic-qa-automator. Independently review deterministic rule coverage and run actual inference against untouched annotations; verify reproducible correct/false/missed candidate counts plus timing and identity limitations without substituting TestSprite status for accuracy (`acceptance-validation`). Depends on 2.2, 5.2.
- [ ] 8.3 Owner: m-traffic-orchestrator. Arrange independent technical review by an appropriate code-review role and functional acceptance by m-traffic-qa-manual; verify linked evidence for every scenario and remediation/retest of blockers before requesting closure authorization. Depends on 8.1–8.2 and agreed thresholds from 1.3.
