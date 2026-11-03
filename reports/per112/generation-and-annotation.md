# PER-112: Compatible Synthetic Demo and Independent Annotation

## Asset and provenance

The regenerated synthetic clip is `example/demo-traffic-video/source.mp4`. It is H.264, 1920×1080, 30 fps, 10.000 seconds, and 300 decoded frames. Its SHA-256 is `981154c80389850d83d8621b43ca638d38737d2179ce1734efac60f7b8267ab3`. HyperFrames composition source: `video/demo-traffic/index.html`; requested package version: `0.8.206`.

The source composition uses a fixed intersection view, configured diagonal stop stripe `(500,652)–(1600,584)`, visible signal phases, a moving gold control during green, a stationary blue stop control during red, and a red vehicle crossing during red. The vehicle path is oriented uphill so the leading edge for bottom-to-top travel is observable near the configured stripe.

## Independent annotations

Annotations were manually reviewed from decoded frames before the final qualification inference. A blind manual source review (without access to ground truth or inference results) corrected the initial signal boundary metadata and set a conservative bracket for the rotated red vehicle; these final annotations were frozen before the final run. No detector output, model boxes, or inference metrics were used to choose labels. The final ground-truth file is `example/demo-traffic-video/ground-truth.json` (SHA-256 `de3f821a37a99b8e6d0e2a3e0963a2d43c37597b90b1943cfaa8c2c569cad2ed`). The reference is the midpoint of the axis-aligned vehicle box's leading edge for `bottom-to-top`; red signal frames are 90–209.

- **Red crossing:** conservative source-only bracket from frame 177 (5.900 s, upstream or at the line) to frame 179 (5.967 s, downstream); frame 178 is at or near the stripe. Both bracket frames show red. Because the sprite is rotated almost vertically, the blind reviewer did not claim a more exact single-frame visual time. The bracket midpoint is 5.9333 s.
- **Green control:** manually bracketed between frames 27 and 33 (0.900–1.100 s); both show green. It is a negative control for red-event emission, not a timing-accuracy target.
- **Correct stop:** the blue vehicle remains upstream of the line during the red interval [3, 7) s.

Frame evidence: [red crossing frames 178–179](evidence/red-crossing-frames-178-179.png), [context frames 177–178](evidence/red-crossing-context-177-178.png), [green control frames 27 and 33](evidence/green-control-frames-27-33.png), and the [final HyperFrames contact sheets](evidence/hyperframes-final-contact-sheet-1.jpg) ([continuation](evidence/hyperframes-final-contact-sheet-2.jpg)). The full clip was also inspected with FFprobe metadata and decoded frame samples.

## HyperFrames validation

- `hyperframes lint`: passed, 0 errors and 0 warnings.
- `hyperframes check --json`: passed, 0 errors and 0 warnings (audio-less visual composition reported informationally).
- Persisted check result: [HyperFrames check JSON](evidence/hyperframes-check.json), check ID `89bf28df-c08e-4344-80e4-0e8ba3f26a11`.
- Preview server returned HTTP 200 at `http://localhost:3014/#project/demo-traffic`.
- `ffprobe`: H.264, 1920×1080, 30/1 fps, 300 frames, 10 seconds.

## Qualification status and limits

The single-clip YOLO qualification gate **passes**. The final real YOLO/ByteTrack output and the repository's actual signal and crossing-analysis functions produce one red candidate on track 3 at 5.945557 s, 12.22 ms from the independent annotation midpoint 5.933333 s. The green crossing is classified `not_candidate / signal_not_red`; the blue stop car produces no crossing assessment during red. Its later crossing after green returns is also `not_candidate / signal_not_red`. The exact checkpoint, environment, frame confidence values, signal intervals, command, and hashes are in [`qualification.md`](qualification.md), with raw tracker output and assessments in `yolo-tracking.json` and `crossing-assessments.json`.

The configured signal crop was corrected after a preliminary run showed unknown signal output: the initial crop omitted the red lamp. A subsequent blind source review also corrected boundary annotations and conservatively bracketed the red event. The final crop covers all three visible lamps; final pixel observations produce stable green/yellow/red/green intervals matching the independent timeline. The final qualification inference was rerun after the final ground-truth hash was frozen. The result is limited to this one synthetic clip; it does not establish broad accuracy or p95 latency.
