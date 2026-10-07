# MACSLOW: 0.15.0 hosted macOS and slow setup

Rig: macmini, macOS, Node 24.21.0 / npm 11.19.0. Base `ccce6e6ac`, branch
`fix/0150-macslow`. Authority: `_ctx/MACSLOW.rig.md` and
`_ctx/codex/common.md`; hosted failure evidence: `_ctx/codex/CI0150-run3.md`
(run 37658021787). No dependency, timeout, retry, skip, budget, hook or
production security-policy change. No live or paid model call, credentials,
merge, rebase or push. All exec traffic uses the existing test-owned fetch and
keyring fixtures.

| Hosted failure                                                             | Cause and repair                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| -------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Unit typecheck heap exhaustion (Node 22.23.2, approximately 2,097 MB heap) | One TypeScript program retained 1,864 roots and the complete unit/source type graph. `scripts/typecheck-unit.mjs` reads the original config, checks source/support roots and four round-robin test groups in sequential compiler processes. All roots, strict options, ambient declarations and matcher augmentation remain; temporary configs inherit the original config and resolve types through the repository's unchanged node_modules. No heap override.                                                                      |
| Companion browser 5 s cases, 10 s teardown, closed-page request rejection  | Launching Chrome alone leaves the first renderer cold; navigation's load event is distinct from the authenticated document replacement. Warm one renderer before cases, keep one browser and fresh contexts, navigate to commit and observe `data-launch="ready"`, then assert the client marker. Every request/response observer and its trigger enter one `Promise.all`, attaching rejection handling before context cleanup. The foreign-server case closes only its own context, so a delayed cleanup cannot close another case. |
| Usage localization first case exceeds 5 s                                  | The case reran the complete pristine checker already warmed in file setup before validating its mutation. Save that real result and retain CLI parity; still check every changed file and all negative assertions. Reuse the immutable locale list instead of rebuilding it in packaged cases.                                                                                                                                                                                                                                       |
| Exec stdio cold package hook exceeds 60 s                                  | The hook combined a complete production build with cold packaging. Build the private immutable inputs exactly once during file setup; keep cold archive/native-export certification in its original 60 s hook and independent copies for every mutable package guard. The built-engine package retains its distinct real badge/image checks.                                                                                                                                                                                         |

The original complete three-file run passes on this rig (61/61, 104.75 s);
the hosted timing failures are taken from the named CI receipt, not claimed
reproduced locally. After the repairs the same complete files pass 61/61 in
103.69 s. Longest browser case: 1,154 ms; formerly slow first localization
case: 423 ms; longest localization case: 1,570 ms. Existing exec timeouts
(30 s cases, 60 s cold package and 300 s built setup) are unchanged.

Memory measured with `/usr/bin/time -l npm run typecheck:unit`, no heap flags:

| Program                                         | Peak RSS bytes | Wall seconds | Result |
| ----------------------------------------------- | -------------: | -----------: | ------ |
| Original single unit project                    |  2,767,564,800 |        43.47 | exit 0 |
| Five sequential programs, same configured roots |  1,688,055,808 |       101.70 | exit 0 |

Peak RSS is 39.0% lower (2.58 to 1.57 GiB), trading compiler time for a
bounded peak. Raw time receipts: [before](macslow/typecheck-before.txt) and
[after](macslow/typecheck-after.txt). Two initial implementation probes found
temporary-config ambient resolution and omitted global declarations/matchers;
the final checker preserves both. These probes are not passing evidence.

Deliberate controls (complete files, default deadlines, no test filters):

| Control                                                          | Observed failure                                              | Restoration                              |
| ---------------------------------------------------------------- | ------------------------------------------------------------- | ---------------------------------------- |
| Add invalid typed support root                                   | TS2322, exit 2 after 21.65 s                                  | Sentinel removed; checker hash unchanged |
| Add invalid new test sorted into the last partition              | TS2322, exit 2 after 110.38 s; earlier programs checked first | Sentinel removed; checker hash unchanged |
| Set browser client readiness false and suppress table validation | 7 failed / 10 passed in both complete files                   | Both SHA-256 hashes exactly restored     |
| Make the page trigger throw with a request observer pending      | 2 failed / 7 passed; no unhandled rejection or hook timeout   | Browser file SHA-256 exactly restored    |
| Add a newline to each packaged schema                            | 2 failed / 42 passed; committed schema-byte assertions fire   | Packer SHA-256 exactly restored          |

[Compiler controls](macslow/compiler-drills.json) and
[fixture controls with restored hashes](macslow/fixture-drills.json) retain the
exact results. Three clean repetitions and final static/build receipts are
pending the next verification step. Aggregate `npm run quality` remains
lead-owned under the shared rules; no aggregate result is claimed here.
