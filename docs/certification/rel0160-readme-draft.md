# README 0.16.0 draft

Apply this section after the authorized main sync and the manifest/lock/ACP
promotion to 0.16.0. Replace the current What's new section, set the contents
link to `#whats-new-in-0160`, and demote main's 0.15.0 section to
`### Earlier in 0.15`. Preserve all earlier notes from the main sync.
Remove the draft notice only after the main sync and the final feature facts
and qualifications are checked. The ordinary README remains aligned with the
current package version, as its existing release gate requires.

## What's new in 0.16.0

> Release draft: M106 and M107 are joined; the 0.14.4/0.15.0 main sync is pending.
> See [release readiness](docs/certification/rel0160.md) for the current
> verification and the remaining resource-governor qualifications.

- **Loop guarantees.** Strict tool contracts, bounded hosted search and streamed
  argument previews help you follow Model API tool calls. Independent reads can
  run concurrently while their results keep call order. The loop bounds
  continuations, refuses cut-short tool execution and stops repeated unchanged
  calls. Structured side calls validate answers; headless runs can require a
  bounded final-answer schema. See [Agent loop guarantees](#agent-loop-guarantees)
  for capability gates and remaining native-reader qualifications.
- **CPU and memory thresholds.** Set machine-scoped limits to throttle new
  background work. Eligible queued tasks and checks can relocate through an
  existing approved device or runner route; other work stays local.
- **Disk floors.** Disk-heavy launches wait below the free-space floor and
  critical-volume writes refuse with a reason. Temporary cleanup requires
  recorded ownership and proved tree exit. See
  [Keeping your machine responsive](#keeping-your-machine-responsive) for the
  settings, available routes and remaining integration qualifications.
