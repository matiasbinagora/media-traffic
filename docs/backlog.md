# Media Traffic Backlog

The nine initial MVP stories were approved for specification and backlog preparation
on 2026-10-20. All issues are written in English and were created in the Personal
team's Media Traffic project, in Backlog. Human assignees remain unassigned.
Accountable agent roles and evidence requirements are recorded in each issue.

Project: https://linear.app/matias-personal/project/media-traffic-c8f955049a38/overview

| Story | Linear issue | Blocked by | OpenSpec delta |
| --- | --- | --- | --- |
| US-01 | [PER-86 — Generate a verifiable traffic demonstration video](https://linear.app/matias-personal/issue/PER-86/generate-a-verifiable-traffic-demonstration-video) | None | `openspec/changes/traffic-red-light-demo/specs/demo-video/spec.md` |
| US-02 | [PER-87 — Upload and play a traffic video](https://linear.app/matias-personal/issue/PER-87/upload-and-play-a-traffic-video) | None | `openspec/changes/traffic-red-light-demo/specs/video-upload/spec.md` |
| US-03 | [PER-88 — Configure the stop line, movement, and traffic signal](https://linear.app/matias-personal/issue/PER-88/configure-the-stop-line-movement-and-traffic-signal) | PER-87 | `openspec/changes/traffic-red-light-demo/specs/scene-configuration/spec.md` |
| US-04 | [PER-89 — Detect cars and preserve their trajectories with YOLO](https://linear.app/matias-personal/issue/PER-89/detect-cars-and-preserve-their-trajectories-with-yolo) | PER-88 | `openspec/changes/traffic-red-light-demo/specs/traffic-analysis/spec.md` |
| US-05 | [PER-90 — Recognize the associated traffic signal over time](https://linear.app/matias-personal/issue/PER-90/recognize-the-associated-traffic-signal-over-time) | PER-88 | `openspec/changes/traffic-red-light-demo/specs/traffic-analysis/spec.md` |
| US-06 | [PER-91 — Identify candidate red-light crossing events](https://linear.app/matias-personal/issue/PER-91/identify-candidate-red-light-crossing-events) | PER-89, PER-90 | `openspec/changes/traffic-red-light-demo/specs/traffic-analysis/spec.md` |
| US-07 | [PER-92 — Review crossing candidates with synchronized evidence](https://linear.app/matias-personal/issue/PER-92/review-crossing-candidates-with-synchronized-evidence) | PER-91 | `openspec/changes/traffic-red-light-demo/specs/event-review/spec.md` |
| US-08 | [PER-93 — Show truthful analysis progress, failures, and provenance](https://linear.app/matias-personal/issue/PER-93/show-truthful-analysis-progress-failures-and-provenance) | PER-87 | `openspec/changes/traffic-red-light-demo/specs/processing-provenance/spec.md` |
| US-09 | [PER-94 — Validate the full traffic analysis experience and detection rules](https://linear.app/matias-personal/issue/PER-94/validate-the-full-traffic-analysis-experience-and-detection-rules) | PER-86, PER-87, PER-88, PER-89, PER-90, PER-91, PER-92, PER-93 | `openspec/changes/traffic-red-light-demo/specs/acceptance-validation/spec.md` |

These links establish traceability, not implementation completion. The generated
video, application, TestSprite project, functional suite, and real inference
evaluation are still pending. All implementation tasks remain unchecked in
`openspec/changes/traffic-red-light-demo/tasks.md`.

The project overview is maintained in Linear. Proposed architecture and unresolved
implementation gates are recorded in the OpenSpec design. Repository files are
local working artifacts until committed and pushed separately.
