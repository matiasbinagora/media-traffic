# User Story Template

Write every story, acceptance criterion, and specification in English. Create a
change with `npm run spec -- new change <kebab-case-name>`, then follow
`npm run spec -- instructions proposal --change <kebab-case-name>`.
Requirements belong in `specs/<capability>/spec.md` inside the change.

```markdown
## ADDED Requirements

### Requirement: <Observable outcome>
As a <role>, I want <capability> so that <benefit>.
The system SHALL <testable behavior>.

Linear: add the real issue identifier and URL after creation.

#### Scenario: <Successful path>
- **WHEN** <action and conditions>
- **THEN** <observable outcome>

#### Scenario: <Relevant failure or restriction>
- **WHEN** <failure or permission condition>
- **THEN** <expected behavior>
```

Use `.agents/workflows/linear-story.md` for the Linear description. Include context,
measurable goal, scope, exclusions, observable acceptance criteria, dependencies,
one accountable role, and expected evidence. Human assignees and execution dates
must be confirmed rather than invented. Mark planned branches and worktrees as
planned until they exist.

Read the destination project and current backlog before creating issues. Store the
real issue identifier and URL in OpenSpec, and include the spec path in Linear.
Run `npm run spec:validate` after changes. Do not close stories without evidence.

For this project, keep synthetic source video, independent annotations, machine
inference, and human review decisions separate. Unknown signal states are not red.
Record TestSprite run IDs for workflows and separate evaluation evidence for
tracking, crossing rules, and comparison against annotated events.
