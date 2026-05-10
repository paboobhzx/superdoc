# SuperDoc — General Development Instructions

This file contains guardrails and guidelines for any agent (Claude, Cursor, Copilot, or other)
working on this codebase. It lives in `history/` so it is accessible to all agents and
collaborators without requiring Claude-specific tooling.

---

## Core Guardrails

- **No overengineering.** Solve the problem in front of you. No speculative abstractions,
  no helpers for one-time operations, no backwards-compatibility shims for code that doesn't
  need them.
- **Plan before code.** For any non-trivial change, write the approach before implementing.
  Surface trade-offs. Ask when uncertain.
- **Surgical changes.** Touch only what the task requires. Do not clean up adjacent code.
  Do not add docstrings, comments, or type annotations to code you didn't change.
- **Test every round.** All Playwright (E2E), Vitest (unit), and pytest (Lambda) tests must
  pass before a round is considered done.
- **Serverless first.** Lambda for everything. ECS/EC2 only when Lambda's 15-min timeout
  or 10 GB /tmp limit is genuinely exceeded.
- **Least-privilege IAM.** Every Lambda gets its own scoped role. No shared wildcard policies.
- **No hardcoded values.** Everything via Terraform variables, environment variables, or
  SSM Parameter Store.
- **No X-Ray, no WAF.** Too costly. Use CloudWatch structured JSON logging and API Gateway
  throttling instead.
- **Mobile first.** Every UI decision must work on a 390 px viewport.
- **No carousels.** Ever.

## Code Quality Rules

- React components never receive `t` or `lang` as props — use `useTranslation()` internally.
- Reuse existing helpers in `layers/superdoc_utils/` — grep before writing a new one.
- Do not duplicate logic — extract to utils and import.
- Single-file operations return `output_key` (string). Multi-file operations return
  `output_keys` (dict) via `dynamo.mark_done_multi()`.

## Definition of Done (every round)

1. All code written and committed
2. All tests pass (pytest / Vitest / Playwright)
3. `terraform validate && terraform fmt` pass
4. No secrets or state files committed
5. Today's session log updated in `history/YYYY-MM-DD.md`

---

## Daily Logs

Each working session creates or appends to `history/YYYY-MM-DD.md` in this folder.
At the start of any session, read the most recent file in `history/` for context.
Files are committed to the repo so all agents and collaborators share the same history.

**Daily file format:**
```markdown
## Goals
## Actions Taken
## Key Decisions
## Open Items / Next Session
```
