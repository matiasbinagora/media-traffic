## ADDED Requirements

### Requirement: Retain temporal YOLO car tracks

<a id="us-04"></a>
US-04: As a user, I want detected cars and their trajectories so that each crossing can be attributed to its vehicle.

The system SHALL run actual YOLO car detection with tracking and retain timestamped observations and identity continuity needed for line-crossing decisions rather than collapsing a track to one representative detection.

Linear: [PER-89](https://linear.app/matias-personal/issue/PER-89/detect-cars-and-preserve-their-trajectories-with-yolo).

#### Scenario: Track simultaneous cars
- **WHEN** multiple detectable cars move through the configured view
- **THEN** playback shows synchronized boxes, distinct track IDs and trajectories derived from retained temporal observations

#### Scenario: Expose tracking gaps
- **WHEN** a car is occluded or tracking loses or changes identity
- **THEN** the run records the gap or uncertainty and does not invent confident continuous observations

### Requirement: Infer the associated signal state

<a id="us-05"></a>
US-05: As a user, I want the visible signal state over time so that each crossing has signal context.

The system SHALL infer red, yellow, green or unknown from the configured signal region in video and expose timestamped state evidence independently of demonstration annotations.

Linear: [PER-90](https://linear.app/matias-personal/issue/PER-90/recognize-the-associated-traffic-signal-over-time).

#### Scenario: Observe readable signal
- **WHEN** the configured associated signal is readable in the video
- **THEN** the result provides synchronized inferred state observations that can be inspected with playback

#### Scenario: Handle ambiguous signal
- **WHEN** the signal is obscured, unreadable or ambiguous around a transition
- **THEN** the state is unknown or temporally uncertain and cannot establish a confident red-light candidate

### Requirement: Identify evidence-backed red-light crossing candidates

<a id="us-06"></a>
US-06: As a reviewer, I want candidate red-light crossings so that I can inspect potentially unsafe events.

The system SHALL classify a candidate only when a tracked car crosses the configured stop-line segment in the allowed direction with sufficient observed red evidence at the crossing time, preserving documented geometry and temporal tolerances.

Linear: [PER-91](https://linear.app/matias-personal/issue/PER-91/identify-candidate-red-light-crossing-events).

#### Scenario: Detect red crossing
- **WHEN** a temporally supported car trajectory crosses the configured segment in the allowed direction while the associated signal is observed red
- **THEN** the system creates one candidate linked to its track, crossing time, signal evidence and configuration

#### Scenario: Exclude non-candidates
- **WHEN** a car stops before the line, crosses in green or yellow, moves in the opposite direction or crosses only the infinite extension outside the segment
- **THEN** the system does not label that behavior as a red-light candidate

#### Scenario: Preserve uncertainty
- **WHEN** signal timing, observation gaps or vehicle identity do not support a reliable verdict
- **THEN** the system records an indeterminate outcome and reason rather than a confirmed red candidate

#### Scenario: Avoid duplicate events
- **WHEN** box jitter or repeated evaluation revisits the same track and physical line crossing
- **THEN** the result contains only one event for that crossing under the documented deduplication rule
