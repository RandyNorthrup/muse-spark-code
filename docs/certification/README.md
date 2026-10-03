# Certification records

- [SDK142](sdk142.md): Muse Code 1.4.1/1.4.2 fingerprints, CLI documentation corrections and regression drill; SDK stays 1.3.0.

[0.10.0 release preparation](release-0.10.0.md) tracks the current candidate
and the still-open checks for every distribution channel.

[PR #51 Android/Termux regression tests](pr51-termux-tests.md) records the
contributor test scope and resumed integration proof, separate from a real
Android installation or microphone certification.

One file per milestone, written when the milestone closed: the gate results
of that day, what was built row by row and which test checks it, the visual
verification, the test-fire proofs (every new check broken on purpose once,
the failing exit recorded, then restored) and the findings. They are records,
not living documents: a later milestone that changes a behaviour says so in
its own file and in PLAN.md, and the older file keeps describing its day.

Paths of the form `scratchpad/...` name evidence files (logs, probe scripts,
proof runs) that lived in the working session's scratch folder, outside the
repository; the facts they carried are quoted in the record that cites them.
The PNGs beside the records are that day's harness renders.

- [M0](m0.md): scaffold and gates
- [M1](m1.md): panel shell, message bus, keybindings, settings
- [M2](m2.md): authentication and the Muse Code (MSP) backend
- [M3](m3.md): composer and command palette parity
- [M4](m4.md): transcript rendering
- [M5](m5.md): editor integration
- [M6](m6.md): sessions, history, rewind
- [M7](m7.md): Meta Model API backend
- [M8](m8.md): account & usage, polish, packaging
- [M9](m9.md): voice dictation on the operating system's recogniser
- [M10](m10.md): workspace context: rules, skills and memory on both backends
- [M11](m11.md): production hardening (PLAN.md D14)
- [M12](m12.md): harness parity (PLAN.md D15)
- [M13](m13.md): verification fixes, process-level e2e, the rewind menu (PLAN.md D16)
- [M14](m14.md): subagents, the Agent map, the Account & Usage modal, choices as pickers, the banner, the compact button (PLAN.md D17)
- [M15](m15.md): the first F5 round: model warm-up, transcript scrolling, chevrons, response copy, outputs in the editor (PLAN.md D18)
- [M16](m16.md): the second F5 round: the pill's model, thinking rows, file links, Click to expand everywhere, the last usage window, the question card (PLAN.md D19)
- [M17](m17.md): reply to an output, ask about or comment on highlighted chat text (PLAN.md D20)
- [M18](m18.md): the verification round and the subagent orchestration it called for (PLAN.md D21)
- [M19](m19.md): issue #4, the prompt box auto-grows (PLAN.md D22)
- [M20](m20.md): rewind across subagents (PLAN.md D23)
- [M21](m21.md): security and confinement (audit section A, PLAN.md D24)
- [M22](m22.md): processes and lifecycle (audit section B, PLAN.md D25)
- [M23](m23.md): protocol and backend semantics (audit section C, PLAN.md D26)
- [M24](m24.md): editing correctness (audit section D, PLAN.md D27), with
  the context rows in [m24-context.md](m24-context.md)
- [M25](m25.md): the audit, webview and UI state (PLAN.md D28)
- [M26](m26.md): packaging, CI, platform and voice (PLAN.md D29)
- [M27](m27.md): the tree kill's orphans (PLAN.md D25)
- [M28](m28.md): macOS dictation asks under its own name; the release
  token's environment (PLAN.md D29)
- [M29](m29.md): `.muse/` is a protected path (PLAN.md D30)
- [M30](m30.md): skills, imports and export (PLAN.md D30)
- [M31](m31.md): MCP servers and hooks, read-only; PowerShell quoting (PLAN.md D30)
- [M32](m32.md): worktrees (PLAN.md D30)
- [M36](m36.md): rewind finds a hunk that only moved (PLAN.md D31)
- [M37](m37.md): the accessibility gate, WCAG 2.2 AA in four themes (PLAN.md D32)
- [M38](m38.md): "/" in the prompt: the palette, then slash commands (PLAN.md M38)
- [M39](m39.md): logging and performance you can see (PLAN.md M39)
- [M40](m40.md): the panel in VS Code's display languages, part a: the machinery and the gate (PLAN.md D33)
- [M33–M35](m33-m35.md): the paid features: web search, image generation and Muse Voice, opt in and loud (PLAN.md D30, D34)
- [M42](m42.md): replay as Meta validates it: commentary, reasoning summaries, reasoning-only turns, stream retries (PLAN.md D35)
- [M43](m43.md): a row for every tool Muse Code runs: memory, goals, scheduled prompts, web search, background work, pictures (PLAN.md D36)
- [M44](m44.md): images on both backends (the ide server with the key, a dialog per image) and image edits (PLAN.md D37)
- [M45](m45.md): session goals on both backends: the goal strip, `/goal`, Muse Code's verbs, the Model API's goal tools (PLAN.md D38)
- [M46](m46.md): background work and stop, the `!` user shell, explanations instead of answers, on both backends (PLAN.md D39; merged after local and hosted gates)
- [M47](m47.md): captured workflow run and agent cards, Agent map and trigger setting; owner controls deferred pending live success captures (PLAN.md D40; merged after local and hosted gates)
- [M48](m48.md): opt-in, bounded Model API subagents; native read/reopen deferred (PLAN.md D45; merged as PR #35)
- [M49](m49.md): shared memory view and Model API memory tools (PLAN.md D41; merged as PR #36, native writer lock parity unproved)
- [M50](m50.md): MCP servers on the Model API backend and its diagnostics tool (PLAN.md D42; merged as PR #37)
- [M51](m51.md): Model API hooks (PLAN.md D36; merged as PR #39)
- [M52](m52.md): Model API scheduled prompts and paid per-run consent (PLAN.md M52; merged as PR #40)
- [M53](m53.md): conversation rewind and side chat (PLAN.md D46; merged as PR #41), with the Account & usage reset-timing follow-up in [m53-usage-timing.md](m53-usage-timing.md)
- [M54](m54.md): PDF and file input on the Model API backend (PLAN.md D47; merged as PR #42)
- [M55](m55.md): install and sign in to Muse Code from the panel; absorbs the M41 installer proposal (PLAN.md M55; merged as PR #43; ships in 0.9.0)
- [M56](m56.md): enterprise network and posture: proxies and certificates, the sandbox network, `muse config status`, prompt caching (PLAN.md D43; merged as PR #44; ships in 0.9.0)
- [0.9.0 release fixes](release-0.9.0.md): Model API keys in Meta's current format, hooks only in a trusted workspace, the search worker's parsed job (PLAN.md §10)
- [0.9.1](release-0.9.1.md): Muse Code 1.4.0 on Windows: rename, fork and the sandbox warning limited for every version; known 1.4.0 schema fingerprints (PLAN.md D26 amendment)
- [M57](m57.md): the Model API backend out of the activation bundle into `dist/modelApi.js`, the identity audit and the bundle-split gate (PLAN.md D6)
- [M58](m58.md): a popup before every paid use: Allow once, Allow always in this workspace, or Deny (PLAN.md D48)
- [M75](m75.md): paired efficiency evaluation on the extension's own Model API harness, behavioural verifiers, attempts counted from the requests sent, capability floors, and the live baseline, 10/10 in 39 model calls for $0.0041 (PLAN.md D49; the report is [m75-baseline.md](m75-baseline.md))
- [M73](m73.md): observation packing on the Model API, `recall_output`, the savings ledger and the M75 packing arm; built and held, its live M75 run not run (PLAN.md D49)
- [M79](m79.md): plans as files: Save plan and Implement in a fresh conversation, Muse Code's `.agents/plans` convention, the plan's steps as the todo list (PLAN.md D49, D13)
- [M74](m74.md): long tasks, `/handoff` only: the distilled brief reviewed in a dialog before the new conversation starts; automatic compaction, the hidden follow-up and the memory flush not built (blocked on M75 and Q-M74), so M74 is not complete (PLAN.md D49)
- [M69](m69.md): web fetch on both backends: public HTTPS pages, every DNS answer checked and the connection pinned (through VS Code's proxy too), per-host approval, untrusted-content markers; Muse Code through the `ide` server (PLAN.md D49, folds in M44b)
- [Sign-in detection](sign-in-detection.md): the CLI's sign-in read from its credential file's structure and confirmed by the CLI, sign-out through `account/logout`, and every way a browser sign-in ends (PLAN.md D26 amendment)
- [M83e](m83e.md): exposure-preserving import, metadata-only preview, unsaved target editor edits and scoped rig/red-drill evidence (PLAN.md D49, D64); [M83](m83.md), [M83b](m83b.md) and [M83d](m83d.md) are superseded history.
- [M84](m84.md): session export, import and share: redacted by default and previewed, every imported byte parsed, imported conversations asking every time (PLAN.md D49)
- [M68](m68.md): the verify loop: diagnostics and check commands after edits, `run_checks`, `then_run`, format on edit, and the Muse Code note (PLAN.md D49; merged as PR #54)
- [M67](m67.md): code intelligence tools from VS Code's language services on both backends, `rename_symbol` through the edit path, and the opt-in repo map (PLAN.md D49)
- [M60](m60.md): the host API record and the `vscode` boundary, with M61's host bridge and portable controller (PLAN.md D60)
- [M62a, M62b](m62.md): the VS Code floor at 1.99, from an API and Node audit, tested in VSCodium and code-server; Eclipse Theia 1.75 (PLAN.md M62, A8)
- [M63a–M63c](m63.md): the ACP agent for other editors, the Model API key in the OS credential store, and the agent's package; Zed, Emacs with agent-shell, Neovim with CodeCompanion, JupyterLab with Jupyter AI; the editors' MCP servers; the host checks in CI (PLAN.md D61, D62)
- [PR #32 joined with M57 and M58](pr32-integration.md): the ACP agent loads `dist/modelApi.js`, each paid use asks in the editor, the agent's budget, networks and proxies, the key store on the owner's Windows 11 VM and Mac mini (PLAN.md D6, D62, Q66)
- [M72](m72.md): turn checkpoints in a shadow repository: restore files, the conversation or both, and redo (PLAN.md D51)

- [M80 headless and CI](m80.md): lanes A–D, their integration, the W workflow and the cross-lane fix pass, with every drill and the integrated-tree gates on three rigs; hosted matrix and live receipts L/LA/LR pending.
