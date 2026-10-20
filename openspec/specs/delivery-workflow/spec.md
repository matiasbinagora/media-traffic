# Delivery Workflow

## Purpose

Keep Media Traffic stories, specifications, backlog, and validation evidence
traceable throughout product delivery.

## Requirements

### Requirement: Stories with observable acceptance criteria
The team SHALL document each story in OpenSpec in English, identifying the actor,
need, benefit, scope, and observable acceptance criteria.

#### Scenario: Prepare a story for the backlog
- **WHEN** a story is written from a confirmed need
- **THEN** its requirement includes an As/I want/so that statement and WHEN/THEN scenarios
- **AND** unresolved decisions are explicit before implementation starts

### Requirement: Traceability with Linear
The team SHALL link each published story to its real Linear issue and OpenSpec
path, using the Media Traffic project verified through authenticated access.

#### Scenario: Publish a story
- **WHEN** authenticated access can read the destination project
- **THEN** the issue includes the specification path and acceptance criteria
- **AND** the specification records the real identifier and URL returned by Linear

#### Scenario: Project access is unavailable
- **WHEN** the connection or destination project cannot be verified
- **THEN** the story remains a local draft without an invented issue identifier

### Requirement: Functional test evidence
The team SHALL verify implemented user flows with TestSprite and relate results
to acceptance scenarios before declaring a story complete.

#### Scenario: An executable application is available
- **WHEN** an executable application and a verified TestSprite project exist
- **THEN** a broad suite covers its main user flows and the relevant cases are executed
- **AND** results, run identifiers, and unresolved failures are recorded

#### Scenario: Application or verified credentials are missing
- **WHEN** an executable application or verified credentials are missing
- **THEN** functional validation is reported as pending without claiming passed tests

### Requirement: Reproducible local tools
The repository SHALL pin agents-cli, OpenSpec, and TestSprite versions in
devDependencies and retain package-lock.json for reproducible installation.

#### Scenario: Prepare a checkout
- **WHEN** a contributor runs npm ci with the Node version in .nvmrc
- **THEN** npm scripts use tools installed in node_modules
- **AND** global installations of those three tools are not required
