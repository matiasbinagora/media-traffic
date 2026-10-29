# PER-107 Frontend Validation

## Scope

Branch `feature/show-analysis-progress-provenance`, based on `origin/main` at `8a130d64e68cf18e0fda58c57578129a6213be5b`.

The interface presents only the API-reported run status and phase, sanitizes accidental local paths/runtime diagnostics in failures, and formats source, model, tracker, runtime, sampling, threshold, and scene-configuration provenance. Successful results with no observed vehicles and uncertain signal intervals remain visible as analysis outcomes, separate from failed jobs.

## Checks

- `npm run test:frontend`: 31 tests passed across 5 files.
- `npm run typecheck:frontend`: passed.
- `npm run build`: passed.
- `npm run spec:validate`: 2 OpenSpec items passed; task 7.2 remains unchecked pending independent QA.
- `git diff --check`: passed.
- `PLAYWRIGHT_REPORT_DIR=reports/per107 npm run test:playwright -- e2e/scene-configuration.spec.ts`: 2 Chromium journeys passed. The first exercised configuration, a real API run that failed because the qualified YOLO model was not configured, and UI assertions for the terminal stage, actionable sanitized error, and provenance. The second checked the responsive scene editor at 640 × 900; the first journey used 1024 × 900.

## Evidence and limits

- `analysis-run-failure-and-provenance.png` captures the browser run record with provenance expanded.
- `revalidation-mobile.png` is the existing 640-pixel responsive layout capture.
- Vitest uses deterministic API-run records to check queued → preparation → car-tracking polling and completed no-track/indeterminate outcomes. These fixtures do not validate inference quality.
- The browser run intentionally stopped at the actual missing-model failure. Successful real YOLO inference, real-camera accuracy, and TestSprite are not verified here.
- All checks, including both Chromium journeys, ran under the repository-pinned Node `v22.23.2` from `.nvmrc`.
