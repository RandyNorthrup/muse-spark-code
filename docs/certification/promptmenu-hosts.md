# Composer prompt context menu across hosts

Lane PROMPTMENU2, 2026-10-06, macbook rig. Base `4ca230efc`
(`release/0.14.5`); branch `fix/prompt-menu-hosts`. No paid/model calls,
credentials, new dependencies, remote writes, merges or pushes.

## Host inventory and capability

`rg` over `src/` finds one production chat mount: `src/webview/main.tsx`
mounts `App`, and `App` mounts `components/Composer.tsx`. The VSIX adapters
`src/host/views/webviewSetup.ts` and `tasksPanel.ts` use `src/host/html.ts`.
The tasks document is read-only and has no composer. The browser harness in
`test/harness/index.html` renders the same chat bundle with a fake
`acquireVsCodeApi` and no VS Code contribution system.

Before this fix `HostBridge` exposed messages/state only; neither acquiring
the API nor the bridge distinguished the harness from a VSIX webview.
The VS Code HTML now supplies `data-native-context-menu="true"` on the body.
Without that capability, right-click on the input opens the existing lazy
Prompt library popover. Native panel hosts can set the capability only when
their own context menu supplies these actions. The shared component needs no
editor-name list, new transport envelope or model/backend change.

The VS Code family routes through the VSIX adapter: VS Code, VSCodium,
code-server, Cursor, Devin Desktop, Kiro and Positron. Eclipse Theia's VSIX
route also uses that adapter; its installed-host context-menu behavior was
not exercised on this rig. Existing `test/hosts/` install/conversation checks
are not claimed as new context-menu certification.

No companion server, JCEF/WebView2/SWT panel or MHP transport mounts this
webview on this base. `src/runtime/sharing/bridge.ts` is a local DTO/port
handoff, not a panel mount. `docs/ide-compatibility.md` and
`docs/ide-compatibility/hosts.md` explicitly retain M104 native/companion
mounting dependencies. ACP hosts (Zed, JetBrains AI Assistant, Xcode,
Neovim, Emacs, Sublime and Jupyter AI) own their chat UI and do not render
this composer. The TUI/desktop mount dependencies remain M110a0/M111.

## Behavior and clipboard

- Toolbar and fallback context menu use the same entries/callbacks. Save
  and Share require nonblank draft text and an available callback; Use
  requires its callback or the existing shared library binding. Save/Share
  receive the exact draft, including CRLF. No action submits a model turn.
- VS Code right-click remains native and is not prevented; no second menu
  opens. The toolbar remains available.
- The fallback menu anchors at client coordinates, clamps inside the
  viewport, and uses ResizeObserver to reposition when the viewport or menu resizes. Escape and selection close it and
  return focus to the input. The existing lazy loading/retry path stays.
- Shift-right-click dismisses the fallback without preventing the event,
  retaining the browser/host's own Cut/Copy/Paste menu. Keyboard clipboard
  actions retain their normal path. The validated `copyText` bridge is
  write-only; no input clipboard read/paste bridge exists. No clipboard
  rows or simulated successful clipboard operations were added. A future
  host with no native clipboard menu must bind its clipboard port before
  claiming those actions; that host does not exist on this base.
- Help & Reference describes both entry points and the clipboard gesture
  in English and all fourteen translated tables. README and changelog move
  with the behavior; generated reference files stay current.

## Verification

Owning suites and five TypeScript projects run directly in the worktree at
repository default timeouts, with at most three files/workers per Vitest run.
Final restored owning run: 106/106 pass, no timeout overrides or skipped tests.

The initial regression run failed five tests (context actions, context
empty-draft menu, clipboard escape setup and both pointer-placement tests),
with 87 passing. After implementation all three owning files passed:
`Composer.test.tsx`, `PopoverMenu.test.tsx`, `html.test.ts` — 106 tests.
`npm run typecheck` passed all five projects (host, webview, unit, e2e,
integration).

