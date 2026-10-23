# RLM110C independent review: lanes X, A, F

Lane RLM110C, 2026-10-22, reviewer pass over the M110c-h lane's own
security lanes: X (pairing security, routes, relay, seal), A (sign-in,
ACME, browser access) and F (model relay, brokered uses). Method: a fresh
read of every file in the three lanes against the plan's acceptance
clauses, asking what a hostile or unlucky input does at each boundary,
then a fix pass with a regression test per finding. Independence note:
the same lane wrote and reviewed the code (recovery lanes have one
author); the review was a separate adversarial pass after all three lanes
were green, and every finding below changed code or tests.

Scope (20 source files):

- X: `src/core/devices/{identity,sas,sequence,revocation,rotation,
invitation}.ts`, `src/core/devices/routes/select.ts`,
  `src/runtime/node/relay/{protocol,server,client}.ts`,
  `src/runtime/node/seal.ts`, `src/runtime/node/attach/{policy,
handshake}.ts`
- A: `src/runtime/node/auth/{passwords,totp,recoveryCodes,oidc,
proxySignin}.ts`, `src/runtime/node/acme/{challenge,certificate,
secureContext,pwaManifest}.ts`
- F: `src/runtime/node/modelRelay.ts`, `src/core/devices/brokeredUse.ts`

## Findings

### P0 — fixed

- **XAF-1: an empty stored password hash verified any password.**
  `isNodePasswordValid` fed `expected.length` (0 for an empty hash) to
  scrypt as the key length; scrypt returns an empty key, and two empty
  buffers compare equal. Verified live on node:crypto before fixing.
  Fix: refuse empty hashes and empty salts, with regression tests.
  Exploitability needed a write to the node's owner-only password
  store, but a password check must not have a bypass shape at all.

### P1 — fixed

- **XAF-2: an unseal grant for another node opened this node.**
  `unsealNode` recorded whatever node id the grant named. Fix:
  `unsealNode` takes the node's own id first and refuses a grant for
  anyone else, with a cross-node regression test.
- **XAF-3: revocation had no update rule.** The module claimed a device
  refuses a non-super-sequence but implemented no such check, and
  `isKeyRevoked` answered from unverified lists. Fix: added
  `isRevocationListExtension` (both sides verify, the candidate keeps
  every accepted entry first and in order) and made `isKeyRevoked`
  verify before answering, with tests for extension, shortening,
  reorder and tampered reads.

### P2 — fixed

- **XAF-4: the model-relay ledger settled a retried attempt twice.**
  Fix: `settleModelRelayUsage` settles one attempt once (returns the
  ledger unchanged on a repeat), with a regression test.
- **XAF-5: TOTP verified codes against degenerate secrets.**
  `decodeTotpSecret` returned an empty key for too-short input.
  Fix: refuse empty decodes, with a regression test.
- **XAF-6: SAS stretched an empty pair secret.** Fix: refuse it loudly,
  with a regression test.
- **XAF-7: relay refusal accounting lied.** `rejectedConnections`
  counted only ceiling refusals, and the connection ceiling destroyed
  the socket without saying why. Fix: every refusal counts and every
  refusal is said, including `relay is full` at the ceiling.
- **XAF-8: the relay hung its own close after a ceiling refusal.**
  An untracked refused socket (no data handler) wedged
  `server.close()`; reproduced with raw `node:net` first. Fix: every
  accepted socket is tracked and drained from accept, and
  `relay.close()` destroys them all. Regression: the ceilings test
  closes cleanly.
- **XAF-9: the relay client dropped sends silently and misnamed a
  refusal.** Fix: `send` returns false on a dead wire, and a
  registration answered for another node says so.
- **XAF-10: a poisoned frame reader answered again.** Fix: the first
  oversize/unparseable verdict latches. Also: keepalive on both relay
  ends (OS timings, no timer of ours), closing targets report
  unreachable, and the proxy header contract is documented.

### Accepted residuals (no code change)

- Unseal grants are bearer credentials over the sealed pair channel;
  replay needs pair-key compromise. Lane N's store should burn used
  grants; recorded as an N-integration requirement.
- SAS binds the pair secret but not the speakers' names; the spoken
  digits ceremony is the authentication. Ceremony misuse is a
  people-layer residual, named in the threat model.
- Relay registration trusts asserted node ids (first wins, loudly);
  a squatter denies relay service for one id until cleared. The E2E
  layers, not the relay, authenticate. Named in the threat model.
- TOTP padding-bit laxity fails closed (wrong key, codes refuse).
- Password KDF parameters ride with the stored hash; rewriting them
  needs the node's owner-only store, i.e. the node itself.
- sign/verify throw on structurally invalid keys instead of returning
  false; keys are schema-checked at pairing, so only a programming
  error reaches that shape, and it stays loud.

## Verdict

All findings fixed with regression tests; the touched suites pass
(nodePairingSecurity 10, nodeRelay 5, nodeRemoteReach 4 including the
brokered-use cases, nodeSignin 10, nodeOrchestrator 5 including the
model-relay ledger), and the lane's full gate list is in `rlm110c.md`.
The residuals above are the reviewed remainder: each is named,
bounded, and owned by the phase that retires it.
