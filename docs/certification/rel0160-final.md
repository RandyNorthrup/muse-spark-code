# REL0160B final release candidate — 2026-10-07, macmini

The revised rig brief replaces further local full qualification with hosted
CI on Windows, Linux and macOS. This record covers the authorized final
continuation from `434303f7b`, the pending ACP notice repair and the two
explicit `--no-ff` merges. No branch was pushed, rebased or published; no
credential was read and no live or paid model call ran.

Commits before final certification:

- `126de64b2`: finish the nine pending notice/SBOM, regression and evidence files.
- `d360364ea`: merge `main-0150` at `c22be5d0d`, retaining released 0.15.0 and CI repairs.
- `a2346e57a`: merge `int/0160-ux` at `d7837b659`, retaining pinned questions and agent outcomes.

All commits ran the repository's normal lint-staged and gitleaks hooks.
Hook rejections were repaired: move the ACP help worker declarations after
native-stage refusals; use a switch to narrow item lifecycle events without
violating the repeated-comparison lint rule. No hook or gate was altered.

The manifest and both lockfile root versions remain 0.16.0. README has one
0.16.0 section, its correct contents anchor, and Earlier in 0.15.0. CHANGELOG
places 0.16.0 above 0.15.0, with five Highlights for M106, M107, pinned
questions and outcomes. Explicit pending upstream notes stay under Unreleased.
All fourteen translated tables retain the union: 2,714 keys apiece.

## Conflicts and their resolutions

The first merge had 15 conflicted paths; the second had 31. The JSON receipt
lists every path. The rows below account for all of them.

| Paths                                                                                                         | Resolution                                                                                                                                                                         |
| ------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| CHANGELOG.md (both merges)                                                                                    | Keep both trains' entries; promote shipped preparation/UI fixes into 0.16.0, retain pending notes and the released 0.15.0 section.                                                 |
| PLAN.md (both merges)                                                                                         | Keep milestone, gate, escape-hatch and qualification records from both sides; reattach the release scope to its own milestone and record the revised brief.                        |
| docs/orchestration-gotchas.md                                                                                 | Keep the released numbering and new G34–G52 rows, plus resource gate-fire evidence. Retain the lane's input-drift lesson as G53, avoiding a duplicate G28.                         |
| docs/research/makers-2026-10-05.md; docs/research/makers-printers-cnc-2026-10-05.md                           | Keep the incoming equivalent explicit non-TLS WebSocket wording and existing source links.                                                                                         |
| media/readme/question.png                                                                                     | Accept the released deletion of the floating-card capture; the UI merge restores its newer pinned-card capture.                                                                    |
| scripts/sast.mjs                                                                                              | Keep the incoming explanation and unchanged single-worker invocation.                                                                                                              |
| src/runtime/companion/page.ts                                                                                 | Retain encoded inert recovery data and DOM text installation; also retain the incoming HTML encoder for the language attribute.                                                    |
| test/e2e/execStdio.e2e.test.ts                                                                                | Keep one private production build, scripted public-image transport and package preparation from the released CI repair; retain v2 schemas, exact money and native-helper fixtures. |
| test/unit/checkSlots.test.ts                                                                                  | Retain shared immutable Git preparation and all six independent descendant/transport-failure cases.                                                                                |
| test/unit/companionBrowser.test.ts                                                                            | Union hostile-translation coverage with the fixed credential clock, context-first bounded teardown and existing real-browser deadline.                                             |
| test/unit/journalStore.test.ts                                                                                | Use the shared prepared cold journal and cleanup; retain 60,000 records, zero warm rereads and the 300 ms ceiling.                                                                 |
| test/unit/modelApiHost.test.ts                                                                                | Use prepared reviewer-journal setup and teardown; retain exact USD at admission and numeric projections only in reporting assertions.                                              |
| test/unit/runtimeChatGptPackage.test.ts                                                                       | Read every bundle from its owned production build and retain the real badge validator with scripted image bytes and every required native fixture.                                 |
| test/unit/teamHarness.test.mjs                                                                                | Keep the isolated real publication inventory and incoming documented native-browser deadline.                                                                                      |
| docs/reference.md; src/shared/reference/reference.generated.json; src/shared/reference/reference.generated.ts | Regenerate using reference:generate from the composed source; do not hand-merge generated data.                                                                                    |
| l10n/ui.*.json (14 files)                                                                                     | Three-way union of keys and changed translations. Keep resource commands and add the technical /agents command to the existing translated ACP description.                         |
| media/readme/help.png; media/readme/open-question.png                                                         | Take the newer incoming captures. Other README images are retained because no plainly stale capture was identified.                                                                |
| src/acp/agent.ts                                                                                              | Keep resource and /agents commands together and reserve both names against skill shadowing.                                                                                        |
| src/core/backends/modelapi/ModelApiHost.ts                                                                    | Union subscription types, resource leases/stops and agent evidence; keep both steered-input promotion and terminal budget evidence. Remove one duplicate redactor import.          |
| src/core/backends/modelapi/sessionStore.ts                                                                    | Keep historical numeric-fee parsing at the disk boundary alongside owned agent evidence and changed-file schemas.                                                                  |
| src/core/backends/musecode/MuseCodeHost.ts                                                                    | Retain lifecycle/deletion methods and add captured child output reads as a separate method. Narrow lifecycle item events with a switch so preview events retain their own type.    |
| src/shared/agentEvents.ts                                                                                     | Keep argument previews and owned agent/workflow evidence outside MSP's wire fields.                                                                                                |
| src/shared/featureCatalog.ts; src/shared/reference/referenceSource.ts                                         | Keep resources and agent outcomes as separate features/surfaces; retain the complete pinned/deferral question description.                                                         |
| src/webview/components/ToolRow.tsx                                                                            | Keep lazy tool bodies and argument previews; use the pinned question marker and remove the obsolete inline elicitation body.                                                       |
| test/fixtures/golden-requests/06-subagent-child.json                                                          | Regenerate normal and strict fake captures through the existing explicit golden-update mode; only the two child fixtures change.                                                   |
| test/unit/Transcript.test.tsx                                                                                 | Keep the unfurled Answer marker and assert the interactive radio is absent from the transcript.                                                                                    |

