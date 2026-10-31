# PER-107 post-merge functional QA

- **Merged commit:** `b13350a08aa61647e76dbfdae006fae4f6367393`.
- **Reviewed tree:** merged commit and reviewed PR head `fa8e52940831ecb0a0e27d4b89ff358b955cfe45` both resolve to tree `2d5649782b39cf8e5c1f54c1c90395b6c2364948`.
- **Worktree:** `.worktrees/show-analysis-progress-provenance`, checked out at reviewed head `fa8e52940831ecb0a0e27d4b89ff358b955cfe45`.
- **Runtime:** Node 22.23.2, Chromium headless, local API + Vite.
- **Verdict:** PASS for tested post-merge UI behavior; real model inference/accuracy remains NOT VERIFIED.

## Results

| Criterion | Result | Observation |
| --- | --- | --- |
| Missing-model terminal behavior | PASS | Real local API path ended in `Failed · Stage: Analysis failed`, showed actionable `Set YOLO_MODEL_PATH` guidance, and returned no `result` or detection overlay. Provenance showed source not identified, YOLO26, and ByteTrack. |
| Queued/running/terminal phase display | PASS | The browser route harness observed queued → running/preparation → running/car tracking → failed for a distinct run. This verifies presentation and polling, not inference. |
| Error sanitization | PASS | UI-routed failures with `/opt/private/model.pt`, Windows `C:\Users\operator\private\model.pt`, UNC `\\nas01\models\private\model.pt`, and code `toString` displayed only the safe `ANALYSIS_FAILED` code and preparation guidance. Raw paths, `ENOENT`, and prototype sentinel were absent. |
| Distinct run identity and no fabricated result | PASS | Four fresh upload sessions yielded four different IDs: `053eab2c-299c-437b-8662-1a2c4df71806`, `d4fc1dd0-2125-4f48-a376-5b6ded8c26ea`, `ef31b6db-b401-472a-b052-f9ec0c05f8b7`, `2cad1e2d-787b-4458-a0da-9b62fb8cc5ea`. Failure cards contained no result/overlay. |
| Provenance keyboard and 640px layout | PASS | Disclosure opened with Space. At viewport width 640, document width was also 640. |
| Successful, no-track, or indeterminate inference; timeout/restart | NOT VERIFIED | No YOLO model was configured for this review. No accuracy claim is made. |

## Commands and artifacts

The real-API Playwright journey ran with:

```sh
env PATH=/Users/matiasbinagora/.nvm/versions/node/v22.23.2/bin:/opt/homebrew/bin:/usr/bin:/bin \
  PLAYWRIGHT_REPORT_DIR=reports/per107/postmerge-b13350a \
  PER107_EVIDENCE_DIR=reports/per107/postmerge-b13350a \
  npm run test:playwright -- e2e/scene-configuration.spec.ts
```

Result: **2 passed** (5.9s): real API missing-model persistence/provenance and half-size preview geometry alignment. Chromium was initially blocked by sandbox Mach-port permissions; the same command passed when launched outside the sandbox.

The routed UI check used `node /private/tmp/per107-postmerge-b13350.mjs` against API port 8792 and Vite port 5192. It used real uploads/configuration and intercepted only analysis-run responses. The harness and its `revalidation-artifacts/` output were temporary and are not retained in this PR. Persisted evidence here is `playwright-results.json`, `analysis-run-failure-and-provenance.png`, `revalidation-mobile.png`, and `sanitizer-boundary-mobile.png`.

No product code or Linear state changed. TestSprite was not run. Existing root-level QA artifacts were left untouched.
