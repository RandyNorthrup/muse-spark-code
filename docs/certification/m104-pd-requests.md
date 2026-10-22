# M104PD requests to shared-file owners

2026-10-06, Windows 11 rig, base `74b99c4a0`, branch `m104/pd`.
These are integration requests, not edits to another lane's files.

| Owner | Concrete request                                                                                                                                                                                                                                                                                                                                                                                 | Validation / status                                                                                                                                                                                                                                    |
| ----- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| A     | Register ordinary `test/m104/**/*.test.{ts,tsx}` files in unit discovery and the appropriate test tsconfigs; register the installed Windows `.test.mjs` suite in its required native job and Knip graph. Current config includes only unit/e2e.                                                                                                                                                  | Make a deliberately failing Windows namespace unit test fail through ordinary discovery; separately require the actual installed editor and fixture contribution for the Windows job. Restore and run both with repository default deadlines. Pending. |
| F     | Add this lane's scope and aggregate-gate deferral to PLAN M104/§7; update CHANGELOG `[Unreleased]` and README native status once each checkpoint lands. No support promotion from component tests.                                                                                                                                                                                               | Link `m104-pd.md`; full quality is explicitly reserved to the lead by the rig/common brief. Pending.                                                                                                                                                   |
| A/F   | Retain the reviewed MHP 1.2 replacement ruling and legacy snapshot filenames in documentation. Visual Studio now consumes the panel-inclusive `mhp-v1.1.schema.json`, which advertises 1.2.                                                                                                                                                                                                      | Native schema equivalence and old-version refusal tests. In progress.                                                                                                                                                                                  |
| C/A   | Supply the integrated per-kind renderer/binding for `whatsNew`, `models`, `traffic`, `settings`, `walkthrough` and `diff`, including runtime-owned What's New HTML/action indices and reload state. The frozen open request contains kind/placement/session only. Specify how native containers receive this content through the existing contract; no invented wire field or Chat substitution. | Native `surfaces` stays undeclared until the complete group and all placements are implemented. Chat/Tasks container and relay component tests do not qualify the other kinds. Pending integrated A/B/C tip.                                           |
| F     | Supply the exact verified Windows Node/runtime inventory under native `assets/runtime`, including its pin, all lazy bundles, schemas and language tables. `src/runtime/nodeRuntime.json`, named in the brief, is absent at this base.                                                                                                                                                            | Installed VSIX must activate that exact artifact, then record each installed-host/backend/profile row. Current VSIX has portable assets and job helper but lacks Node/runtime, and refuses startup. Pending.                                           |
| B/A   | Bind `commands/execute` to registered runtime actions and keep registration IDs stable for native menus/key bindings. Native `commands/register` and `ui/status` command dispatch now use the frozen methods.                                                                                                                                                                                    | Invoke a registered native menu/key/status action through the integrated runtime and reject unknown IDs. Pending.                                                                                                                                      |
| F     | Update the help catalog/reference for native MHP 1.2 bootstrap, consent/menu parity and the explicit native distribution/auxiliary/trust gaps. This lane adds no VS Code command or setting.                                                                                                                                                                                                     | `node scripts/gen-reference.mjs` and `npm run check:reference`; describe component evidence without support promotion. Pending.                                                                                                                        |

Additional concrete requests:

- A: register `test/m104/windows/installedVscode.test.mjs`, its
  `vscodeEntry.ts` built entry and the lane-local `vitest.config.mjs` in the
  central test/dead-code graph as actual entries, alongside the namespace
  include. No ignore or gate reduction. The lane-local config runs Windows
  suites meanwhile; plain knip must see the same reachable graph.
- A: include `test/m104/windows/bootstrapFixture.mjs` as a real process
  entry; the native theme suite executes it from C# over private standard
  input. This is executable test code, not an unused file or an ignore.
- A/C: define the existing-contract route for metadata refresh after a native
  host theme changes. Current initialize carries its actual theme once; the
  native page now applies all four initial kinds and mapped CSS tokens.
  Installed theme-switch/reconfiguration receipts remain open.
- A/F: bring the help-reference machinery onto this base.
  `src/shared/featureCatalog.ts`, `scripts/gen-reference.mjs` and the
  `check:reference` npm script are absent at `74b99c4a0`.
  `npm.cmd run check:reference` was attempted and fails with Missing script.
  No replacement or weakened check was added.
- A/F: register the installed Windows suite in the required installed-host
  Windows job, with the explicit editor/version artifact; register the terminal
  unit suite in ordinary namespace discovery. The actual editor receipt is not
  a portable fake test. Require the real prerequisite rather than skipping or
  silently substituting an editor.
- B/A: provide the reviewed native OS-terminal fallback for Visual Studio's
  undeclared terminal group. VS Code implements all three frozen terminal
  methods, with scrubbed child environments and ownership cleanup; it adds no
  new command/setting. Run the same F23/F37 scenarios on both native routes.
- F: include those terminal behaviors in the feature catalog/reference and
  aggregate documentation. Native Visual Studio metadata reads the executable's
  exact product version; `DTE.Version` reports only the compatibility moniker
  `17.0` for this installed 17.14 build.

