## ADDED Requirements

### Requirement: Validate journeys, rules and real inference independently

<a id="us-09"></a>
US-09: As a product owner, I want reproducible acceptance evidence so that I can assess the demo against its agreed behaviors.

The project SHALL establish broad TestSprite functional coverage, deterministic crossing-rule tests and actual inference evaluation against independently annotated video before claiming MVP acceptance.

Linear: [PER-94](https://linear.app/matias-personal/issue/PER-94/validate-the-full-traffic-analysis-experience-and-detection-rules).

#### Scenario: Exercise broad web journeys
- **WHEN** an executable application and authenticated TestSprite project are available
- **THEN** the suite covers upload success/rejection, configuration, processing success/failure and evidence/review decisions with observable assertions and retained run receipts

#### Scenario: Test temporal rules
- **WHEN** the crossing rules are implemented
- **THEN** deterministic tests cover red/green/yellow/unknown, stopping, direction, segment limits, timing boundaries, gaps, identity ambiguity and duplicate suppression

#### Scenario: Evaluate real inference
- **WHEN** the qualified independent reference annotations and real pipeline are available
- **THEN** a reproducible evaluation reports correct candidates, false detections, missed events and temporal/identity limitations separately from functional UI verdicts

#### Scenario: Gate acceptance honestly
- **WHEN** numeric accuracy/latency criteria remain unagreed or required evidence is missing
- **THEN** the project reports acceptance as not verified and obtains agreed thresholds before final acceptance instead of presenting setup or simulated output as a passing suite
