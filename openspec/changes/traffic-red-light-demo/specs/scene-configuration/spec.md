## ADDED Requirements

### Requirement: Configure one movement and its signal

<a id="us-03"></a>
US-03: As a user, I want to mark the stop line, movement direction and associated signal so that analysis applies to the intended approach.

The system SHALL allow editing a stop-line segment, travel direction and signal region on the video, preserving their alignment across display resizing and snapshotting the configuration per run.

Linear: [PER-88](https://linear.app/matias-personal/issue/PER-88/configure-the-stop-line-movement-and-traffic-signal).

#### Scenario: Save valid configuration
- **WHEN** the user marks valid geometry and the associated signal for one movement
- **THEN** the interface retains editable aligned marks and allows analysis with a versioned configuration snapshot

#### Scenario: Prevent incomplete configuration
- **WHEN** geometry, direction or signal selection is missing or invalid
- **THEN** the system identifies the invalid field and prevents analysis from starting

#### Scenario: Preserve previous run geometry
- **WHEN** the user edits configuration after a run
- **THEN** past evidence continues using its original snapshot and a later analysis records a new snapshot
