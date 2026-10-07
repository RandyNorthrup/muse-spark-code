# M109 T: taint and scrub

Rig: Mac mini, worktree `/Users/randy/lanes/M109T`, branch `m109/t`, base
`8a151dd40`. Scope: PLAN D89.7–8 and M109 lane T. No credentials were read,
no dependency was installed, no live/paid model call was made (zero attempts),
and no other lane's source was changed. The rig brief overrides common.md's
obsolete merge/rig forwarding instructions: no merge/push/rebase and no
aggregate quality run; the lead owns joined-tree quality.

## Provenance slice

`VaultTaintSession` owns validated copies of provenance. Model API requests
use their context's provenance; replies/summaries retain their dependencies.
Muse Code observations remain tainted for that session. Restricted Mode marks
both backends. Reason lists are bounded and deduplicated without clearing the
tainted bit. Callers cannot mutate the owner by changing a returned snapshot.

The Model API adapter publishes the producing request's context to B through
an injected callback, tags replies and tool results, preserves tags through
session storage and compaction, and keeps the metadata off the provider wire.
Search taints calls in that same reply. Configured MCP routing is untrusted
even when the server calls itself `ide`; only the host's own IDE adapter is
trusted. Old history with no provenance is conservatively tainted. Trusted
issue/PR/agent/device adapters supply their context through an explicit port.
All 637 Model API host, session-store and request-provenance tests passed with
the default timeout; the final taint/request/report batch passed 23 tests.

`test/unit/vault/taint.test.ts` passed 12 assertions/tests with the repository's
default timeout. Every listed source forces B's real policy to ask despite an
Always grant; unattended use is denied. The core is independent of VS Code.

## Red drills

The machine-readable [drill receipt](m109-t-drills.json) names the failed tests
and the SHA-256 restored byte-exact after each deliberate mutation. T01–T06
cover taint propagation, schema validation, bounded reasons, sticky Muse Code,
Restricted Mode and derived summaries (V1, V3, V12). Further boundary and scrub
drills and final checks will be appended as the lane progresses.

## Open acceptance and integration

The scrubber's throughput acceptance is currently **failed**: measured
36.24, 39.80 and 32.70 MB/s over 1,000 generated values against the unchanged
50 MB/s floor. The latter two followed separate optimization attempts. Shared
rules require stopping that path after two unsuccessful fixes; no threshold,
timeout, skip, filter or bundle cap was relaxed. This blocks lane-T completion.
Functional work continues independently; the failing performance guard remains.

Named handoffs: B installs the broker-only scrub service on unlock/rotation and
locks it on every invalidation, binding its existing `scrub` and `taint` ports;
X consumes one output stream per command, flushes only on normal EOF and disposes
in finally; trusted Muse Code adapters call `observe` and keep the owner for one
session. Host log/transcript/history adapters bind `SecretScrubPort` before
emitting or keeping text. M96 ledger/report and M102 journal owners are absent
on this base and bind that same port before each physical write and outgoing
report. M100/M107 receivers bind it before delivering relocated results.
No production fake stands in for any missing dependency.
