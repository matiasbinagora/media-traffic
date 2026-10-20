# PER-88 Frontend Verification

## Scope and evidence

This frontend slice adds an editor for one movement's vehicle region, stop-line segment, crossing direction, and explicitly associated signal region. Geometry is stored in normalized frame coordinates; the editor maps it into the centered `object-fit: contain` video frame and remeasures after player resize. Invalid fields are named and prevent save/analysis actions. Keyboard drawing is available by focusing the editor, moving its cursor with arrow keys, and pressing Enter twice.

The current server has no scene-configuration persistence or analysis endpoint. The application therefore reports scene saving as unavailable and keeps both actions disabled; it does not treat in-memory geometry as a saved snapshot. The editor exposes a `schemaVersion: 1` immutable snapshot callback for the pending backend contract. This branch does not satisfy snapshot persistence or analysis-start acceptance and remains dependent on backend task 3.4 and the later analysis API.

## Verification

- `npm test` — passed: 6 backend tests and 13 frontend tests.
- `npm run build` — passed, including frontend typecheck.
- `npm run spec:validate` — passed: 2 OpenSpec items validated.
- `npm run test:playwright -- e2e/scene-configuration.spec.ts` — passed in Chromium, with Playwright starting the Vite server from this worktree on strict port 5188. The journey used a deterministic API response and a rights-cleared synthetic blue MP4 fixture, with a 1920×1080 source and 960×540 playback derivative. It drew all three marks, selected direction and signal association, then resized the viewport from 1024×900 to 640×900. Assertions confirmed the vehicle region, stop line, and signal region stayed aligned to the contained video frame with letterboxing. It also confirmed Save and Start Analysis remain unavailable until their services exist.
- `git diff --check` — passed.

Visual evidence: [scene-configuration-mobile.png](./scene-configuration-mobile.png), captured at 640×900 after drawing and resizing. The fixture contains no traffic imagery or inference ground truth. No traffic-analysis or performance metric is claimed. TestSprite was not run for this worktree; this browser journey requires a local video file, and deterministic Playwright covers the flow.
