# M109 H runtime, ACP, headless and companion

MacBook Pro rig, `/Users/user/lanes/M109H`, branch `m109/h`, base
`8a151dd40`. Scope: D89.12's non-VS-Code rows; acceptance 10, 13 and 19.
Read D89 and M109, the research and lane-0 handoff, V1–V16 threat model,
shared lane rules and orchestration gotchas. Model attempts and paid calls:
zero. No credentials read. No dependency or machine setting changed.

The rig brief overrides common.md's historical merge/remote-test steps.
Run focused tests directly, at most three files and three workers, with the
repository's default timeout. The lead owns aggregate quality and integration.

## Integration contracts

- B's public protocol has status, lock, grants, audit and use answers, but
  no terminal item-management or pending-watch transport. H supplies a typed
  command port; B/C/M/S bind item entry, import and public-key operations.
- W supplies the installed `dist/vault.js` runtime factory through H's typed
  module contract. Missing or malformed bindings fail closed with a fixed
  localized error. No production fake or guessed private wire frame.
- U and M104 are absent on this base. H routes existing lane-0 value-free
  panel contracts through injected authenticated ports. Companion entry never
  receives values; native add/edit uses its own terminal.
- X/R bind headless engine uses to H's unattended session port. A denial
  ends exec independently of the ordinary `--fail-on-denial` setting.
- `featureCatalog.ts` and its generator are absent. W must register all
  terminal subcommands, `/vault`, and local exec `--vault` at integration.

## Progress

H handlers implemented. The five new focused files pass 106 tests at default
timeouts; changed-file ESLint and localization pass. Final scoped checks are complete;
75 red drills have named failures and exact restoration. Full M109 certification
remains open. Browser/visual editor matrix is a handoff: this rig has no Chrome;
H changes no React component, stylesheet or visual layout.

## Stopped verification path

H58's additional `FakeAgentHost.cancel` spy assertion failed initially and
again after two fixture changes: remove immediate completion, then hold the
fake turn open. Both runs still proved exit `denied` and one vault-session
close. common.md requires stopping a path after two failed fixes; no further
spy/production-cancellation rewrite was attempted. PLAN §7 records the
explicit deferral. H58 retains its denial/cleanup assertions. Actual backend
and feeder-tree stop must be checked with B/X's installed lifetime binding;
the pre-existing exec lifecycle regressions remain part of final verification.

## Threat controls and owner boundaries

| Threat                  | H proof                                                                                                    | Remaining owner proof                                                                                   |
| ----------------------- | ---------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| V1 injection            | H30/H52: taint excludes session/headless authority; metadata-only public frames                            | T provenance and B forced asks; X use routes                                                            |
| V2 process exfiltration | H9/H34: exact resolved use and process-exposure warning; H51 digest binding                                | X actual command identity, output scrub and tree lifetime                                               |
| V3 malicious MCP        | H41 rejects private/foreign frame kinds; approval shows whole use                                          | O audiences/rotation and T MCP taint                                                                    |
| V4 compromised host     | H31 binds editor answer to conversation/digest; H37/H45 fail on missing ports                              | B authenticated host/UI peers and P fresh presence                                                      |
| V5 foreign user         | Public bridge/management ports require a trusted authenticated binding                                     | B/P/M104 native peer, SID/uid and transport captures                                                    |
| V6 same-user malware    | H5 validates protection status without claiming hardware isolation                                         | C/P slots, presence and truthful tier banners                                                           |
| V7 memory               | H3/H20–H29: bounded owned buffers, private-byte cleanup and raw-mode restoration                           | C/P/B/X other owners; immutable JSON/base64 strings, native copies, swap and debuggers remain residuals |
| V8 clipboard            | H6 exports only the chosen SSH metadata public-key field; no clipboard API                                 | S public-key derivation and U clipboard check                                                           |
| V9 egress               | H5/H41/H59c reject value-shaped public fields and private exception text                                   | T scrubs every persisted/emitted text; B authenticates audit records                                    |
| V10 devices             | Public panel protocol cannot express private material or first-party reads                                 | R paired-device signature/code policy and transport                                                     |
| V11 replay              | H9–H15/H31/H35 bind id/digest, reject repeats, expiry and changed epochs/generations                       | B redemption/counters and C rollback                                                                    |
| V12 unattended          | H50–H59 require hard flag, headless role/workspace/conversation, grant ticket and exact digest; CI refuses | B grant scope/presence; X installed engine binding                                                      |
| V13 impersonation       | H31/H54 reject foreign conversation or wrong headless registration facts                                   | B authenticates the supplied registration; X private tickets and R worker sockets                       |
| V14 fill spoofing       | Approval text includes the whole parsed fill use; no H fill dispatcher                                     | L current origin/frame/certificate/field checks                                                         |
| V15 sudo swap           | H51 preserves and verifies canonical use digest; UI displays full command                                  | X realpath/executable checks, sudo capture and dispatch revalidation                                    |
| V16 concentrated vault  | H10/H35/H43 invalidate stale answers/results; lock preempts blocked panel work                             | B/C/P key erasure, epoch broadcast, idle/screen lock and lifetime termination                           |