No new translation key or shared schema field is requested at this checkpoint.

## Continuation after A integration (`82aaaae9a`)

MHP 1.3 replaces 1.2 in the integrated contract. Windows native readers,
fake-runtime compatibility fixtures and panel markers adopt it. Native
presentation relay readiness/reload and payload-group isolation now pass;
auxiliary containers/placements/HTML remain unimplemented, so `surfaces`
remains undeclared. Historical 1.2 requests above describe prior checkpoints.

A: central Windows namespace discovery and actual-entry Knip registration
remain absent after integration. Include the Windows namespace in the owning
graph and require the separately installed Windows suite, its test-only
notebook contribution and its production bootstrap process fixture.

F: record checkpoint 7 and the authorized A merge in aggregate documentation,
including MHP 1.3 replacement, unchanged support status and lead-owned full
quality. Regenerate the host API record after all Windows continuation
checkpoints. The exact Node/runtime distribution still blocks installed
Visual Studio assembly. Help catalog/reference machinery remains absent.

Checkpoint 8 advances the VS Code native adapter's complete nine-method
`codeIntel` group and formatting plans. The installed Windows run now exercises
B's runtime factory through those validated native methods with 13 receipts
and zero model attempts. Previously unobserved rename target versions refuse;
support for such targets needs a separately reviewed observation policy,
not versions sampled after the rename provider finishes.

A: include `test/m104/windows/codeIntelHostServices.test.ts` with the other
Windows execution entries in ordinary discovery and Knip. The lane-local
configuration preserves every shared setup, assertion and default deadline.

A/B: the runtime code-intelligence factory's `libraryRoots` default remains
empty. The native VS Code driver can supply its real extension/library roots
in-process (used by the installed receipt), but MHP 1.3 has no corresponding
native roots method. Preserve explicit library-path refusal until an owning
reviewed contract supplies it; no new field is invented here.

F: update aggregate F9/F30 evidence, help/reference and CHANGELOG with this
binding and its installed-vs-component limits. Native Visual Studio's complete
`ui`, `commands` and `diagnostics` groups are now undeclared because 1.3's
file/settings UI, `commands/run` and version-attested settled diagnostics are
unimplemented. Existing WPF/menu/Error List components remain present.
Requalify those groups only with their actual new methods and native receipts.

Final plain `npm.cmd run deadcode` exits 1 with seven real Windows execution
entries missing from A's graph: `bootstrapFixture.mjs`, `callHierarchyPaths.test.ts`,
`codeIntelHostServices.test.ts`, `installedVscode.test.mjs`,
`terminalHostServices.test.ts`, `vitest.config.mjs`
and `vscodeEntry.ts`, all under `test/m104/windows/`. Register their actual
entry relationships, including the C# process fixture and the separate required
installed-Windows job; do not ignore these files. The two existing configuration
hints (`vendor/**`, `axe-core`) are not changed by this lane.

F: regenerate and review `docs/ide-compatibility/host-api.md` with
`npm.cmd run check:host-api -- --write`. The final check exits 1 because this
F-owned source record still describes 349 APIs; the terminal adapter yields
353, adding native terminal disposal/argv/environment/close-event usage,
code-intelligence API use sites and the new `node:crypto` reader. Then rerun
the check without `--write`. No host API
gate or generated record is bypassed in this lane.

The earlier A/B native code-intelligence binding request is resolved at
checkpoint 8: all nine methods now use the native driver and the actual-editor
receipt crosses B's runtime factory and the validated MHP boundary. The
library-root and unobserved rename-target policies above remain open.
A's installed-Windows
job must load the test-only notebook contribution at
`test/m104/windows/notebookFixture` beside the product extension, as the suite
does now. No product manifest or provider capability was changed for this test.

A: also register the new executed
`test/m104/windows/callHierarchyPaths.test.ts` in the same central namespace and
Knip entry graph. It adds Windows separator/casing and POSIX case-preservation
regressions without modifying shared mocks or central configuration.

## Continuation checkpoint 9 (RVM104PD fixes)

B (with A for `CODE_INTEL_MODEL_TEXT`): the VS Code call hierarchy no longer
guesses the first of several provider items. When none is declared at the
position in the asked document it refuses with `MHP_CALL_HIERARCHY_AMBIGUOUS`
(`invalidParams` over MHP; a plain error in process). `codeIntelTools.ts`
reports that as a failed call with the identifier. Map it to a
`CodeIntelRefusal` whose English model text says several functions share the
position and none is declared there, and names the next step (ask at one
declaration's own position), with a localized visible reason in all 14 tables.
No string is invented in this lane.

F: record checkpoint 9 in the aggregate documentation and CHANGELOG
(validator type arrays, per-channel panel faults, resolved path identity,
bounded request-id window). The installed Windows run still needs the Win11
VM's VS Code 1.139.1 at `C:/Program Files`; it was not rerun for this
checkpoint. No new TS execution entry was added; the three new C# fixtures
are compiled by the existing `test/m104/windows/*.cs` glob.
