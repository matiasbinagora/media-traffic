# PER-90 Post-Merge Functional QA

**Verdict: PASS for the synthetic demonstrator acceptance on merged `main` `87b8393ebb5d83cf1af4cbeee7921763668cacb5`.** This is not a general traffic-camera accuracy claim.

## Exact runtime

Backend files are unchanged from the independently tested PR #8 code head `36dc5fb0aafe8c147527ed865f27870e97703c7b` (`git diff --name-status 36dc5fb0aafe8c147527ed865f27870e97703c7b HEAD -- server` returned no changes). The qualified source `example/demo-traffic-video/source.mp4` and checkpoint were available. Runtime used Python 3.12 with OpenCV and Ultralytics from `/private/tmp/per86-yolo-check/bin/python`, and `yolo26n.pt` with SHA-256 `9b09cc8bf347f0fc8a5f7657480587f25db09b34bf33b0652110fb03a8ad4fef` on CPU.

Command to start the isolated API:

```sh
PATH=/Users/matiasbinagora/.nvm/versions/node/v22.23.2/bin:$PATH \
YOLO_MODEL_PATH=/private/tmp/per86-yolo-check/yolo26n.pt \
YOLO_PYTHON_PATH=/private/tmp/per86-yolo-check/bin/python \
LOCAL_DATA_DIR=.local-data/per90-postmerge PORT=18792 npm run server
```

Uploaded the source with `curl -sS -F 'video=@example/demo-traffic-video/source.mp4;type=video/mp4' http://127.0.0.1:18792/api/videos`, saved configuration at `POST /api/videos/898aa933-ad53-4164-a222-69f6f659629e/configurations`, then started and polled `POST`/`GET /api/videos/898aa933-ad53-4164-a222-69f6f659629e/analysis-runs`.

Completed live run `9de3b42d-f583-4452-b0c2-382e470d8931` returned schema v2 for 300 sampled frames, retained 472 timestamped car observations across three ByteTrack IDs, and produced 300 signal observations from the saved signal ROI `{x:0.155,y:0.04,width:0.055,height:0.19}` in the uploaded original. The run retained three ByteTrack IDs: ID 1 had 76 observations from 0.000–2.500 s, ID 2 had 284 from 0.533–9.967 s, and ID 3 had 112 from 3.600–7.300 s. No observation gaps occurred in this clip. The separate [PER-89 car-tracking qualification](../per89/qualification.md) records two simultaneous tracks in 172 frames; [`server/traffic-analysis.test.ts`](../../server/traffic-analysis.test.ts) covers concurrent identities and explicit gaps without interpolated boxes.

The signal timeline reported green `[0,61)`, yellow `[61,91)`, red `[91,210)`, and green `[210,300)`, each stable interval retaining three supporting frames. Every one of the 300 frame labels matched the independent [synthetic ground truth](../../example/demo-traffic-video/ground-truth.json) after mapping its `amber` label to the product's `yellow` label. Counts were green 151, yellow 30, red 119; boundary checks at frames 60, 61, 90, 91, 209, and 210 matched.

Annotations were read only after the inference completed. The inference API received the uploaded source and saved configuration; no annotation path was passed to the inference adapter. Provenance identified `configured-region-hsv`, the YOLO26n checkpoint, CPU, and `requiredConsecutiveFrames: 3`.

## Acceptance results and limits

| PER-90 criterion | Result | Runtime evidence |
| --- | --- | --- |
| YOLO car tracking retains timestamped IDs and exposes gaps | **PASS for the qualified synthetic sample and deterministic contract cases.** The post-merge run retained 3 timestamped ByteTrack tracks; no gap occurred in that sample. Separate qualification observed 2 simultaneous tracks in 172 frames, and deterministic tests cover missing-frame gaps without invented boxes. | [`postmerge/run-result.json`](postmerge/run-result.json); [PER-89 qualification](../per89/qualification.md); [`server/traffic-analysis.test.ts`](../../server/traffic-analysis.test.ts). |
| Configured ROI yields timestamped red/yellow/green/unknown observations | **PASS for the qualified synthetic sample and controlled cases.** The new live run yielded all readable phases with 300/300 frame agreement. | [`postmerge/run-result.json`](postmerge/run-result.json); independent [ground-truth](../../example/demo-traffic-video/ground-truth.json) comparison performed after inference. |
| Display state and temporal context alongside playback | **PASS (UI behavior).** | [PER-104 post-merge QA](../per104/postmerge-qa.md): real browser video play/pause/seeks, four rendered states, offset, and mobile viewport. Timeline data for this UI journey was deterministic, so this criterion does not establish inference accuracy. |
| Unknown for unreadable/missing/ambiguous/too-small/unstable evidence | **PASS for controlled synthetic video probes.** Off-signal ROI: 300/300 `no_readable_signal`; undersized ROI: 300/300 `signal_region_too_small`; competing colors: 30/30 `ambiguous_signal`; one-frame flash: `transition_not_stable`; fully black/occluded interval: 10 frames `no_readable_signal`. | QA captured run IDs: `ecb79113-1956-46ce-a1b2-a2ddcc1cd4d5`, `615fa113-981c-489e-8dd3-1bdda436512b`, `7ebda411-c200-4027-be82-6e6df6c72eb3`, `5ad66bd8-d817-4155-ac30-63ee770bcf45`, `e482cfff-f092-43a9-a99a-2cf49df4b530`. Their temporary local-data outputs were not retained in this report. |
| Stability rule and supporting transition observations | **PASS.** | Live run reports three consecutive decoded frames and support indices for each stable phase. `reports/per90/manual-qa-pr8.md` also records the short-flash negative case. |
| Reference annotations evaluation-only; no generic YOLO traffic-light class | **PASS for this implementation path.** | The live run used the configured HSV ROI, while YOLO provenance filters cars (`class 2`). Annotations were compared only after inference. API response and implementation docs record the method. |

Focused backend checks passed: `PATH=/Users/matiasbinagora/.nvm/versions/node/v22.23.2/bin:$PATH node --import tsx --test server/signal-analysis.test.ts` (**6/6**) and `PYTHONPATH=. /private/tmp/per86-yolo-check/bin/python -m unittest server.inference.test_signal_observation` (**4/4**). The tracking normalization/gap regression suite is `server/traffic-analysis.test.ts`; the independent PER-89 qualification report records its runtime summary. The upload response, saved configuration, run-start response, and exact completed run result are retained under [`postmerge/`](postmerge/).

**Limits:** the video and controlled probes are synthetic. The black interval is a controlled fully unreadable signal region; natural camera occlusion, diverse real-world footage, and a general accuracy threshold were not evaluated. The single-sample 300/300 match must not be extrapolated into a broad model accuracy claim. TestSprite uploads were not used under the user's paid-plan limitation. No source code or Linear status was changed by QA.
