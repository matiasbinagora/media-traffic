# PER-88 Frontend Verification

## Scope and evidence

This frontend slice adds an editor for one movement's vehicle region, stop-line segment, crossing direction, and explicitly associated signal region. Geometry is stored in normalized source-frame coordinates; the editor maps it into the centered `object-fit: contain` playback frame and remeasures after player resize. Invalid fields are named and prevent save/run-record actions. Keyboard drawing is available by focusing the editor, moving its cursor with arrow keys, and pressing Enter twice.

Valid edits are saved through `POST /api/videos/:videoId/configurations`. Creating an analysis run record uses `POST /api/videos/:videoId/analysis-runs` and reads it back through the detail GET route. The UI retains run IDs in browser storage and reloads their immutable snapshots after a page refresh. Since the backend records provenance only, the UI calls the action “Create analysis run record” and states that no queue or inference was started. The backend exposes no configuration-list or run-list route; previously saved run snapshots can be restored only for IDs recorded by this browser.

## Verification

- `npm test` — passed: 9 backend tests and 13 frontend tests.
- `npm run build` — passed, including frontend typecheck.
- `npm run spec:validate` — passed: 2 OpenSpec items validated.
- `npm run test:playwright -- e2e/scene-configuration.spec.ts` — passed: 2 Chromium tests. The live API journey used the real upload, configuration POST, run-record POST/GET, invalid-geometry 422 response, duplicate-ID 409 response, and page reload. It drew/corrected geometry and verified that the first run's original `top-to-bottom` snapshot remained intact after a second `bottom-to-top` configuration and run were created. The second journey used a deterministic response with 640×480 source and 320×240 derivative, then verified normalized geometry during letterboxing and saving.
- `npm run test:backend` — passed: 9 tests.
- `npm run typecheck:server` — passed.
- `git diff --check` — passed.
- `testsprite test run --all --project c0d461ac-6a7e-475c-bdfd-b773ecc52513 --local 5191 --local-host 127.0.0.1 --wait --timeout 600 --output json` — 1 passed, 5 blocked across the project's existing upload-only tests. None covers PER-88 scene configuration. TestSprite's failure artifact was unavailable because it withheld the stored script after its temporary local environment was edited/deleted; this does not replace the passing focused Playwright/API validation.

Visual evidence: [revalidation-mobile.png](./revalidation-mobile.png), captured at 640×900 after creating two run records and reloading the page. The fixture contains no traffic imagery or inference ground truth. No traffic-analysis or performance metric is claimed. The upload-only TestSprite run's dashboard is [here](https://www.testsprite.com/dashboard-v3/o/28a80924-c39d-5b00-844c-74372658d763/projects/c0d461ac-6a7e-475c-bdfd-b773ecc52513).
