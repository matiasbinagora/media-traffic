# PER-104 Browser Evidence

The focused Chromium journey passed on the full application at desktop (1280 px) and mobile (390 px) viewports. It creates and saves a valid scene configuration through the UI, starts an analysis with a deterministic API response, and drives the real browser video element using the rights-cleared MP4 fixture.

The preview test route implements the production preview endpoint's byte-range behavior (`200`, `206`, and `416` with range headers). The test confirms a seekable `0–0.6s` media range, actual play advancement, pause stability, keyboard seek from `0.00s` to `0.30s`, and pointer seek to `0.45s`. The API fixture uses a 12-second source offset: these positions show the unknown interval at source time `12.30s` and green at `12.45s`. It also verifies the timeline remains within a 390 px viewport.

Run it with:

```sh
PLAYWRIGHT_REPORT_DIR=reports/per104/runtime-validation npm run test:playwright -- e2e/per104-signal-timeline.spec.ts
```

Evidence: [desktop screenshot](signal-timeline-desktop.png), [mobile screenshot](signal-timeline-mobile.png), and [video seek event log](seek-events.json). The analysis response is deterministic UI test data; this verifies playback synchronization, not signal-inference accuracy.
