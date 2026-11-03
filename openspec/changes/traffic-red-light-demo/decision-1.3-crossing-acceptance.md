# Decision 1.3: Crossing Geometry and Acceptance

**Approved by the product owner:** 2026-11-02

**Applies to:** US-06 / PER-91, and the later US-09 evaluation
**Status:** Approved rules for the synthetic demonstration; future general-accuracy objective is not a demo gate.

## Implementation rules

- Use the midpoint of the vehicle box's leading edge in the configured direction of travel as the reference point (a box-based front-bumper estimate).
- Test crossing against the configured finite stop-line segment, including its endpoints, with a 1-pixel source-image tolerance. A crossing requires observed movement from the upstream side to the line/downstream side; line contact alone is not sufficient. Interpolate the crossing time between the bracketing source timestamps.
- Both bracketing observations must retain the same track identity and come from adjacent 30-fps source frames, no more than 33.3 ms apart. A missing frame, wider gap, or identity change in the crossing bracket makes the outcome indeterminate.
- Both car detections in that bracket must meet the configured YOLO confidence floor of 0.25. This is the prototype detector setting, not a calibrated probability of violation.
- Require three consecutive frames for a stable signal state. The complete crossing-time bracket must lie in a stable red interval; if it overlaps a transition, yellow, or unknown interval, return indeterminate.

## Acceptance measures

For the current annotated synthetic demonstration, require the one red crossing to produce one candidate (1/1), the green crossing and correct stop to produce no candidates (0 false candidates across the two controls), and the candidate time to be within one source frame (33.3 ms) of the independent annotation.

For a future broader evaluation, use event-level precision and recall targets of at least 95% each across at least 50 annotated positive and 50 annotated negative events from at least five fixed-camera clips. This is an objective for a representative dataset, not a gate for the current synthetic demo and not a claim that current evidence meets it.

For performance, target p95 analysis time of at most 10 seconds on the 10-second, 1920×1080, 30-fps demonstration source, measured over 20 runs on the documented macOS arm64 CPU reference environment. Report model-load time separately from inference and measure the target; do not infer that it has been achieved from existing single-run measurements.

## Evidence and decision support

The current evidence is limited to one synthetic clip: `reports/per89/qualification.md`, `reports/per103/qualification.md`, and `reports/per90/postmerge-qa.md`. It records YOLO confidence floor 0.25, a 30-fps/300-frame source, annotated red-boundary detections at frames 178–179, and approximately 5.26 seconds for a single inference run. It does not establish broad precision/recall or p95 latency.

The human approval controls this decision. JEV's `route-task` assisted specialist routing to backend; it did not evaluate numerical acceptance. A JEV `rank-test-scenarios` call abstained with no recommendation because evidence/confidence was insufficient. No JEV result was treated as approval or validation of these values.
