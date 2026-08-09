# LESSONS — auto-maintained by scripts/lessons.py

> Machine-owned. Do NOT hand-edit. Changes are overwritten on the next `lessons.py` write.
> Canonical state lives in `.specs/lessons.json`. Edit lessons only via the script.
> promote_threshold=2 distinct features · window_days=45 · quarantine_threshold=2

## Confirmed (load these at Specify/Design)

Corroborated across multiple features. Safe to apply as guidance.

_none_

## Candidates (under observation — do NOT load as guidance yet)

Seen once or not yet corroborated. Tracked, not trusted.

### L-001 — Use mutation survivors in financial rules to add boundary and state-sequence assertions before raising the mutation ratchet.
- signal: `surviving_mutant` · recurrence: 1 feature(s) · scope: `financial-core` · harmful: 0
- features: bank-reconciliation-restructuring
- evidence: .specs/features/bank-reconciliation-restructuring/validation.md:86 (financial-core)
- last seen: 2026-08-09T16:52:30Z

### L-002 — Keep the private-corpus release gate fail-closed whenever no approved accounting oracle is configured.
- signal: `ac_gap` · recurrence: 1 feature(s) · scope: `parity-release` · harmful: 0
- features: bank-reconciliation-restructuring
- evidence: .specs/features/bank-reconciliation-restructuring/validation.md:103 (parity-release)
- last seen: 2026-08-09T16:52:30Z

## Quarantined (failed when applied — ignore)

A confirmed lesson that recurred alongside failure. Kept for the maintainer to review.

_none_
