# M97 research — `/legal` (D76, planned)

Research date: 2026-10-04. Scope: design and existing-code inspection only.
No scanner, command, new dependency, production test or live/paid model call
is delivered. The owner's two requests are a read-only licensing/legal scan,
recommendations followed by authorized fixes, and copyright/header hygiene.
This record does not certify a repository as legally compliant.

## Existing tools: concepts, not copied implementations

| Source inspected                                                                                             | What it establishes                                                                                                                                                | M97 decision                                                                                                                                                                                                            |
| ------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [REUSE specification 3.3](https://reuse.software/spec-3.3/) and [tutorial](https://reuse.software/tutorial/) | Per-file copyright/license information can be in headers, adjacent `.license` files or `REUSE.toml`; `reuse lint` checks compliance with that specification.       | Honor those forms rather than insist every asset has a text header. A configurable optional header policy is not a claim of REUSE compliance. Generated-file header exclusion does not remove distribution obligations. |
| [Licensee: what it examines](https://licensee.github.io/licensee/what-we-look-at/)                           | Project-license detection considers common license files and selected package metadata; it does not by default audit dependencies or README declarations.          | Separate project-license matching, manifest/README consistency and dependency analysis; no one detector supplies all three. Modified/custom texts retain evidence and uncertainty.                                      |
| [ScanCode FAQ](https://scancode-toolkit.readthedocs.io/en/latest/getting-started/faq.html)                   | Data-driven license/copyright matching reports where evidence was found; structured manifests and binaries can supply evidence. Binary line positions have limits. | Keep evidence source, confidence and location. Keywords alone cannot prove provenance or infringement. No Python installation, copied matcher/database or claim of ScanCode-equivalent coverage.                        |
| [FOSSA CLI](https://docs.fossa.com/docs/cli)                                                                 | Dependency analysis can feed policy/reporting; its normal workflow uploads results to a service.                                                                   | Adopt evidence-to-policy-to-report separation, not hosted analysis, uploads, account provisioning or a paid-service dependency.                                                                                         |
| [ORT introduction](https://oss-review-toolkit.org/ort/docs/intro)                                            | Dependency analysis, source scanning, policy evaluation and notices/reporting are distinct stages.                                                                 | Distinguish declared from observed licensing and actual distribution. Use one small lazy scanner; do not embed ORT's downloader/pipeline or execute package managers.                                                   |
| [license-checker README](https://github.com/davglass/license-checker)                                        | npm license reports separate development/production packages; a marked license can be inferred from other files; unknown output is explicit.                       | Preserve evidence and unknowns, then reconcile build inputs. `dev` alone does not prove a dependency is absent from the distributed artifact. No tool installed or implementation copied.                               |

These are upstream documentation observations. D76's implementation choices
are our inferences; none of these tools guarantees legality or establishes
copyright ownership, trademark rights, privacy compliance or export clearance.

## SPDX: what can be vendored

The [official License List](https://spdx.org/licenses/) identifies licenses and
exceptions, including names, texts and matching references. Its live page and
[generated JSON](https://raw.githubusercontent.com/spdx/license-list-data/main/json/licenses.json)
reported version 3.29.0, released 2026-09-16, when inspected. It is not a list
of licenses automatically approved for every use. The
[SPDX FAQ](https://raw.githubusercontent.com/spdx/license-list-XML/main/DOCS/faq.md)
distinguishes expressions, exceptions, custom `LicenseRef` terms and permitted
matching variations. D76 preserves `AND`, `OR`, `WITH`, grouping, versions and
unrecognized evidence; no substring match invents a license.

**Yes, specifically licensed SPDX datasets can be vendored; “the whole list is
CC0” is too broad without identifying the artifact.** The identifier dataset
[jslicense/spdx-license-ids](https://github.com/jslicense/spdx-license-ids#license)
explicitly states CC0-1.0. The full-list redistributor
[sindresorhus/spdx-license-list manifest](https://raw.githubusercontent.com/sindresorhus/spdx-license-list/main/package.json)
also declares CC0-1.0 and includes a
[CC0 license](https://raw.githubusercontent.com/sindresorhus/spdx-license-list/main/license).
These are the respective maintainers' redistribution declarations, not evidence
that every upstream document, matching tool or license text has been relicensed.

The official [generated repository's licensing section](https://github.com/spdx/license-list-data#licensing-information)
points readers to the XML-source and publisher repositories rather than making
a blanket CC0 declaration. Its contents include licenses governing other works;
their terms do not become CC0 by appearing in the list. No authoritative blanket
grant for an entire XML/matching corpus was established in this research.

Current local `package-lock.json` independently records `spdx-license-ids`
3.0.24 as CC0-1.0, `spdx-exceptions` 2.5.0 as CC-BY-3.0 and
`spdx-expression-parse` 3.0.1 as MIT (development dependencies). Existing
transitive availability is not permission to add a production dependency.
Delivery must pin the exact data artifact/version/checksums, retain attribution
and modification notices required by that artifact, verify exception/matching
data separately, and record provenance in the package notices. Use minimal
verified data; custom/unmatched licenses stay unknown rather than silently
expanding into an unreviewed scanner database. No artifact is vendored here.

## Legal distinctions that affect the rules

- [Apache License 2.0 §4](https://www.apache.org/licenses/LICENSE-2.0) requires
  preservation of applicable notices and includes a conditional upstream NOTICE
  requirement; it does not mean every Apache dependency originated a NOTICE.
  Read the package's real license/NOTICE and inspect what ships.
- [Apache's GPL compatibility explanation](https://apache.org/licenses/GPL-compatibility.html)
  explains the direction of Apache-2.0/GPLv3 compatibility. A permissive project
  using GPL code is a distribution/combined-work obligation question, not
  categorical evidence of illegality. GPL version, linking/use, exceptions and
  the intended distribution must accompany a potential conflict. LGPL linking
  questions remain a review finding when the linkage evidence is missing.
- [Mozilla's MPL FAQ](https://www.mozilla.org/en-US/MPL/2.0/FAQ/) describes
  file-level copyleft and explicitly advises reading the license or seeking
  legal advice. Keep covered-file obligations separate from unrelated files.
- [Stack Overflow's licensing page](https://stackoverflow.com/help/licensing)
  identifies CC BY-SA 2.5, 3.0 and 4.0 according to contribution date. A copied
  snippet needs its source/date/author/license evidence; the scanner must not
  infer rights from a bare “Stack Overflow” comment or assume all snippets 4.0.
- SPDX `BUSL-1.1` means Business Source License, while `BSL-1.0` means Boost.
  Preserve the exact identifier and custom terms. Noncommercial, Commons Clause,
  SSPL and model/community terms need review against actual use, not an
  “open-source” label inferred from source availability.
- Copyright does not require an annual replacement of every old year, and
  legitimate upstream holders must remain. Required/optional/off is project
  header policy; a scan cannot infer rights or missing ownership from style.

## Existing project boundaries inspected

- `scripts/third-party-notices.mjs` uses production esbuild output inputs to
  identify actual contributing package directories, reads shipped license/NOTICE
  files and checks the rendered notice file. It also accounts for the bundled
  skill package and has separate ACP inputs. This is the distribution approach
  to reuse, not its project-specific permissive license allow-list as a legal
  oracle. Existing metafiles may be stale; scan must report that limitation and
  must not build/package merely to obtain evidence.
- `src/host/ide/ideMcpServer.ts` is authenticated loopback streamable-HTTP MCP;
  `src/host/ide/codeIntelTools.ts` exposes read-only tools using
  `MCP_ANNOTATIONS_READ_ONLY`. `conversationController.ts` supplies the `ide`
  endpoint only with the granted `sessionMcp` capability; `MuseCodeHost.ts`
  translates session MCP configuration. M97 uses this route, with actual
  scanner guards as well as annotations. No new MSP field is assumed.
- D69 records that `SessionConfig` cannot disable native tools and that an
  always-allow native command can run before cancellation in its reviewer
  session. A Plan-mode label or post-execution cancellation is therefore not
  sufficient proof of the entire explanation turn being read-only. D76 requires
  admission proof or refuses that optional turn while keeping the free scan.
- D68 supplies the bundled skill loader and an explicit Muse Code install;
  `/legal` must not rewrite the independently pinned high-quality-projects
  package or let a shadowing skill bypass scanner/fix authorization.
- `src/runtime/exec/execArgs.ts` currently validates ordinary headless prompt
  execution. D76 reserves `exec legal-scan --json` before that parse, making it
  deterministic and independent of credentials/backends. It is a planned
  command, not one asserted to work in this lane.
- `src/core/redact.ts` provides secret scrubbing. The existing
  `security:secrets` script invokes Gitleaks; there is no
  `scripts/scan-secrets.mjs` to call. Reuse the actual scanner/rules without
  adding an arbitrary subprocess or claiming regex redaction detects all PII.
  Privacy documentation lives at `docs/PRIVACY.md`.

## Plan defaults, remaining evidence and lane state

Defaults: offline deterministic scan, in-memory report, optional header policy,
no chosen license/holder, no automatic fix, disclosed opt-in registry queries,
one optional explanation turn. All 14 language tables and responsive,
keyboard/screen-reader accessible report behavior are delivery gates. No owner
setup or additional design answer is needed. Registry captures, exact matching
dataset redistribution proof/size and native explanation confinement are
implementation evidence gates; absence keeps that capability unavailable.

The user's worktree `C:/Users/Randy/Coding/muse-extension` supersedes the brief's
suggested `mx-legal` setup. The checkout initially held M93 staged documentation;
that lane committed it as `dc311d7e`, retained on `feature/m93-report`.
An incoming tracked test blocked integration: the existing untracked
`test/unit/handoffDialog.test.tsx` was zero bytes. Its byte-exact copies remain
under ignored `temp/m97-preserved/`; no content was discarded. A trial merge
was aborted because it also collided with the older M93 PLAN. M97 instead
starts from cached `origin/main` `1e93c67c`, as its brief originally specified;
M93 remains on its own branch. `integrate/m72-on-24ff` is absent locally; current
main's recorded M72 integration is used rather than inventing that reference.
No origin push, machine setting change, source implementation or gate weakening.

Windows: changed Markdown passes Prettier and `git diff --check`; commit hooks
run lint-staged serially and Gitleaks with no bypass. Mac mini snapshot
`cf93096468c1323ea58b56d1348138bbcc3e07c1` passes all five projects in
`npm run typecheck`, `npm run deadcode`, `npx --no-install jscpd` (0 clones),
`npm run check:l10n` (14 tables, 0 problems), `npm run check:host-api` (0 problems),
and `npm run build`; the serial command exits 0. Existing knip configuration
advice about `vendor/**` is a hint, not a failure; no ignore was changed. All 17
measured JS bundles meet unchanged caps, including extension 590.6 KiB,
Model API 430.1 KiB and ACP 800.9 KiB; split, host-global and third-party-notice
checks pass (83 bundled packages). Log: `temp/m97-research/rig-static.log`.
Final receipt prose changes only Markdown; product/build/test inputs are
unchanged from that snapshot.

ESLint/owning vitest and new guard drills are not applicable: no executable
file, test or gate changed. The brief delegates full `npm run quality`, CI and
installed-host gates to the lead; no aggregate or runtime certification is
claimed. M97's implementation checklist remains open. No blocker prevents
delivery of this plan; next step is lead review and Muse implementation in the
recorded lanes, with Codex review and the required failing drills/rig receipts.
