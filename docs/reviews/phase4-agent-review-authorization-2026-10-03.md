# Phase 4 — Delegated agent review and execution

Date: 2026-10-03 (Asia/Bangkok)

Status: Authorized by the repository maintainer in the current task

## Trusted instruction and scope

The maintainer explicitly authorized: “agent review ได้เลยทั้งหมด ผมให้คุณจัดการได้เลย ให้ถึง goal เราพอ”.
This replaces the earlier no-spawn instruction for independent review of this
project and delegates management of the existing, unchanged completion goal.

The goal still requires every roadmap deliverable to be implemented, verified,
documented, independently reviewed, committed in scoped increments and pushed,
without skipped phase decisions or unsupported success claims. The delegated
workflow includes assigning independent reviewers, remediating their findings,
re-running evidence, and recording separate evidence-based work-item/entry-gate
decisions after the original acceptance conditions are satisfied. This is not
acceptance of unreviewed work or a replacement for those conditions.

## Reviewer and decision identity

- Reviews may be performed by separate agents that did not author the target
  implementation. Each report must record its actual agent identity, role,
  reviewed commit/digests, checks, findings, disposition and limitations.
- Agent analysis is not human review. The implementer cannot declare its own
  review independent, or create a synthetic reviewer to make a gate pass.
- A canonical review record references the actual independent review reports.
  Critical/high findings must be resolved and re-reviewed; an accepted risk
  cannot silently be reclassified as a resolved severe finding.
- Any acceptance recorded on the maintainer's behalf must identify this
  delegation as its basis in the associated decision report, rather than
  suggesting that the maintainer personally performed the agent's checks.
- A phase/ADR/runtime decision remains a separate dated record bound to its
  actual evidence. Delegation does not predetermine its outcome. In particular,
  Rust remains preferred but must pass the unchanged P4.4 decision method.

## Unchanged boundaries

No npm publication, release tag, deployment, production/user-data capture,
remote daemon, security-setting change, elevation bypass, signing credential,
mobile support or whole-project Rust migration is authorized by this review
delegation. Native claims still require real operating-system evidence; mocks
and agent assertions cannot substitute for a missing Windows or macOS host.
If an external dependency, host, permission or meaningful out-of-scope decision
is required, report that condition and obtain the necessary input.

## P4.2 execution

Three separate reviewers have been assigned to cover all four P4.2 roles:
accessibility/interoperability, security, and package/review-gate correctness.
Their reports and the eventual canonical decision remain separate from this
authorization. The proposed golden/source target is unchanged unless a finding
requires a documented re-freeze and repeat of the real-provider evidence.
