# Browser conformance deadline investigation

Date: 2026-10-15, Asia/Bangkok.
Status: Failed configured conformance-browser prerequisite retained; one bounded diagnostic authorized.
Decision owner: `/root`, under the existing delegated review authority.

## Failed run

Root session50915 ran `build:angular`, `test:conformance`, `test:adversarial`
and `test:conformance:browser` sequentially. Angular build,12 conformance tests
and24 adversarial tests passed. The final browser subset used its configured
three workers and ended exit1:6 passed,3 failed,6.1 minutes (chunk `d8d59f`).
Root typecheck had already passed separately, session46986.

| Browser and test | Observed failure |
| --- | --- |
| Firefox, conformance.spec.ts:93 disposal | 30s timeout; no action_started before stale_revision failure |
| Firefox, conformance.spec.ts:130 spoofing | 30s timeout during page.exposeBinding |
| WebKit, conformance.spec.ts:54 corpus | 180s timeout; subsequent exposeBinding encountered closed context |

No browser fixture, conformance driver, public runtime, Playwright configuration
or assertion was changed during this run. An author's isolated diagnostic
Vitest run overlapped part of the browser run before the serialization notice;
its contribution to the observed delay is unmeasured. Do not attribute CPU/I/O
contention to that run without resource evidence.

## Preserved failure artifacts

Before any further browser command, root copied the original browser results
into this fresh owned directory, preserving the originals:

```text
C:\Users\phichayut.kot\AppData\Local\Temp\dual-surface-ui-browser-failure-f7a839a17ae34eea9cd53ba18b869dd8\browser
```

Copy/readback session7394 completed exit0, chunk `a53282`. The trace files are
identified by their full SHA256 below; screenshots and error contexts were
copied with them. These are browser fixture artifacts, not native UIA evidence.

| Trace directory | Bytes | SHA256 |
| --- | --- | --- |
| conformance-managed-dispos-851c2-t-mutation-adapter-boundary-firefox | 76340 | e7e3f99157292de38c35ab39259e5e539bc343dbeba110cdb1f3361c67155f84 |
| conformance-managed-author-8fcda-s-page-and-console-spoofing-firefox | 42061 | d504a87faf20be53ae3c396b57f516f4b9cfdea4e91a3106728d55d6bf8623c2 |
| conformance-managed-Playwr-91cab-across-the-canonical-corpus-webkit | 361429 | 41fc6f82e82a3b1365796e21d35901c1ace5be81089c212c0976d5f81e8ca22f |

The copied `.last-run.json`,194 bytes, has SHA256
`1d950d4b5ab0be56e191bacf561722510baac8cc2755e335135fb07230e9725f`.

## Independent trace diagnosis

Actual reviewer `/root/ctx1_source_interop` inspected all three traces and the
unchanged test/driver. These trace positions are monotonic milliseconds within
each artifact, not operating-system wall time or CPU measurements.

For Firefox disposal, Before Hooks ran114977-137264, navigation137281-140134,
and exposeBinding began151219. The timeout preceded After Hooks158299;
binding completion161222 and fixture SetContent161224 occurred during teardown.
Context close began164103 before assertions164175/164180. The missing lifecycle
event is secondary to invalidation before the intended mutation boundary;
this artifact does not establish a disposal-hook regression.

For Firefox spoofing, Before Hooks ran156488-170379, navigation170386-172780,
and exposeBinding began187229 after the nominal30s budget. After Hooks began
192418 and context close ran203507-206761. The binding timeout appeared206750;
the spoofing assertions were not reached.

For WebKit corpus, the test began176769 and first binding195896. It progressed
through15 binding creations, the last356989-357958, reaching approximately181s.
After Hooks359907 and context close363004 followed the180s timeout. The later
closed-target error is secondary to that timeout, not evidence of spontaneous
browser closure.

The three traces establish deadline exhaustion before the intended assertions
or action boundary. They do not identify the physical CPU/I/O cause. Installed
consumer verification traverses/hashes the tree once per worker; cold setup
cost exists, but its contribution has not been isolated. No fixture/runtime
change or timeout/assertion relaxation is justified by these artifacts.

## Bounded diagnostic decision

Run at most one serialized diagnostic of the same nine tests after other test
workers finish, with retries0, original30s/180s caps, original assertions and
installed-consumer verification. Use `--workers=1 --max-failures=1` solely for
diagnosis. On failure, stop and inspect its newly preserved trace rather than
repeat until green.

Even a9/9 diagnostic pass does not replace the failed configured three-worker
prerequisite. A fresh canonical configured browser gate remains required before
candidate/native qualification. This record authorizes no source gate, native
attempt, S2 acceptance, timeout increase or release. Preserve this failed run
and date any later outcome separately.
