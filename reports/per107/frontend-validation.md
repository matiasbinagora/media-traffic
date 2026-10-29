# PER-107 Frontend Validation

## Scope

Branch `feature/show-analysis-progress-provenance`, based on `origin/main` at `8a130d64e68cf18e0fda58c57578129a6213be5b`.

The interface presents only the API-reported run status and phase, uses an allowlist of known safe failure messages/codes instead of rendering server-provided diagnostics, and formats source, model, tracker, runtime, sampling, threshold, and scene-configuration provenance. Successful results with no observed vehicles and uncertain signal intervals remain visible as analysis outcomes, separate from failed jobs.

## Checks

- `npm run test:frontend`: 35 tests passed across 5 files.
- `npm run typecheck:frontend`: passed.
- `npm run build`: passed.
- `npm run spec:validate`: 2 OpenSpec items passed; task 7.2 remains unchecked pending independent QA.
- `git diff --check`: passed.
- `PLAYWRIGHT_REPORT_DIR=.local-data/per107-p2-rerun-2 PER107_EVIDENCE_DIR=.local-data/per107-p2-rerun-2 npm run test:playwright -- e2e/scene-configuration.spec.ts`: 2 Chromium journeys passed under Node 22.23.2. The first exercised configuration, a real API run that failed because the qualified YOLO model was not configured, and UI assertions for the terminal stage, actionable safe error, and provenance. The second checked the responsive scene editor at 640 × 900; the first journey used 1024 × 900. Outputs stayed outside the independent QA evidence. An earlier rerun had a geometry assertion mismatch in the second journey; the immediate rerun passed both journeys.
- Focused component regression cases passed for `/opt` paths, Windows drive paths, UNC paths, stderr/ENOENT diagnostics, and unknown error-code redaction.

## Evidence and limits

- `analysis-run-failure-and-provenance.png` captures the browser run record with provenance expanded.
- `revalidation-mobile.png` is the existing 640-pixel responsive layout capture.
- Vitest uses deterministic API-run records to check queued → preparation → car-tracking polling and completed no-track/indeterminate outcomes. These fixtures do not validate inference quality.
- Failure text is selected from a fixed allowlist keyed by known server error codes, with a safe stage-specific fallback; user-controlled server message text and unrecognized error codes are never rendered.
- A single browser rerun reported a geometry assertion mismatch at 640 × 900, while the immediate repeat passed the same journey. Treat that responsive check as having a transient failure pending independent QA confirmation.
- The browser run intentionally stopped at the actual missing-model failure. Successful real YOLO inference, real-camera accuracy, and TestSprite are not verified here.
- All checks, including both Chromium journeys, ran under the repository-pinned Node `v22.23.2` from `.nvmrc`.
