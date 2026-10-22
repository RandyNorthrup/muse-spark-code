# Draft: bind MSP shell approval to the process Muse Code starts

Target: [meta-models/muse-code-sdk](https://github.com/meta-models/muse-code-sdk).
Draft for the lead to file; no upstream issue has been submitted.

Our unofficial editor harness requires fresh human approval for every shell
command in a hardware session. It must reject a pending answer or process
start if the run becomes unattended or the observed device identity changes.
We can enforce those checks for processes our Model API backend owns. Muse
Code owns its shell spawn after the editor sends `approval/decide`, so the
editor cannot perform the equivalent final check.

The captured MSP approval subject includes command text and staged argv, and
the editor sends a once-only decision for its requirement. That evidence
does not bind the actual executable, argv, cwd or environment at spawn, and
provides no final process-entry callback. A standing CLI grant or silent
command also need not produce an editor approval card. We do not infer a
new wire field or claim these captures describe every current CLI path.

Please provide either an approval-time binding of the exact execution plan
or a blocking pre-exec hook. It should cover the resolved executable, exact
argv, cwd and effective environment, including shell initialization and
inherited functions that can change what a bare command executes. Environment
values may contain secrets: use an opaque binding or private comparison;
do not expose credentials in model context, logs or approval-card text.

The integration needs these guarantees:

- A host-required fresh approval/pre-exec check applies to every shell spawn,
  including commands otherwise accepted by Auto or a standing CLI rule.
- The decision is single-use, expires, and is invalidated by any execution
  plan change. Cancellation, hook failure or a missing response starts no
  process; failed delivery cannot replay an accepted decision.
- Immediately before native spawn, the host can synchronously reject on its
  live unattended state or changed device identity. No asynchronous work or
  execution-plan mutation occurs between that check and spawn.
- A registered canonical Stop can proceed through an explicit host-owned
  exception without a human approval prompt. Arbitrary stop-looking shell
  text cannot select that exception.

A reproduction needs no hardware or paid call: hold shell preparation after
an editor approves, change the fake host's device identity or unattended
state, and release preparation. The host must be able to prevent spawn.
Also test an inherited printing-only `ls` function and a standing command
rule: both must reach the fresh approval/pre-exec path.

Existing evidence: Muse Code 1.4.2-R4684.1, captured 2026-10-02 in an isolated
home and empty temporary workspace against a loopback fake Responses API,
zero external model attempts. See
[the approval capture record](../certification/approval-decisions.md),
`test/unit/helpers/stageRaceCapture.ts`, and
[the guard continuation record](../certification/m103-g.md).
