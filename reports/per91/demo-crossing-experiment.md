# PER-91 Synthetic Crossing Experiment

## Evidence and method

This is a replay of the retained real inference result at [`reports/per90/postmerge/run-result.json`](../per90/postmerge/run-result.json), not a new inference run. The replay reconstructs source-frame detections from the persisted ByteTrack observations, uses the persisted signal timeline, and applies a diagonal stop-line configuration measured from the decoded source image. Ground truth was read only after assessment to compare the outcome. No annotation was provided to inference or the assessment function.

The retained PER-90 configuration has a horizontal stop line and does not match the demo's diagonal stop stripe. For this experiment only, the source-image centerline was sampled near `(500,652)`, `(1000,621)`, `(1200,607)`, `(1274,602)`, and `(1600,584)` in 1920×1080 pixels. The finite test segment used normalized endpoints `{x: 500/1920, y: 652/1080}` to `{x: 1600/1920, y: 584/1080}` with `right-to-left` as the configured direction. This experiment geometry is not persisted in the original run.

## Result

The replay produced one red candidate for track `3` at `6.400000 s`, bracketed by source frames `192–193`. The independent annotation records the red-car crossing at frames `178–179`, `5.933–5.967 s`. The replay candidate is approximately `433 ms` later than the annotation midpoint (`5.950 s`), outside the approved one-frame tolerance of `33.3 ms`.

The replay also produced a green `not_candidate` for track `1` and a green `not_candidate` for track `2`; the stopped-car control did not produce a candidate. Those results do not offset the red-event timing miss. The 1/1 red-event acceptance measure is **not passed** by this replay.

## Limits and handoff

This result uses actual saved detector/tracker/signal observations, but the diagonal segment was measured for the replay because the retained run has no saved configuration matching that stripe. It is therefore a reproducible warning about the configured box-edge midpoint and the demo annotation, not a qualification claim for a production configuration. The independent reviewer and manual QA should decide whether this is an implementation defect or whether the approved box-based reference-point rule cannot satisfy the current synthetic annotation. Do not mark the demo gate passed, broaden the accuracy claim, or change the approved tolerance/reference point based on this experiment.

The approved future precision/recall and p95 latency objectives were not measured here. TestSprite was not run for this backend rule implementation.
