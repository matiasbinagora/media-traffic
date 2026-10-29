# PER-93 Backend Evidence

Implementation evidence for OpenSpec task 7.1. This is backend contract evidence; it does not certify the browser presentation or traffic-detection accuracy.

## Behavior verified

- Persisted analysis records expose queued/running/completed/failed status and phase changes for media inspection, preparation, car tracking, signal analysis and result generation.
- Failure messages use stable codes and sanitized, actionable text; private paths and raw runtime diagnostics are not returned.
- Only a source SHA-256 matching the checked-in demo manifest is labeled `manifest-verified`; other sources remain `not-identified`.
- Runs are rejected when the playable preview is missing. A run cannot stay completed when terminal result persistence fails.
- Restart recovery, inference timeout, source integrity, output validation, distinct run IDs and no fixture substitution have regression coverage.

## Checks

- `npm test`: PASS — 48 Node tests, 4 Python tests and 28 Vitest tests.
- `npm run typecheck:server`: PASS.
- `npm run typecheck:frontend`: PASS (API type compatibility).
- `npm run build`: PASS.
- `npm run spec:validate`: PASS — 2/2 items.
- `git diff --check`: PASS.
- TestSprite: NOT RUN — this change adds backend API behavior and does not add a separate broad browser journey. Functional QA and any appropriate browser journey remain independent review gates.

## Limits

The analysis integration tests use deterministic runner output to exercise persistence and failure contracts. This change was not validated with a fresh YOLO inference execution, and it makes no model-accuracy claim. Frontend phase presentation is outside this backend handoff.
