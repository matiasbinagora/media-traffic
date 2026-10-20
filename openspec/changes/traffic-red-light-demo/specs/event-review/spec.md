## ADDED Requirements

### Requirement: Review evidence and record a separate decision

<a id="us-07"></a>
US-07: As a reviewer, I want to inspect each event in context so that I can confirm, dismiss or leave it indeterminate.

The system SHALL allow event selection, contextual replay and recording of confirmed, dismissed or indeterminate human decisions separately from immutable automatic findings.

Linear: [PER-92](https://linear.app/matias-personal/issue/PER-92/review-crossing-candidates-with-synchronized-evidence).

#### Scenario: Inspect selected event
- **WHEN** the reviewer selects an event
- **THEN** playback seeks to its context before and after crossing and synchronizes car, trajectory, configured line and signal evidence

#### Scenario: Record a decision
- **WHEN** the reviewer chooses confirmed, dismissed or indeterminate
- **THEN** the system records the decision with its event/run reference without replacing the automatic verdict

#### Scenario: Handle missing evidence
- **WHEN** an event cannot provide sufficient playable evidence
- **THEN** the interface explains the missing evidence and does not imply human confirmation or complete evidence