The reference/localization owning suites also passed in a separate three-file
run: `referenceGenerator.test.mjs`, `ReferencePage.test.tsx`, `l10n.test.ts` —
104/104. Total final tests: 210/210 across six complete files.

## Deliberate failures and byte restoration

Every drill ran its complete owning file with `--maxWorkers=3` and the default
repository timeout. Each exited 1 for the expected regression(s); the
original bytes were restored in `finally` and SHA-256 compared before/after.

| Drill                   | Deliberate break                                 | Observed failure                                                  |
| ----------------------- | ------------------------------------------------ | ----------------------------------------------------------------- |
| Native-menu guard       | Replace the document capability check with false | VS Code context event was prevented                               |
| Native document marker  | Set HTML capability to false                     | HTML's native capability assertion failed                         |
| Clipboard escape        | Remove Shift bypass                              | Shift context event was prevented                                 |
| Missing actions         | Remove empty-entry guard                         | No-action context event was prevented                             |
| Viewport clamp          | Use requested x without clamping                 | Left was 1020px instead of 784px                                  |
| Resize cleanup          | Remove observer disconnect                       | Unmount did not disconnect the observer                           |
| Optional pointer guard  | Remove the absent-anchor guard                   | All six original toolbar-menu tests failed on an undefined anchor |
| Vertical viewport clamp | Use requested y without clamping                 | Top was 760px instead of 618px                                    |

Restored hashes (all before/after identical):

- `Composer.tsx`: `247cbdf9b890c177c3f19ad5482473dd2f2fa01b51690acad13770db121f6e6c`
- `PopoverMenu.tsx`: `3222d0b48edf2677808529b4e70e97262e085088fd16fcb8cc5d15105f2fda24`
- `src/host/html.ts`: `c7fcca0fd6dea0aa2b205afa46213d95c26a350a2d41c3c9019e2b57063786e6`

The existing lint gate rejected a resize listener with layout reads and a
void-expression shorthand in the test; both were corrected. The mock observer
also follows the enforced class-member order. The viewport drill was repeated
on the corrected observer implementation, with the updated hash above.

Final restored complete owning files passed again, 106/106. The scratch logs
live in ignored `temp/` on this worktree; the table and hashes above are the
committed drill record.

## Static and build receipts

| Command                       | Result                                                                   |
| ----------------------------- | ------------------------------------------------------------------------ |
| `npm run typecheck`           | 0; all five projects, repeated after the observer correction             |
| `npm run lint`                | 0; full JS/CSS tree; PowerShell is the repository's existing Darwin skip |
| `npm run format:check`        | 0; final changed docs/fixture also checked after adding receipts         |
| `npx knip`                    | 0; plain invocation                                                      |
| `npm run duplication`         | 1; three inherited ACP fixture clones, deferral in PLAN §7               |
| `node scripts/check-l10n.mjs` | 0; all 14 tables, zero problems                                          |
| `npm run check:reference`     | 0; generated reference current, sharing inventory current                |
| `npm run check:host-api`      | 0; zero problems                                                         |
| `npm run build`               | 0; size, split, globals and notices gates all pass                       |

All existing caps remain unchanged:

| Bundle/closure                         | Measured KiB | Cap KiB |
| -------------------------------------- | -----------: | ------: |
| Activation                             |        443.2 |     600 |
| Model API                              |        447.4 |     475 |
| Checkpoint store                       |         77.0 |     225 |
| Chat startup, including static imports |        733.9 |     900 |
| Original deferred aggregate            |         32.1 |      50 |
| Popover menu                           |          2.4 |      25 |
| Node Help reference                    |         44.9 |     100 |

## Four-theme browser and visual receipts

