# ADR 0021: Native window observations and current membership

Status: Proposed; trusted proof mechanism unresolved; no implementation entry

Date: 2026-10-15, Asia/Bangkok.

Owner: `/root`, under existing maintainer delegation. This records a proposed
semantic/ownership refinement after actual CTX1 evidence. It does not amend
accepted records, choose a fallback, select Rust or authorize another native run.

## Actual problem

The [admitted CTX1 negative](../evidence/p4.3-native-suite-ctx1-first-failure-2026-10-15.md)
and [independent outcome review](../reviews/p4.3-native-suite-ctx1-outcome-accessibility-agent-review-2026-10-15.md)
locate an unsupported required NativeWindowHandle read at walk-child-guard in
initial setup. They identify an attempted source edge, not the child's type,
root identity, ordinal, HWND absence, safe membership or OS cause.

Current setup Guard refuses before its subsequent identity/parent comparisons.
The collector also requires a typed HWND at its general boundary. Its accepted
[component contract](../work-items/P4.3-native-collector-component.md) explicitly
refuses unsupported/malformed HWND observations. Fixing only the one observed
setup caller would neither define nor qualify a complete semantic contract.

In current source, a typed integer0 reaches RequirePeerBoundary's logical-node
return, while exact NotSupported never reaches that function. Converting the
sentinel to0 would therefore bypass a required distinction, not merely normalize
an equivalent value. No such conversion is proposed.

## Primary API basis and limits

Microsoft documents Int32 and default0 for
[NativeWindowHandleProperty](https://learn.microsoft.com/en-us/dotnet/api/system.windows.automation.automationelement.nativewindowhandleproperty?view=windowsdesktop-10.0).
With explicit-default suppression, a missing supplied value instead yields
NotSupported. This does not establish an observed typed zero or diagnose this
particular child as windowless.

[GetCurrentPropertyValue](https://learn.microsoft.com/en-us/dotnet/api/system.windows.automation.automationelement.getcurrentpropertyvalue?view=windowsdesktop-10.0)
returns a value current at that call; later UI interaction can change it.
Individual reads do not promise an atomic multi-property observation.
[GetParent](https://learn.microsoft.com/en-us/dotnet/api/system.windows.automation.treewalker.getparent?view=windowsdesktop-10.0)
may return null for a parent outside the current view, and subsequent passes
need not return the same parent.

[Runtime identifiers](https://learn.microsoft.com/en-us/windows/win32/api/uiautomationclient/nf-uiautomationclient-iuiautomationelement-getruntimeid)
are desktop-scoped, reusable over time and opaque comparison values. These API
contracts do not furnish a security-ownership guarantee from matching provider
IDs or parent chains. Treating such metadata as insufficient authority is the
project's conservative policy, not a claim that these docs prove every property
arbitrarily forgeable.

## Required semantic distinction

| Observation | Required treatment in any future candidate |
| --- | --- |
| Explicit Int32 zero | Preserve known-zero state; never establish an OS root from it |
| Explicit Int32 nonzero | Retain exact fresh native boundary/liveness/root validation |
| Exact NotSupported sentinel | Preserve unsupported state; currently refuse; any alternate route needs separate positive proof |
| Null, wrong type, provider error or deadline failure | Remain distinct refusal; never become unsupported/zero/safe |

Preserve one getter with ignoreDefaultValue true, existing pre/post deadline
ordering and first-failure identity. An unknown-basic structural flag policy
for password/enabled/offscreen does not automatically authorize unknown HWND.

## Alternatives and unresolved decision

1. Retain the strict current refusal and defer unsupported cases. This is the
   behavior that remains in force while the proposal is unresolved; it cannot
   satisfy the missing S2 native evidence by relabeling the case supported.
2. Develop a separately qualified current-member route that preserves unknown
   HWND state and supplies positive trusted scope/membership proof without
   weakening root/window admission. This alternative is not accepted here.

The proof obligation is deliberately open: name the trusted fact or mechanism
that connects a newly permitted member to the exact live OS-admitted root,
process birth, user/session/desktop and current generation. Provider PID,
runtime ID, AutomationId, name, type and ancestry are not sufficient alone.
Merely adding parent comparisons does not close that gap. If no mechanism can
meet it, retain refusal and record a defer decision; do not implement an
optimistic ancestry fallback.

A later complete candidate contract must specify an executable proof sequence,
which provisional observations may precede proof, how nonzero intermediate
handles and independent auxiliary roots are checked, and when identity,
semantic/content/pattern reads or trusted synthetic setup mutation may occur.
It must state dynamic-tree/ABA/provider-trust limits without inventing atomicity.
No unsupported observation by itself can create a root, content permission,
action descriptor, pattern access or mutation authority.

## Governance and unchanged boundaries

This risk/contract change requires a separate ADR or superseding plan decision
under [WORKFLOW](../WORKFLOW.md), actual independent design review and a separate
implementation entry. Explicitly identify affected ADR0017, accepted S2 entry,
capture/component and trusted-setup requirements; do not silently rewrite them.
This proposed ADR is not that accepted decision or an implementation contract.

Preserve R1 and CTX1 source, linked foundation, outputs, packets, entries and
actual negatives physically. Both native entries are consumed. Any future
candidate must be isolated, including copies of affected shared collector/
admission sources rather than editing pinned files in place, with its own
explicit source/build/closure inventories and separately admitted provenance.

No sentinel-to-zero/default substitution, child/subtree skip, oracle input,
fixture/golden modification, new provider probe, arbitrary application access,
broader enumeration, timeout/guard relaxation, input injection, SDK install,
security change or unchanged retry is permitted. Any proposed new observation
must first be specified, budgeted and independently reviewed.

All existing22 cases/32 captures/4 probes/132 artifacts per lane, shared10s/
pure30s/native240s budgets, privacy rules and full package/compatibility gates
remain mandatory. No S2, P4.3, Rust qualification, Phase4 or release acceptance
follows from this proposal. The first release still requires qualified Rust
native and the remaining roadmap gates.

## Decision and rollback

No alternative is selected. The next [work item](../work-items/P4.3-window-observation-ownership-refinement.md)
tracks proof, complete design and actual review prerequisites. Implementation
remains closed until those are satisfied and separately authorized. Rollback
of a future candidate must preserve all prior evidence and accepted web/native
contracts; this documentation-only proposal changes no runtime behavior.
