---
name: worktree-task-isolation
description: "Create and use Git worktrees inside the owning main repository .worktrees directory for isolated implementation or review."
---

Find the main checkout from the first worktree entry in `git worktree list --porcelain`; reject a bare repository until a primary checkout is identified. Always use `<main-checkout>/.worktrees/<name>`. Do not use the current linked worktree as the parent and do not accept an external override. Add `/.worktrees/` to the main checkout `.gitignore` before creating a new worktree and verify it with `git check-ignore`.

Use `~/.agents/scripts/worktree.py create <repo> <name> --branch <branch> --base <local-ref>` for a new branch, or `--existing-branch` for an existing branch. It performs no fetch and does not delete/reset existing work. Run `~/.agents/scripts/worktree.py list <repo>` to inspect registered worktrees. Use the repository's local agent configuration in the new worktree; pending uncommitted configuration changes in the main checkout are not inherited automatically.

Use the assigned worktree for all task edits and validation. Report its absolute path and branch. Preserve all existing user changes. Worktree removal/relocation and branch deletion are separate explicit actions, with status and active-use checks first. Existing external worktrees are not silently relocated.
