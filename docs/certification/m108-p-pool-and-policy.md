# M108 P — Pool and policy (macmini, 2026-10-06)

Worktree `/Users/randy/lanes/M108P`, branch `m108/p`, base `9cad21cb`.
Read the rig brief, shared codex/common.md, AGENTS, PLAN D88/M108 and Q-M108,
the account-terms research and the prerequisite lane certifications. The rig
brief overrides common.md's old merge/remote-run instructions: no merge,
rebase, push, credential access, network, live/paid calls or dependency install.

## Policy and local confirmation checkpoint

`confirmations.ts` uses a host-injected private machine store. Stored records
are parsed before use and bind machine, provider, product, record version,
check date and answer time. A digest covers the entire policy row, including
clauses, so a changed row asks again even without a version bump. Concurrent
interactive admissions share one question; headless reads existing records
only. Revoke invalidates held grants synchronously, fences pending answers,
serializes deletion after writes and refuses stale bytes even when deletion
is pending or fails. Store errors propagate; they never grant permission.

`policyGate.ts` enforces every bundled product row. Vendor-limit pooling asks
for `confirm` rows, while ordinary user caps remain available. One-per-person
rows require the full confirmation even at user caps. `ownCapsOnly` and
`cancel` cannot authorize vendor pooling. Unsupported/editor-owned products
and missing policy rows fail closed. Both documented subscription recoveries
come before any confirmation. The injected popup receives the original
clause, URL, source/check dates, translated prohibition/consequence warning,
legitimacy statement and the three exact answers. No vendor wire shape is
invented and no legal source is refreshed by this network-prohibited lane.

The base policy certification still requires its named signed-out xAI
browser verification; P does not claim to close that lane-0 release item.

## Initial receipts

Complete `confirmations.test.ts` and `policyGate.test.ts`: **42 tests pass**
with the repository default timeout and `--maxWorkers=3`. All five projects
in `npm run typecheck` passed at the policy checkpoint. Scoped ESLint,
Prettier and normal commit hooks are required at the checkpoint too.
Aggregate quality/unit/coverage and integrated editor/live certification
remain with the lead under the bounded rig brief; no gate or cap is changed.

## Executed policy/confirmation guard drills

Every mutation runs both complete owning files, with default timeouts and
three workers, exits 1 with a named test failure and restores the saved source
bytes in finally. Original/restored SHA-256 matches for every row.

