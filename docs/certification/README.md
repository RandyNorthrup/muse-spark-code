# Certification records

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
- [M43](m43.md): a row for every tool Muse Code runs: memory, goals, scheduled prompts, web search, background work, pictures (PLAN.md D36)
- [M42](m42.md): replay as Meta validates it: commentary, reasoning summaries, reasoning-only turns, stream retries (PLAN.md D35)
- [M33–M35](m33-m35.md): the paid features: web search, image generation and Muse Voice, opt in and loud (PLAN.md D30, D34)
