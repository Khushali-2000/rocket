# Claude review for fork PRs

The workflow `.github/workflows/claude-review.yml` reviews PRs with Claude, including PRs from forks.

## How it works

- Trigger: `pull_request_target`, so repo secrets are available. It never checks out PR code.
- Trusted authors (OWNER, MEMBER, COLLABORATOR) are reviewed on every push.
- Fork authors are reviewed after a maintainer adds the `safe-to-review` label. Skim the diff first.
- The action checks that the user who triggered the run has write access. On a `labeled` event that is the maintainer.
- A later push from the fork author is skipped. Remove and re-add the label to review the new commits.
- The job uses `GITHUB_TOKEN` (no `id-token: write`), so no write-scoped GitHub App token exists.
- The review prompt is vendored in `.claude/commands/pr-review.md` (from anthropics/claude-plugins-official, Apache 2.0). It is loaded from the base branch, so a PR cannot change it.
- `gh pr comment`, `gh api` and other gh commands are denied. Findings are posted only as inline comments. A clean PR gets no comment.

## One-time setup

Create the label: `gh label create safe-to-review --color 0e8a16 --description "Maintainer checked the diff, run the Claude review"`.

## Known risks

- A labeled fork PR still lets the model read attacker-written text (title, body, diff). Skim it before labeling.
- Deny rules on Bash arguments are not a hard boundary. Removing `gh pr comment` is the real control.
- The OAuth token is long lived. Prefer a separate token for this job and rotate it.

## Manual checks after merge (not verified yet)

1. Add the label to a fork PR. The review job should run and post inline comments.
2. Push to that fork PR. The job should be skipped, or fail the write-access check.
3. Open a PR from a branch in this repo. The job should run without a label.
4. Confirm `/pr-review` is picked up from `.claude/commands/` in the headless run. If not, the job fails fast.
5. Confirm `CLAUDE_CODE_SUBPROCESS_ENV_SCRUB` is honoured.

## Revert

The old workflow is in git history. Revert the commit that introduced the label gate:

```bash
git log --oneline -- .github/workflows/claude-review.yml
git revert <commit>
```

The old one runs on `pull_request`, so fork PRs fail again there. Also revert or delete `.claude/commands/pr-review.md`.
