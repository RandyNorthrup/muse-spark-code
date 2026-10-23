# Threat model — RLM110B phase r: network resilience (Y1–Y4)

Reviewed 2026-10-22 by the lane author before any phase-r code was written;
lead review pending at integration. Scope: turns that pause and resume across
a dropped model connection (Y1), identity addressing and liveness (Y2),
leased checkpointed jobs (Y3), and the fault-injection rig (Y4). D90.25 and
D80.7 govern; D121/D208 forbid any limit of ours that stops work.

## Assets

- The person's conversation history and tool results (must survive a cut).
- Spend accounting: no double-counted attempt, no unbounded replay of a
  possibly-executed paid send.
- Approvals and paid consent: a resume must never widen or replay consent.
- Job ownership: exactly one attempt holds a task's side effects at a time.

## Trust boundaries

- The model connection (TLS to the provider): may drop, stall, or cut a
  stream at any byte, including mid-compaction.
- The LAN between node and orchestrator: addresses change (DHCP), links flap,
  partitions are one- or two-way; whoever holds an old address is untrusted.
- Clocks: wall clocks skew; only monotonic clocks measure leases.

## Threats and mitigations

| #   | Threat                                                                            | Mitigation                                                                                                                                                                                                                                                                                                                       |
| --- | --------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| R1  | A cut stream shows partial text as final, or runs a partially received tool call. | Resume only from the last complete validated item; discard trailing text; never run a partial tool call; re-request from that point.                                                                                                                                                                                             |
| R2  | A retried turn runs an already-ran tool call twice (double side effect).          | Ran tool calls keep their results in the carried history; resume never replays them.                                                                                                                                                                                                                                             |
| R3  | A cut paid attempt is replayed without end, or billed twice.                      | Each attempt settles once from reported usage (uncertain liability reserved at worst case per M82); the retry is its own attempt inside the same budgets; the journal links both. An unanswered send replays only within an explicit bound (person's setting or provider's documented maximum), per the existing transport rule. |
| R4  | A resumed D48 paid feature spends on stale consent.                               | Re-ask after a connection failure unless the failure is proved before the request was sent (DNS, connect, TLS).                                                                                                                                                                                                                  |
| R5  | A cut compaction loses or half-applies history.                                   | Compaction retried as compaction; history replaced only by a validated summary in one step; if compaction keeps failing and the next request would overflow, the turn pauses instead of sending.                                                                                                                                 |
| R6  | Whoever holds a node's old address poses as the node.                             | Nodes are named by id (SHA-256 of the identity key); the first handshake that proves the pinned identity wins; any other answer is ignored. (Pinning itself is M100's; Y2 never accepts an address as identity.)                                                                                                                 |
| R7  | Discovery leaks a stable node id to LAN strangers.                                | mDNS advertises a rotating per-pair HMAC token, never the id; advertising starts only once paired.                                                                                                                                                                                                                               |
| R8  | A duplicate dispatch lands twice (old attempt returns after re-dispatch).         | Epoch checked at every gate (merge, push, broker, relay, paid admission, result intake); old epochs refused; post-checkpoint results quarantined as a branch, never landed.                                                                                                                                                      |
| R9  | Wall-clock skew shortens or stretches a lease.                                    | Both sides measure leases on monotonic clocks.                                                                                                                                                                                                                                                                                   |
| R10 | A timer alone releases ownership of an uncertain attempt.                         | D80.7 holds: uncertain attempts (direct sandbox egress past git/registries, unprovable shutdown) never re-dispatch automatically; the row says why and the person decides.                                                                                                                                                       |
| R11 | Idempotency replay returns a stale outcome for changed input.                     | Step keys bind pair, task, attempt, epoch, step number and the input digest; a changed input is a new key.                                                                                                                                                                                                                       |
| R12 | The fault rig escapes its namespace (packet rules, DHCP) onto the host or LAN.    | The rig runs in its own network namespace with veth pairs only; no rule touches host interfaces; DHCP serves only the veth; the rig refuses to start unless its namespace is private; CI runs it on an isolated runner job.                                                                                                      |
| R13 | A silent stall: work waits on a dead node with no row saying so.                  | Every wait names the node, since-when, attempt and next try, with Retry now and the task's controls; unreachable never becomes offline except by signed notice or the person's own setting.                                                                                                                                      |

## Residual risks

- A provider may bill a cut attempt the harness cannot see; the reservation
  covers it but the usage page shows the attempt as uncertain, not exact.
- Cursor-based stream resume is implemented only where M95's capability
  record carries a cursor set after a capture; elsewhere the request is sent
  again, which may repeat provider-side work inside the same budgets.
- The relay route (M110d) does not exist yet; Y2's relay leg is a typed
  placeholder behind the discovery port, refused as unavailable, never silent.
