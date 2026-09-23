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
