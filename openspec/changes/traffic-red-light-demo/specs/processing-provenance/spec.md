## ADDED Requirements

### Requirement: Report honest processing state and provenance

<a id="us-08"></a>
US-08: As a user, I want clear progress, failures and analysis provenance so that I can understand and reproduce the result.

The system SHALL expose actual asynchronous stages and terminal states, preserve model/configuration provenance and distinguish synthetic source footage, real inference and explicitly labeled simulations.

Linear: [PER-93](https://linear.app/matias-personal/issue/PER-93/show-truthful-analysis-progress-failures-and-provenance).

#### Scenario: Complete a real run
- **WHEN** upload, configuration and actual analysis succeed
- **THEN** the system reports completed status and records source identity, model/weights version, tracking/signal/rule settings, timebase and configuration snapshot

#### Scenario: Report processing failure
- **WHEN** media preparation, model loading or analysis fails
- **THEN** the system exposes the failed stage and actionable reason and never silently replaces the failure with fixture detections

#### Scenario: Trace separate runs
- **WHEN** the same video is analyzed using different configuration or models
- **THEN** each run retains a distinct identity and provenance so displayed evidence can be matched to the originating run

#### Scenario: End stalled or interrupted runs
- **WHEN** inference exceeds its configured timeout or the server restarts with a queued/running persisted run
- **THEN** the system terminates timed-out inference, records a terminal failed status with an actionable code, and does not leave the run polling indefinitely
