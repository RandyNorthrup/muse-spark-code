# RLF-HOSTS2 — real agents in every host suite, and the dropped A/B/C work

Lane `RLF-HOSTS2`, rig `linuxlt`, branch `rec/rlf-hosts2`. Base:
`rv/hostsland` `566143f3a` (RLF-HOSTSLAND plus RVHOSTS' peer-HTML seal).
Model attempts: **0**. Provider calls: **0**. Nothing pushed, rebased,
stashed or tagged. Production `node scripts/build.mjs --production`
exit 0; every suite below starts this tree's `dist/acp.js`.

## Inventory (2026-11-01, before any edit)

- The four shim suites (Emacs, Neovim, Zed, Qt Creator) still pass
  without the real agent, as RVHOSTS found: Emacs' child is `/bin/cat`,
  Neovim replaces `vim.system` and CodeCompanion, Zed and Qt Creator
  drive hand-written agent scripts, and Qt Creator's Lua suite doubles
  the Qt Lua API. Sublime has no suite at all.
- The real agent, probed with a scratch home and no credentials
  (`temp/probe-lsp.py`, `temp/probe-acp.py`, since removed): ACP
  `initialize` answers protocol 1 with `muse-spark-code-acp` 0.19.0;
  `session/new` refuses `-32000 authRequired` (no model call); LSP
  `initialize` answers its capabilities and `shutdown`/`exit` end 0.
- `supervise panel --companion`, which every shim's Panel command
  launches, is refused by this tree's CLI: `panel` accepts only
  `--stdio` (`src/runtime/cliOptions.ts` `PANEL_OPTIONS`). The loopback
  companion panel transport (M104 lane C) is not on int's contracts, so
  a shim's Panel command cannot succeed yet; the suites now prove the
  honest refusal and cleanup, and the transport itself is recorded in
  `docs/real-life/unproven.md`.
- `supervise` and `stop` refuse in this agent sandbox with
  `PrivateRootRefused`: `/` is uid 65534 here, and
  `verifyPosixAncestors` (`src/runtime/privateDirectory.ts`) admits
  only root or the caller. Proved by a diagnostic driver over
  `dist/supervise.js` (thrown stack, temp only). No workaround was
  built; supervised legs are written for a normal machine and named
  blocked here for the lead to run outside the sandbox.
- Dropped pieces, measured against this branch: lane A's
  `assemblePanelGit`/`gitEntry.ts` (this branch has lane B's
  `openPanelGit` wired in `panelSession`); lane B's
  `window/didChangeTheme` (initialize already carries `theme`; no
  notification, no relay); lane C's `attachments/*` (the companion
  adapter `src/runtime/companion/nativeAttachments.ts` exists but has
  no caller, and `MHP_METHODS` has no `attachments/` or `questions/`
  entry). MHP here is `mhp/1.5.0`; C moved it to 1.5.1, B to 1.6.
- WebKitGTK 4.1 is installed on this rig (`libwebkit2gtk-4.1.so.0`),
  so Eclipse's browser tests are runnable here after all.

## Done

(nothing yet)

## Waiting

- **Visual Studio**: the lead's Windows PC. **Xcode**: the Mac mini.
- **Supervised legs on this rig**: the sandbox private-root refusal
  above; the lead runs them outside the sandbox.

## Red/green drills

## Gates