## Bundle repair and regression drill

The first combined build refused surface English at 25.3/25 KiB. Resource-only
English already has an independent loader. Select only the ordinary surfaces'
actual readers for their fallback, preserving shared keys, the full canonical
table contract, independent resource loading and Windows path separators.
The repaired build measures 24.8/25 KiB. Other relevant measures are activation
509.0/600 KiB, Model API 488.7/525 KiB, chat startup 735.4/900 KiB and original
deferred chat 32.1/50 KiB. Every existing size, split and host-global gate passes.

The browser fallback test loads Help before resources, proves resource-only
English remains unloaded, then verifies every browser English value and the
installed German language after both loaders. Deliberately selecting all deferred
keys fails that assertion (exit 1); the restored script's SHA-256 equals its
original `399bc00df13c9c3ceea7f3854115f0615216781c7568300e9eb83bf6ab5b2a8d`.
The earlier pending notice repair's three recorded red/restored drills remain
in rel0160-rebuild-ci.json; all 25 affected tests passed again before its commit.

## Startup baseline repair

The whole-file bundle test then rejected 753,053 startup bytes against its
unchanged 733.8 KiB review baseline, even though the 900 KiB production cap
passed. The source-based fallback discovery visited optional formatting in
shared eager modules. Move paid count formatting into PaidUsageSection and
put the unchanged owned evidence schemas in agentEvidence.ts, separate from
agent presentation helpers. The existing failure was observed before the
repair; the complete webviewBundle, agentOutcome and AgentMap files then
passed (82 tests). Startup is now 750,439 bytes (732.9 KiB). No threshold,
assertion, timeout or validation shape was relaxed.

## Verification and remaining qualification

All requested fast gates ran locally. The 36-file owning sweep used at most
three files per invocation, maxWorkers=3 and repository timeouts. Its one
startup-baseline failure was repaired and the whole owning file passed again.
The receipt retains the original failure instead of overwriting its evidence.
Reference, host API and frozen exec schemas were regenerated with their scripts.
Full quality, hosted Windows/Linux/macOS gates and live release receipts remain
with the lead and CI; this lane neither publishes nor calls a live model.

## Lead amendment

The brief's 17:10 amendment also requires main-0150 at 18dc73651 after the
already completed c22be5d0d merge. Retain the bundle-ready browser harness,
bounded readiness diagnostics, test coverage and Windows repository default
deadlines from PR #139, together with this lane's owned publication inventory.

The amended merge had five conflicts: CHANGELOG and PLAN retain both releases'
records; PLAN's hosted-CI escape table adds only the new Windows default row.
The harness combines the ready handshake with the retained signed-in composer
selector (a transient sign-in gate does not satisfy readiness). harnessWaits
retains both handshake/load orders with that selector; teamHarness unions the
incoming bounded diagnostics with the lane's owned publication inventory.

## Final lossless packing and isolated reruns

After deferring the optional labels, teamHarness's real size-gate test exposed
surface English at 25,703 bytes versus 25,600. Compare native DEFLATE options
on the actual fallback payload: memory level 7 retains level 9 compression
and the same decoder, saving 170 compressed bytes versus memory level 9.
Pin it as a build-only constant. This is a lossless encoding change.

One exploratory batch mistakenly combined teamHarness and webviewBundle,
both of which rebuild the same dist directory. It passed the size cap but
failed five inventory assertions as one file deleted records the other used.
That batch is excluded from final verification. Rerun these files sequentially;
the complete bundle/fallback files pass 47 tests, including canonical values,
installed-language behavior and both unchanged size limits.

The initial owning sweep covered 36 files / 1,894 cases. Final whole-file reruns
repair the recorded baseline and size failures; no test is filtered or skipped.
The amended readiness/paid-usage batch also ran harnessWaits and UsageApp whole
files successfully. No CLI timeout override was used in any final invocation.

Package inventory preparation uses the actual ACP packer and retained native
artifacts. Its public badge-image transport uses the repository's existing
scripted fixture, while the real validator and hashes run. This does not
certify a fresh public-image network fetch. Notices and both CycloneDX SBOMs
are regenerated from the resulting physical stage and contribution metafiles.

All sequential final commands passed. The amended team harness passes 23/23;
final chat startup is 732.5/900 KiB and below the 733.8 KiB review baseline,
general deferred English 24.9/25 KiB, original deferred chat 32.1/50 KiB.
The production size, split, host-global and notices checks all exit 0.
The actual ACP package and its 44 package self-checks pass. Extension notices
contain 88 package names, staged ACP notices 35; CycloneDX inventories retain
86 extension and 48 ACP dependency versions, including native optional lanes.
The package and SBOMs are generated ignored artifacts, available under dist;
CI regenerates them from the committed inputs. No artifact is published.

Full format:check and lint passed before the final source composition repairs;
subsequent changed files run normal ESLint/Prettier hooks. The complete five
project typecheck passed after the schema/presentation split. Localization,
reference, host API and production build were rerun after the final packing
change and passed. The amended test-only readiness changes are tested whole-file.
The receipt preserves these phases without claiming another full quality run.