The H tests prove these adapter controls, not OS isolation, cryptographic
storage, scrub completeness or the missing installed dispatcher. Private
terminal input is a project-owned JSON format, not a guessed service frame.
JSON/base64 strings cannot be reliably erased; owned byte arrays are wiped.

## Next integration slice

1. W binds `RuntimeVaultModule.createRuntimeVault` in installed `dist/vault.js`,
   installs the supplied `uiText`/`locale`, and includes the H surface/headless
   implementations in its own lazy budget. B/C/P provide authenticated command
   management/watch/private entry, S public-key derivation, M chosen-file import.
2. X supplies `ExecVaultPort.open`, registers the authenticated headless
   requester for the exact workspace/conversation, routes every engine use
   through `HeadlessVaultSession`, and closes that registration/lifetime from
   `ExecVaultSession.close`. Verify a real fake-child tree stops after denial,
   lock/revoke and late setup; H58's cancelled-spy deferral remains open.
3. U/M104 bind `VaultSurface` per authenticated connection, check its signal
   at effect commit, and close it at disconnect. Add/edit prepares the local
   terminal entry; values never enter a panel frame. Lock preempts prior work.
4. W registers the CLI/help, ACP `/vault`, local exec `--vault` and audit
   filters in `featureCatalog.ts` when that file lands, regenerates the stale
   host API record, then runs the joined-tree full quality and editor matrix.

Visual handoff: inspect ACP permission prompts and U's native/companion panel
in the actual editors and browser rig. No React component, CSS, visual layout
or styling changed here; this MacBook rig has no Chrome and the brief forbids
browser suites. Terminal prompt content and echo behavior are covered by the
real stream tests and the built CLI help inspection.

## Additional cleanup audit

The private-input audit found listener cleanup before the byte-erasure
`finally`. A throwing stream callback could skip raw-mode restoration and
leave a byte owner live. H23b now exercises that failure: each cleanup runs
independently, failed cleanup cannot transfer material, echo restoration still
runs and every owned array is erased. Late data cannot refill a finished
reader. H60 checks that a denial emitted from final port cleanup cannot change
an already finished run. Both controls get additional named red drills.

## Red drills

[Mutation receipts](m109-h-drills.json) contain **75 proved mutations**.
Every proved mutation ran a whole owned test file with `--maxWorkers=3` and
no timeout override, exited 1 with its named assertion, and restored matching
before/restored SHA-256 bytes in `finally`. Source and test hashes are recorded.
No test name filter or skip was used.

Controls cover public status/list/audit and bridge schemas, input size/base64/
prototype keys, byte erasure and echo/cleanup, standing consent, public-key
selection, watch replay/cap/epoch/expiry/id/digest/options, session permission
scope, headless registration/grant/digest/expiry/taint/flag/CI, late cleanup,
ACP session/generation/expiry and local slash routing, panel generation/lock/
egress, and installed factory path/sharing/language.

