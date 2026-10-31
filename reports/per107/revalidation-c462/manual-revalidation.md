# PER-107 functional revalidation

- **Build under review:** PR #14, `c462ea2322ac9f4a4f7b68de371f2ad3d15ea4dd` (Node 22.23.2).
- **Verdict:** PASS for the tested UI failure/provenance and mobile criteria. Successful model inference remains NOT VERIFIED.

## Checks and evidence

| Criterion | Result | Evidence |
| --- | --- | --- |
| Actual missing-model journey | PASS | `npm run test:playwright -- e2e/scene-configuration.spec.ts` passed 2/2. The browser used the real API; the absent YOLO model produced a preparation failure, actionable setup guidance, and no result/overlay. |
| Visible lifecycle phases | PASS | Browser route interception returned queued, running/preparation, running/car tracking, then failed; each phase appeared in the run card. This checks presentation/polling, not backend inference. |
| Sanitized error boundary | PASS | Routed API responses containing `/opt/private/model.pt`, a Windows `C:\Users\operator\private\model.pt`, UNC `\\nas01\models\private\model.pt`, and prototype key code `toString`. Each distinct run showed only `ANALYSIS_FAILED` and safe preparation guidance; none exposed the path, `ENOENT`, or prototype sentinel. |
| Distinct runs and truthful failure | PASS | Four fresh uploaded-video sessions produced four distinct run IDs. Failed runs had no traffic-analysis overlay/result. |
| Provenance and unknown source | PASS | Each simulated failed run classified the source as not identified and exposed YOLO26, ByteTrack, sampling, thresholds, and configuration. Disclosure opened with keyboard Space. |
| 640px layout | PASS | `window.innerWidth=640`, `document.documentElement.scrollWidth=640`; screenshot: `sanitizer-boundary-mobile.png`. |
| Successful detection quality, completed/no-track/indeterminate results, timeout/restart | NOT VERIFIED | No configured model or ground-truth inference run was available. No TestSprite paid file-upload feature was used. |

## Reproduction

The exact browser-suite command was `env PATH=/Users/matiasbinagora/.nvm/versions/node/v22.23.2/bin:/opt/homebrew/bin:/usr/bin:/bin PLAYWRIGHT_REPORT_DIR=reports/per107/revalidation-c462 npm run test:playwright -- e2e/scene-configuration.spec.ts`; it passed 2/2. Result JSON is `playwright-results.json`, with trace output under `revalidation-artifacts/`. The checks covered the real missing-model UI journey and geometry alignment.

For the hostile-payload browser check, the API ran on port 8787 and Vite on 5188, with Node 22.23.2. Command: `node /private/tmp/per107-ui-boundary.mjs`. It drove the actual upload/configuration UI while routing only the analysis-run responses. The script is an ephemeral harness outside the repository. Its mobile screenshot and the separately preserved real-API failure screenshot are in this directory.

The first shared-page harness attempt retained the prior run card, so the four payload checks were rerun in fresh upload sessions; all four then passed with distinct IDs. No product code or Linear state was changed. The two revalidation screenshots are preserved in this directory; top-level screenshots remain outside this evidence bundle.
