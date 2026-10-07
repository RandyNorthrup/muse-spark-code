# M104PD requests to shared-file owners

2026-10-06, Windows 11 rig, base `74b99c4a0`, branch `m104/pd`.
These are integration requests, not edits to another lane's files.

| Owner | Concrete request                                                                                                                                                                                                                                                                                                                                                                                 | Validation / status                                                                                                                                                                                          |
| ----- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| A     | Include `test/m104/**/*.test.{ts,tsx,mjs}` in the ordinary Vitest config (and the appropriate test tsconfig). Current config includes only unit/e2e.                                                                                                                                                                                                                                             | Run a deliberately failing Windows namespace test through the normal config, then restore it and run the suites at the repository default deadline. Pending.                                                 |
| F     | Add this lane's scope and aggregate-gate deferral to PLAN M104/§7; update CHANGELOG `[Unreleased]` and README native status once each checkpoint lands. No support promotion from component tests.                                                                                                                                                                                               | Link `m104-pd.md`; full quality is explicitly reserved to the lead by the rig/common brief. Pending.                                                                                                         |
| A/F   | Retain the reviewed MHP 1.2 replacement ruling and legacy snapshot filenames in documentation. Visual Studio now consumes the panel-inclusive `mhp-v1.1.schema.json`, which advertises 1.2.                                                                                                                                                                                                      | Native schema equivalence and old-version refusal tests. In progress.                                                                                                                                        |
| C/A   | Supply the integrated per-kind renderer/binding for `whatsNew`, `models`, `traffic`, `settings`, `walkthrough` and `diff`, including runtime-owned What's New HTML/action indices and reload state. The frozen open request contains kind/placement/session only. Specify how native containers receive this content through the existing contract; no invented wire field or Chat substitution. | Native `surfaces` stays undeclared until the complete group and all placements are implemented. Chat/Tasks container and relay component tests do not qualify the other kinds. Pending integrated A/B/C tip. |
| F     | Supply the exact verified Windows Node/runtime inventory under native `assets/runtime`, including its pin, all lazy bundles, schemas and language tables. `src/runtime/nodeRuntime.json`, named in the brief, is absent at this base.                                                                                                                                                            | Installed VSIX must activate that exact artifact, then record each installed-host/backend/profile row. Current VSIX has portable assets and job helper but lacks Node/runtime, and refuses startup. Pending. |
| B/A   | Bind `commands/execute` to registered runtime actions and keep registration IDs stable for native menus/key bindings. Native `commands/register` and `ui/status` command dispatch now use the frozen methods.                                                                                                                                                                                    | Invoke a registered native menu/key/status action through the integrated runtime and reject unknown IDs. Pending.                                                                                            |
| F     | Update the help catalog/reference for native MHP 1.2 bootstrap, consent/menu parity and the explicit native distribution/auxiliary/trust gaps. This lane adds no VS Code command or setting.                                                                                                                                                                                                     | `node scripts/gen-reference.mjs` and `npm run check:reference`; describe component evidence without support promotion. Pending.                                                                              |

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

Final plain `npm.cmd run deadcode` exits 1 with five real Windows execution
entries missing from A's graph: `bootstrapFixture.mjs`,
`installedVscode.test.mjs`, `terminalHostServices.test.ts`, `vitest.config.mjs`
and `vscodeEntry.ts`, all under `test/m104/windows/`. Register their actual
entry relationships, including the C# process fixture and the separate required
installed-Windows job; do not ignore these files. The two existing configuration
hints (`vendor/**`, `axe-core`) are not changed by this lane.

F: regenerate and review `docs/ide-compatibility/host-api.md` with
`npm.cmd run check:host-api -- --write`. The final check exits 1 because this
F-owned source record still describes 349 APIs; the terminal adapter yields
353, adding native terminal disposal/argv/environment/close-event usage and
the new `node:crypto` reader. Then rerun the check without `--write`. No host API
gate or generated record is bypassed in this lane.

A/B: bind the frozen code-intelligence methods to the existing native language
driver through the integrated runtime, preserving virtual-resource identity and
file-operation refusal. The installed VS Code receipt now exercises real
TypeScript definition/reference/hover/symbol/rename answers through
`vscodeLanguageServices()`; that direct native-driver receipt does not qualify
the currently unbound in-process MHP `codeIntel` group. A's installed-Windows
job must load the test-only notebook contribution at
`test/m104/windows/notebookFixture` beside the product extension, as the suite
does now. No product manifest or provider capability was changed for this test.