One exploratory mutation changed the late-setup refusal message instead of
the intended cleanup catch; its tests stayed green and it is recorded separately
as **not proof**. The corrected cleanup-catch mutation then failed H59c and
restored exact bytes. Two stale mutation anchors were corrected before their
proved runs; neither was a test execution or counted drill.

## Final verification (MacBook, Node 26.0.0 / npm 11.12.1)

| Check                                                                | Result                                                                                                                            |
| -------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| `npm run typecheck`                                                  | All five projects exit 0; unit refreshed after fixture deduplication, exit 0                                                      |
| Changed-file ESLint                                                  | All 18 TypeScript files exit 0; input/exec and deduplicated fixtures refreshed, no disables                                       |
| Changed-file Prettier                                                | All changed files pass; final docs are formatted by the commit hook                                                               |
| Owned H tests                                                        | 106 tests in five files pass, default timeout, zero skips                                                                         |
| Existing `execArgs.test.ts`                                          | 52 tests pass                                                                                                                     |
| Existing `acpAgent.test.ts`, `acpRuntime.test.ts`, `execRun.test.ts` | 185 tests pass, including pre-existing exec lifecycle scenarios                                                                   |
| Fake-only `acpStdio.e2e.test.ts`                                     | 10 tests pass through the built stdio agent                                                                                       |
| `execSchema.test.ts`                                                 | 26 tests pass; the version-1 contract is unchanged                                                                                |
| `node scripts/exec-schema.mjs --check`                               | Exec schemas match                                                                                                                |
| `node scripts/check-l10n.mjs`                                        | 14 tables, 164 manifest strings, 617 source files, zero problems; no new translation key                                          |
| `npm run deadcode`                                                   | Exit 0, only existing vendor/axe configuration hints                                                                              |
| `npx jscpd`                                                          | Exit 0, zero duplicate blocks; four new fixture clones were removed by sharing setup/owner collection without changing assertions |
| `npm run cycles`                                                     | Exit 0, 568 files, no cycles                                                                                                      |
| `npm run build`                                                      | Exit 0, budgets, split/readers, host globals and notices all pass                                                                 |
| `node scripts/check-host-api.mjs`                                    | Expected W handoff: stale inherited B/H Node import counts; host surface totals unchanged                                         |
| Commit hooks                                                         | ESLint/Prettier and staged Gitleaks enabled and pass                                                                              |

The 11 distinct test files above contain **379 passing tests**. Final owned
runs use at most three files and `--maxWorkers=3`; no `--testTimeout`, name
filter or test skip. Fixture deduplication retains the same assertions; the
mutation receipts identify the exact fixture revisions used for each drill.

Production sizes (KiB): extension **436.9/600**, Model API **446.8/475**,
checkpoint store **77.1/225**, ACP **844.0/850**, English fallback gzip
**50.4/125**, webview startup **897.9/900**, deferred webview JS **49.7/50**.
No cap changed. H has no activation import or visual bundle change. W must
budget its eventual `vault.js` implementations together, including the currently
unbound H surface/headless code.

Built CLI checks used an empty environment with PATH only (CI=true only for
the refusal check), so no credential variable was inherited:

- `node dist/acp.js vault --help`: exit 0; inspected the terminal grammar.
- `node dist/acp.js vault status`: expected exit 1, fixed broker-unavailable
  message, no values or profile paths; the installed factory is absent.
- `CI=true node dist/acp.js exec --vault --output=json task`: expected exit 7,
  version-1 `denied` result, zero requests and zero spend before backend startup.

No live model/platform/paid drill, dependency install, credential-file read,
provider sign-in, push, merge, rebase or global setting change. Full quality,
coverage, a11y and native/companion visual/process-stop certification stay with
the named integration owners under the brief. This is a local lane handoff,
not a release/support claim. The M109 checklist remains open in PLAN.md.
