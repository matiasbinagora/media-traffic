# PER-90 Backend Signal Timeline

## Contract

Completed analysis runs now return `result.signalTimeline` additively under the existing run schema version. The timeline contains frame- and timestamp-aligned raw color observations, half-open state intervals, per-color pixel ratios, an explicit stability rule, rationale for unknown intervals, and the first three supporting frame indices for each stable phase. The saved run configuration's normalized `signalRegion` is passed to the inference adapter and mapped against the uploaded original frame dimensions.

The backend counts saturated red, yellow, and green HSV pixels inside that configured region. It does not read the reference annotations or use a generic YOLO traffic-light class. A state is unknown when color evidence is below 0.5% of the region, multiple colors compete, or the configured region cannot be sampled. Three consecutive decoded frames are required for a stable color interval; shorter color runs remain unknown. Adjacent unknown observations with different causes produce separate intervals. `evidenceScore` retains the leading color-pixel fraction for sampleable crops, including weak or competing evidence; it is zero when the crop is too small to sample and is not a calibrated probability.

## Verification

- `npm test` — passed: 43 Node backend tests, 4 generated-image Python tests, and 24 frontend tests.
- `npm run build` — passed; frontend typecheck and Vite production build.
- `npm run typecheck:server` — passed.
- `npm run spec:validate` — passed: 2 OpenSpec items.
- `python3 -m py_compile server/inference/track-cars.py server/inference/signal_observation.py server/inference/test_signal_observation.py` — passed.
- `git diff --check` — passed.
- `git check-ignore server/inference/__pycache__/track-cars.cpython-314.pyc` — passed; Python bytecode is ignored.
- Backend integration tests exercise a completed run's signal observations, verify the saved configured region is the one passed to recognition, preserve transition evidence, and fail the run when signal timestamps do not match source frames.
- Deterministic tests cover generated BGR image crops, the configured ROI, HSV color thresholds, small crops, unknown-rationale boundaries, missing and competing colors, short transitions, timestamp order, duration bounds, and negative source presentation times.

## Limits and follow-up

Real video inference was **not verified in this environment**: `YOLO_MODEL_PATH` is unset and the default `python3` does not have OpenCV installed. The deterministic backend tests use controlled color ratios and do not establish signal-classification accuracy on the demo asset. Reference annotations remain evaluation-only. TestSprite was not run under the user's paid-upload limitation.

This change exposes an API timeline; it does not render the state beside playback. [PER-104](https://linear.app/matias-personal/issue/PER-104/render-the-inferred-traffic-signal-timeline-alongside-video) owns the frontend acceptance criterion, and PER-90 must remain open until that UI work is independently verified.
