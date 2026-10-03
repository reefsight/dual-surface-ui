# P4.3 internal managed identity reference

Development-only, decision-only first slice of the accepted
[P4.3 implementation brief](../../../docs/work-items/P4.3-implementation-slices.md).
Not an SDK export, guarded executor, daemon, release, production language choice
or full P4.3/Phase 4 acceptance. Rust remains preferred for the later P4.4
comparative decision; this reference uses the existing pinned SDK without
installation or administrator rights.

## Commands and evidence

From the repository root on the recorded ordinary interactive Windows host:

```powershell
pwsh -NoProfile -File scripts/run-p4.3-identity.ps1
pwsh -NoProfile -File scripts/run-p4.3-identity.ps1 -Native
```

The first command builds and runs internal unit cases. The second also plans
two serial native runs, stopping on the first failure. There are no run retries.
Each startup/state wait and observation has a 10-second budget; each native
worker has the unchanged 240-second outer process-tree deadline. Only owned
workers and the package-owned synthetic fixture may be terminated.

The accepted fixture DLL is SHA-256 pinned. This launcher intentionally does
not rebuild P4.2 or silently change its accepted binary/source provenance.
A missing or mismatched binary fails closed; clean-checkout artifact rebuild
provenance must be established separately before portability is claimed.
The SDK cache marker/version are checked, not a substitute for fresh verification
of every cached SDK byte. A malicious local SDK/workspace administrator is not
inside this synthetic development harness's isolation boundary.

Raw fixture state stays under a new owned temporary evidence directory. Reports
are bounded closed metadata with literal case IDs, stable decision codes and
unchanged-state assertions, never provider names/values, native IDs, token SIDs,
user paths or exception strings. Do not admit failed/partial runs as success.

## Boundaries and non-claims

- The only admitted process is the `Process` directly created by the trusted
  harness for the pinned fixture. No caller-provided process/window/selector
  enumeration is available.
- OS admission rechecks process lifetime, user/session and matching non-elevated,
  non-UIAccess integrity, local active session, interactive station and current
  input desktop, native window liveness and window-owning thread/process.
- Capture starts at that admitted window, counts every ControlView wrapper,
  verifies current parent/process membership and bounds nodes/depth/children,
  properties, runtime identity length and observed elapsed time. No Name/help
  text or value content is read. Password classification precedes pattern reads.
- The catalog defensively copies bounded observations, checks one rooted parent
  graph without cycles/disconnected nodes, derives container membership from
  it, qualifies type/pattern before rejecting ambiguity, and uses private
  fingerprints and random generation-bound receipts. A receipt contains no
  provider selector or executable peer.
- Unsupported/null/wrong-typed safety flags are refused before pattern reads;
  UIA defaults are not treated as explicit observations. Malformed UTF-16 is
  rejected before hashing. Read-only Value/Range writes are denied; that
  property does not forbid unrelated supported semantic patterns.
- Unknown receipts are rejected locally without a capture. Identity/reset/window
  changes, malformed observations and provider errors invalidate old receipts;
  recovery never revives them. Reset fencing uses append-only acknowledgement
  record ordinals, not a resettable fixture revision.
- A returned decision is **not** authorization to subsequently invoke a retained
  pattern. Slice 3 must put revalidation, policy, confirmation, effects and one
  mutation inside a reviewed executor, address races and prove postconditions.
- Trusted fixture setup invokes only literal setup controls. These are test
  scenario preparation, not a public semantic action path or adapter executor.
- A still-readable detached pattern or destroyed-window metadata is observed
  but never invoked. P4.2 separately measured retained callability.
- Stopwatch checks cannot interrupt a blocked COM call, nor prevent allocations
  inside an untrusted UIA provider/marshaler. The owned-worker deadline contains
  duration; provider-internal allocation containment remains open. No memory
  budget, hostile production provider, secure-desktop/permission prompt or actual
  alternate-session transition is proven by unit/fault-injection tests.
- This identity fingerprint is not a full semantic revision; capture/projection,
  all seven action families, events/resync, replay/cancellation, adversarial native
  fixtures, comparative measurements and remaining P4.3 gates are still open.
- Salted runtime IDs are correlation, not lifetime authority. Unobserved
  identical-tree ABA with recycled runtime IDs and post-observation removal
  races remain unproven. Later authoritative generation/event-loss fencing and
  the action slice must address these before any executor/native support claim.

## API references

The admission checks combine observations; `IsWindow` alone is not authority
because windows can be destroyed and their handles recycled.
[Microsoft IsWindow](https://learn.microsoft.com/en-us/windows/win32/api/winuser/nf-winuser-iswindow).
Borrowed thread-desktop handles are not closed; owned input-desktop handles are.
[GetThreadDesktop](https://learn.microsoft.com/en-us/windows/win32/api/winuser/nf-winuser-getthreaddesktop),
[OpenInputDesktop](https://learn.microsoft.com/en-us/windows/win32/api/winuser/nf-winuser-openinputdesktop).
Current local session state is queried without enumerating other sessions and
the returned buffer is freed.
[WTSQuerySessionInformation](https://learn.microsoft.com/en-us/windows/win32/api/wtsapi32/nf-wtsapi32-wtsquerysessioninformationw),
[WTS_CONNECTSTATE_CLASS](https://learn.microsoft.com/en-us/windows/win32/api/wtsapi32/ne-wtsapi32-wts_connectstate_class).
Token information is read with TOKEN_QUERY into a fixed bounded buffer and no
privilege changes.
[GetTokenInformation](https://learn.microsoft.com/en-us/windows/win32/api/securitybaseapi/nf-securitybaseapi-gettokeninformation).