`node scripts/a11y.mjs empty composer-grow composer-max prompt-menu
prompt-menu-narrow prompt-menu-toolbar modes attach` passed: 32 pages
(8 scenes × 4 themes), zero violations, zero undecided rules, zero exemptions,
zero missing results. Axe also reported 36 covered/offscreen contrast elements
not measured under the existing policy; no exception or ignore was added.

The new scenes use the viewport's real width, overriding the harness's fixed
690px document so the 320px scene tests the actual narrow composer. A separate
Playwright capture checked all three menu scenes in all four themes at 690px
or 320px × 673px: exactly the expected three rows, one menu, bounds inside the
viewport, Escape focus returned to the input, and Shift-right-click's event
remained unprevented. All four pointer-menu pages also passed a real resize to
320px × 400px. All twelve captured images were visually inspected: readable
labels/borders, compact menu, no clipped action or horizontal menu overflow.

| Theme               | Pointer                                           | 320px pointer                                            | Toolbar                                                   |
| ------------------- | ------------------------------------------------- | -------------------------------------------------------- | --------------------------------------------------------- |
| Light               | [Shot](promptmenu-hosts/prompt-menu-light.png)    | [Shot](promptmenu-hosts/prompt-menu-narrow-light.png)    | [Shot](promptmenu-hosts/prompt-menu-toolbar-light.png)    |
| Dark                | [Shot](promptmenu-hosts/prompt-menu-dark.png)     | [Shot](promptmenu-hosts/prompt-menu-narrow-dark.png)     | [Shot](promptmenu-hosts/prompt-menu-toolbar-dark.png)     |
| High contrast dark  | [Shot](promptmenu-hosts/prompt-menu-hc-dark.png)  | [Shot](promptmenu-hosts/prompt-menu-narrow-hc-dark.png)  | [Shot](promptmenu-hosts/prompt-menu-toolbar-hc-dark.png)  |
| High contrast light | [Shot](promptmenu-hosts/prompt-menu-hc-light.png) | [Shot](promptmenu-hosts/prompt-menu-narrow-hc-light.png) | [Shot](promptmenu-hosts/prompt-menu-toolbar-hc-light.png) |

## Brief step status

| Step                                                        | Status                                                                        |
| ----------------------------------------------------------- | ----------------------------------------------------------------------------- |
| 1. Host inventory/capability                                | Done; actual shared mounts and named dependencies recorded                    |
| 2. Composer fallback/clipboard/native guard                 | Done                                                                          |
| 3. Exact-draft actions, Escape/focus and deliberate failure | Done; eight byte-restored drills and default-timeout owning suites            |
| 4. Required checks/build/four-theme accessibility           | Blocked only by inherited ACP duplication; every other requested check passes |
| 5. Certification/changelog/reference/local commit           | Done; hooks on, explicit paths, local-only commit                             |

## Planning status and next slice

The unchanged duplication gate is an inherited blocker: three clones between
`test/e2e/acpRegistryAuth.e2e.test.ts` and `test/e2e/acpStdio.e2e.test.ts`
(8/18/8 lines, 50/94/52 tokens). Both source files are byte-identical to base
`4ca230efc` (verified against `git show HEAD:<path>`). No prompt-menu clone
was reported. Shared rules forbid unrelated refactoring; the justified
deferral is recorded in PLAN §7. Neither the ACP fixtures nor the gate are
changed. The lead must repair those fixtures before full quality is green.

This slice implements the shared-panel fallback and documents the absent
native/companion mounts. The lead's next slice is the inherited ACP fixture
duplication repair, release integration, full quality/hosted CI and
installed-host context-menu smoke, especially Theia.
M104 later binds the real companion/native mounts and their native-menu
capability; ACP/editor-owned UI is outside this React composer. Existing
M118 sharing phases and M104/M110a0 dependencies stay in the plan.

The brief and shared lane rules require targeted checks on this rig and
reserve full `npm run quality` for the lead. No gate, timeout, coverage or
bundle cap was weakened; full quality/installed-host evidence is not claimed.
