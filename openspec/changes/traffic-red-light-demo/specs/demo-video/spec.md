## ADDED Requirements

### Requirement: Qualify a generated traffic demonstration

<a id="us-01"></a>
US-01: As a demo evaluator, I want a generated video with known events so that I can compare expected and inferred outcomes.

The project SHALL provide a labeled synthetic fixed-camera video with one visible associated signal, one car crossing in red, one crossing in green and one stopping correctly, qualified for visual continuity and actual YOLO car detection.

Linear: [PER-86](https://linear.app/matias-personal/issue/PER-86/generate-a-verifiable-traffic-demonstration-video).

The PER-103 asset qualification gate is story-specific: use a documented pretrained COCO YOLO checkpoint with confidence >= 0.25; detect the target car in both annotated boundary frames of each red- and green-crossing event; and detect the stopped target car in >= 80% of decoded frames from 3.0 through 7.0 seconds. This gate qualifies this reference sample only and is not a product-wide accuracy target. Record checkpoint/version/hash, runtime, device, input size, class/confidence filters, per-event results, and limitations. Keep inference output separate from unchanged ground truth.

Linear: [PER-103](https://linear.app/matias-personal/issue/PER-103/improve-the-per-86-demo-sample-for-yolo-car-detectability).

#### Scenario: Qualify the reference asset
- **WHEN** the generated video is proposed for acceptance
- **THEN** the evaluator checks vehicle, camera and signal continuity, documents expected event timestamps and records a real YOLO usability run

#### Scenario: Keep annotations independent
- **WHEN** the application analyzes the demo video
- **THEN** it infers vehicles and signal state from pixels without reading expected-event annotations, and keeps the synthetic label and ground truth separate

#### Scenario: Reject unsuitable footage
- **WHEN** visual discontinuities, unreadable signal or unusable car detections prevent evaluation
- **THEN** the asset remains unqualified with recorded reasons and is revised before use as acceptance evidence

#### Scenario: Qualify car detectability for the reference sample
- **WHEN** a pretrained COCO YOLO checkpoint is run on every decoded video frame at confidence >= 0.25
- **THEN** it detects the target car in both annotated boundary frames for red and green crossings and detects the stopped car in >= 80% of frames from 3.0 through 7.0 seconds, with reproducible model/runtime/configuration evidence recorded separately from ground truth
