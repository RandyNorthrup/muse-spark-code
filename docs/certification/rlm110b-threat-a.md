# Threat model — RLM110B phase a: worker (R1, F1, P)

Reviewed 2026-10-22 by the lane author before any phase-a code was written;
lead review pending at integration. Scope: the worker's receiver (R1),
approval forwarding (F1), and pairing on a node (P). D90.2, D90.9 and D90.10
govern; D121/D208 forbid any limit of ours. M100's pairing core, transport
and receiver logic do not exist yet; this phase defines the ports it needs
and refuses anything they cannot prove.

## Assets

- The orchestrator's tasks and the worker's sandboxes (task intake, results).
- Approvals: a forwarded answer must prove exactly the action it answers.
- Paid consent: priced and bound on the node that pays, never widened by relay.
- Pairing: only the person holding both ends can join a worker to an orchestrator.

## Trust boundaries

- The pair channel (E2E, M100): assumed to authenticate both ends; R1/F1
  verify every answer inside it anyway (id, digest, expiry, signature).
- Surfaces attached to the orchestrator: may show asks; must never widen or
  reuse an answer.
- The QR/text invitation: shown on the node's own screen; the fingerprint
  check binds what the person saw to what paired.

## Threats and mitigations

| #   | Threat                                                                   | Mitigation                                                                                                                                                                                                       |
| --- | ------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A1  | A forged or replayed approval answer lands an action the person refused. | Each request mints id, exact action digest and expiry; only an answer echoing all three, signed in the forwarding pair's channel, is accepted; replays refused (seen ids); expiry enforced on a monotonic clock. |
| A2  | A forwarded answer widens scope (another action, another workspace).     | The digest binds the exact action; a surface cannot widen or reuse it; each grant revocable and audited.                                                                                                         |
| A3  | A forwarded Bypass silently elevates the worker.                         | A forwarded Bypass is never accepted, whatever the grant.                                                                                                                                                        |
| A4  | Paid consent is relayed to a node that did not price it.                 | Paid consent stays priced and bound on the node that pays (D48); the forward carries the price binding, verified at admission.                                                                                   |
| A5  | An unattended worker answers its own asks.                               | Asks wait on attached surfaces, then expire as refusal; never self-answered; unattended runs take D65's headless rules.                                                                                          |
| A6  | A stale-epoch task result lands after re-dispatch (ties to R8).          | Epoch checked at result intake and every gate; old epochs refused; post-checkpoint results quarantined as a branch.                                                                                              |
| A7  | A pairing code/QR is intercepted and used from another machine.          | Fingerprint confirmation binds the channel the person compared; unpair is explicit and audited; step-up required for pairing.                                                                                    |
| A8  | A worker offers work to an orchestrator it never paired with.            | The receiver serves only pairs the node's pairing store names; unknown callers refused before any task state is touched.                                                                                         |
| A9  | M100's absence tempts an interim trust shortcut.                         | No interim trust: where a port has no provider, the operation is refused as unavailable with words, never downgraded.                                                                                            |

## Residual risks

- The E2E channel, identity keys and the committed SAS are M100/M110d's;
  until they land, R1/F1/P run against the loopback channel used in tests
  and refuse remote operation. The status line says exactly this.
