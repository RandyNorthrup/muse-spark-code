# Real use: 0.19.0 after the time limits came out, Windows (the lead, this PC)

Version: **0.19.0**, the agent package CI built from PR #257's final head
`915f409fe4` (CI run 39716712837, artifact `muse-spark-code-acp`,
`muse-spark-code-acp-0.19.0.tgz`, 3,485,063 bytes), installed with npm into
its own folder outside any workspace; `--version` → `0.19.0`. The release
reuses this run's packages. Platform: Windows 11 Pro 10.0.26200, x64.
Backend: Muse Code 1.4.11 (the person's own install), contributor mode on in
the person's own settings; the product started
`muse-bin-1.4.11-R6667.1.exe serve --disable-sandbox --contributor-mode on
--trust-workspace`. No API key was read or stored.

What changed and is used here: no deadline of ours on report source reads
(5 s before), on Windows PowerShell, `taskkill` and process-table reads, or
on the stops after a turn's cancel (20 s before).

Expected before the run: **5 model calls**, cap 40 calls and **$2.00**, every
request on **`muse-spark-1.3-contributor`** by name, in an empty workspace.

## Reports read the network with no deadline of ours — PASS

`muse-spark-code-acp report project --network --format json --out <file>`
against this repository: exit 0 in 12 s, no model call. Against the
published 0.18.2 agent on the same repository at the same time:

- `stores` reads `partial` (channels-unavailable: 0.19.0 is not yet on the
  stores) where 0.18.2 read `unavailable`; `usage` reads `partial` (it names
  the journal entries it excludes) where 0.18.2 read `unavailable`.
- Every other source reads the same, except `planRevision`: `ok` on 0.18.2,
  `unavailable` now. Not from this change: it compares PLAN.md with PLAN.md
  at the latest release tag (`v0.18.2`), and today's PLAN reader finds six
  format drifts in that older file (duplicate question ids such as
  `Q-M95INT2`), so it refuses the comparison and says so. Recorded for the
  recovery work, with `github` (`pulls-page-1: pull-response-invalid`,
  `default-branch-page-1: http-422`) and `git` ("The source exceeds the
  report read limit"), which read the same on 0.18.2.

## A command runs through Windows PowerShell — PASS

ACP session `01a161bf`, put on `muse-spark-1.3-contributor` by
`session/set_config_option` before any prompt. "Run this exact PowerShell
command once … `(Get-Process -Id $PID).ProcessName`" → the client was asked
"PowerShell: (Get-Process -Id $PID).ProcessName", allowed once; the answer
was `powershell`; `end_turn` in 20.5 s.

## Stop ends a long command and everything it started — PASS

"Run this exact PowerShell command once … `Start-Sleep -Seconds 300;
'slept'`", allowed; the client sent `session/cancel` 5 s after the tool call
started, as an editor's Stop does. The turn ended `cancelled` 90 ms after
the cancel (8.6 s in all). Afterwards no process on this PC had
`Start-Sleep -Seconds 300` in its command line.

## Notes

- The first attempt (session `01a161bd`) sent no prompt: the driver was
  started without `--allow-contributor-models`, so the agent offered no
  contributor model and refused the switch ("Invalid params"), and the
  driver stops before any prompt when the session is not on the
  contributor model. Muse Code's records show no call for it.
- `session/delete` answered "Muse Code 1.4.11 cannot delete conversations.",
  as the product documents.

## Model calls

Counted from `model_completed` events in Muse Code's own session records
(`~/.local/share/muse/sessions/…/<id>/session.jsonl`, main sessions and
subagents) for sessions `01a161bd` and `01a161bf`: **5 calls**, every one
**`muse-spark-1.3-contributor`**, **$0.00** of the $2.00 cap.
