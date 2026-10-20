## ADDED Requirements

### Requirement: Upload and replay supported video

<a id="us-02"></a>
US-02: As a user, I want to upload and preview my video so that I can prepare it for analysis.

The system SHALL display supported formats and file/duration limits, validate uploaded media and permit successful uploads to be replayed before analysis.

Linear: [PER-87](https://linear.app/matias-personal/issue/PER-87/upload-and-play-a-traffic-video).

#### Scenario: Upload supported video
- **WHEN** a valid supported video within the displayed limits is uploaded
- **THEN** the user can preview it and the interface distinguishes upload success from analysis completion

#### Scenario: Reject invalid media
- **WHEN** a video is corrupt, unsupported or exceeds the configured limits
- **THEN** the system rejects it with a specific actionable error and does not start analysis

#### Scenario: Handle interrupted upload
- **WHEN** an upload fails or is interrupted
- **THEN** the user sees a failure and a way to retry without receiving successful-analysis results