| Deliberately broken guard | First named failing test                                                                                                            | Restored SHA-256                                                   |
| ------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| policy-confirm            | meta/model-api enforces its policy for vendor limits and user caps                                                                  | `a4962113de9cabfa919de747e04e31245ed4a8744f6037b4cf2632aa806f1a90` |
| one-person                | mistral/consumer-plan enforces its policy for vendor limits and user caps                                                           | `a4962113de9cabfa919de747e04e31245ed4a8744f6037b4cf2632aa806f1a90` |
| not-offered               | anthropic/claude-plan enforces its policy for vendor limits and user caps                                                           | `a4962113de9cabfa919de747e04e31245ed4a8744f6037b4cf2632aa806f1a90` |
| vendor-recovery           | offers each documented subscription recovery before the confirmation                                                                | `a4962113de9cabfa919de747e04e31245ed4a8744f6037b4cf2632aa806f1a90` |
| own-caps-only             | blocks vendor pooling after Only at my own caps and Cancel; keeps ordinary user caps                                                | `a4962113de9cabfa919de747e04e31245ed4a8744f6037b4cf2632aa806f1a90` |
| cancel                    | blocks vendor pooling after Only at my own caps and Cancel; keeps ordinary user caps                                                | `a4962113de9cabfa919de747e04e31245ed4a8744f6037b4cf2632aa806f1a90` |
| policy-current            | refuses unknown rows and changed rows while a question is open                                                                      | `a4962113de9cabfa919de747e04e31245ed4a8744f6037b4cf2632aa806f1a90` |
| machine                   | never carries a grant to another machine, provider or product                                                                       | `0f4e427a3e9838ff8ae2b8bb9848926bdee50f0094d6c25168fbf4158fb72e68` |
| provider                  | rejects a tampered machine, provider, product, version, check date or answer time                                                   | `0f4e427a3e9838ff8ae2b8bb9848926bdee50f0094d6c25168fbf4158fb72e68` |
| product                   | rejects a tampered machine, provider, product, version, check date or answer time                                                   | `0f4e427a3e9838ff8ae2b8bb9848926bdee50f0094d6c25168fbf4158fb72e68` |
| version                   | rejects a tampered machine, provider, product, version, check date or answer time                                                   | `0f4e427a3e9838ff8ae2b8bb9848926bdee50f0094d6c25168fbf4158fb72e68` |
| checked-date              | rejects a tampered machine, provider, product, version, check date or answer time                                                   | `0f4e427a3e9838ff8ae2b8bb9848926bdee50f0094d6c25168fbf4158fb72e68` |
| future-answer             | rejects a tampered machine, provider, product, version, check date or answer time                                                   | `0f4e427a3e9838ff8ae2b8bb9848926bdee50f0094d6c25168fbf4158fb72e68` |
| valid-clock               | rejects malformed stored records, future answers and invalid popup choices                                                          | `0f4e427a3e9838ff8ae2b8bb9848926bdee50f0094d6c25168fbf4158fb72e68` |
| clause-digest             | asks again when the policy row changes: {"sources":[{"quote":"changed clause","url":"https://example.test/terms","pageDate":null}]} | `0f4e427a3e9838ff8ae2b8bb9848926bdee50f0094d6c25168fbf4158fb72e68` |
| headless-read-only        | shares one concurrent question and headless never opens one                                                                         | `0f4e427a3e9838ff8ae2b8bb9848926bdee50f0094d6c25168fbf4158fb72e68` |
| question-deduplication    | shares one concurrent question and headless never opens one                                                                         | `0f4e427a3e9838ff8ae2b8bb9848926bdee50f0094d6c25168fbf4158fb72e68` |
| grant-revocation          | revokes immediately and refuses an answer from a revoked pending dialog                                                             | `0f4e427a3e9838ff8ae2b8bb9848926bdee50f0094d6c25168fbf4158fb72e68` |
| pending-revocation        | revokes immediately and refuses an answer from a revoked pending dialog                                                             | `0f4e427a3e9838ff8ae2b8bb9848926bdee50f0094d6c25168fbf4158fb72e68` |
| revoked-store-tombstone   | never rereads a revoked grant while deletion is pending or after deletion fails                                                     | `0f4e427a3e9838ff8ae2b8bb9848926bdee50f0094d6c25168fbf4158fb72e68` |
| write-order               | serializes revocation after an in-flight write and recovers after I/O failure                                                       | `0f4e427a3e9838ff8ae2b8bb9848926bdee50f0094d6c25168fbf4158fb72e68` |

## Named composition handoffs

- **P-W-POLICY-STORE:** compose one machine-owned `AccountConfirmations`
  service with private local storage and the owner/broker lifecycle. Its
  decisions and machine identity never enter a device offer or bridge input.
  Other windows/processes must receive revocation before their final fence;
  raw independent local stores are not a cross-process lock.
- **P-U-H-POLICY-UI:** panel/native bridges/companion and ACP/terminal supply
  the existing clause dialog through the injected ask port. Headless uses
  local records only. Wire the revocation command to `revoke`; preserve the
  recovery-first result and offer documented billing choices before retry.
- **P-W-DOCS-HELP:** W owns README/CHANGELOG/PLAN, the reference/catalogue
  (absent here), bundle wiring, release policy-age checks and editor receipts.
  Document default-on swap/parallel, local revocable confirmations, restrictive
  vendor terms and recovery-first behavior. No new UI, command or setting is
  published by this checkpoint and no untranslated string is added.

The pool, replay, paid binding and their final receipts follow in later
checkpoint sections. These modules are intended only for M95's lazy providers
bundle, absent on this base; no activation or webview import is introduced.
