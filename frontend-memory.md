# Frontend Memory

## Visual Thesis
- `azure` is the canonical SuperDoc theme.
- `dark` is a supported alternate mode, not a parallel identity.
- Keep the product upload-first, utility-led, and lighter on chrome than cards.

## Source Of Truth
- Supported themes today: `azure`, `dark`.
- No test should assume the old 5-theme palette, sidebar shell, or bottom nav.
- New user-facing strings should go through `I18nContext`.

## UX Principles
- Home prioritizes one action: drop a file and start a real conversion.
- Batch should feel like one grouped workflow with many jobs, not an unrelated loop.
- Processing and dashboard should foreground state, retention, and next action.

## Roadmap Constraints
- Multimedia will need richer pipeline states than `QUEUED/PROCESSING/DONE`.
- Future breadcrumbs/timeline should handle upload, queue, worker, artifact creation, and finish.
- Dashboard/history should converge local session files and registered-user history into one ledger model.

## Open Decisions
- Keep `/support` as internal information page plus Ko-fi CTA unless product wants an external-only flow.
- Password reset CTA should stay non-committal until the backend flow exists.
- `/m` remains separate for now; revisit once the responsive shell is simplified.
