---
name: git-feature-workflow
description: "Create scoped task branches and repository-local worktrees, preserve user changes and hand off validated changes for review."
---

Read project branch conventions and run git status before editing. Use worktree-task-isolation to create or select a worktree inside the main repo .worktrees directory. Keep one focused branch per task; use the project's task naming scheme, or feature/<slug> when none exists. Do not reset, stash, discard or include unrelated user work. Run relevant validation before handoff. Commits, pushes and PRs follow the user's authorization and project workflow; never infer merge or release permission. Report the exact branch, worktree, changed files, checks and PR when created.
