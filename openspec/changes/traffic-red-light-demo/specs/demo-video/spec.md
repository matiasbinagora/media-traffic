## ADDED Requirements

### Requirement: Qualify a generated traffic demonstration

<a id="us-01"></a>
US-01: As a demo evaluator, I want a generated video with known events so that I can compare expected and inferred outcomes.

The project SHALL provide a labeled synthetic fixed-camera video with one visible associated signal, one car crossing in red, one crossing in green and one stopping correctly, qualified for visual continuity and actual YOLO car detection.

Linear: [PER-86](https://linear.app/matias-personal/issue/PER-86/generate-a-verifiable-traffic-demonstration-video).

#### Scenario: Qualify the reference asset
- **WHEN** the generated video is proposed for acceptance
- **THEN** the evaluator checks vehicle, camera and signal continuity, documents expected event timestamps and records a real YOLO usability run

#### Scenario: Keep annotations independent
- **WHEN** the application analyzes the demo video
- **THEN** it infers vehicles and signal state from pixels without reading expected-event annotations, and keeps the synthetic label and ground truth separate

#### Scenario: Reject unsuitable footage
- **WHEN** visual discontinuities, unreadable signal or unusable car detections prevent evaluation
- **THEN** the asset remains unqualified with recorded reasons and is revised before use as acceptance evidence
