## ADDED Requirements

### Requirement: Report honest processing state and provenance

<a id="us-08"></a>
US-08: As a user, I want clear progress, failures and analysis provenance so that I can understand and reproduce the result.

The system SHALL expose actual asynchronous phases and terminal states, preserve model/configuration/source provenance, identify the checked-in synthetic source only by matching its manifest SHA-256, and leave other source classification explicitly unidentified. Failure messages SHALL be actionable and sanitized. The system SHALL only report a completed analysis after its playable preview and complete result record have been persisted. A server restart SHALL make an unfinished run terminally failed and require a new, distinct run; failures SHALL never be replaced with fixture detections.

Linear: [PER-93](https://linear.app/matias-personal/issue/PER-93/show-truthful-analysis-progress-failures-and-provenance).

#### Scenario: Complete a real run
- **WHEN** upload, configuration and actual analysis succeed
- **THEN** the system reports completed status and records source identity, model/weights version, tracking/signal/rule settings, timebase and configuration snapshot
- **AND** progress identifies the actual media-inspection, preparation, car-tracking, signal-analysis and result-generation phases
- **AND** completion is persisted together with the result only when the playable preview remains available

#### Scenario: Report processing failure
- **WHEN** media preparation, model loading or analysis fails
- **THEN** the system exposes the failed stage and actionable reason and never silently replaces the failure with fixture detections
- **AND** runtime stderr, local paths and other untrusted diagnostic text are not exposed as user-facing failure messages
- **AND** a server restart marks queued or running work failed and requires a new run identifier for retry

#### Scenario: Trace separate runs
- **WHEN** the same video is analyzed using different configuration or models
- **THEN** each run retains a distinct identity and provenance so displayed evidence can be matched to the originating run
- **AND** the checked-in synthetic clip is identified by its manifest source hash while unrecognized uploads remain explicitly unidentified

#### Scenario: End stalled or interrupted runs
- **WHEN** inference exceeds its configured timeout or the server restarts with a queued/running persisted run
- **THEN** the system terminates timed-out inference, records a terminal failed status with an actionable code, and does not leave the run polling indefinitely
