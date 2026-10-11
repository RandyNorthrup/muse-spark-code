# Muse Code 1.4.3 Windows upstream follow-up (2026-10-05)

Owner-authorized subscription probe on Windows, `muse --version`:
`Muse Code 1.4.3 (1.4.3-R5018.1)`. MSP reports `serverInfo.version: "1.4.3"`,
`platformOs: "windows"`, durable sessions. One initially empty temporary
workspace under `%TEMP%`; `muse serve --trust-workspace`, sandbox left on.
One `muse-spark-1.3-contributor` turn, six model attempts including reminders.
One approval, `allow_once`. No credentials were read or changed.
The owned server was stopped and the temporary workspace removed.

Scrubbed frames: [wire capture](muse-1.4.3-wire.jsonl). UUIDs, tool-call IDs,
profile paths and temporary workspace names are redacted consistently.
These are proposed issue comments for the lead; this lane posted nothing.

## #30 — Rename still refused

On Windows `1.4.3-R5018.1`, after a completed turn in a new durable session,
`session/rename` with `{ sessionId, name: "MUSE143 throwaway renamed" }`
still returns:

```json
{
  "code": -32603,
  "kind": "internal",
  "message": "session/rename runtime admission failed: session naming is unavailable",
  "data": { "kind": "internal", "retryable": false }
}
```

The extension continues to hide Rename on Windows.

## #31 — Fork still refused

On that same session and build, `session/fork` with `{ sessionId }`
(no cut point) still returns:

```json
{
  "code": -32023,
  "kind": "forkBoundaryInvalid",
  "message": "invalid fork boundary for session <id-1>: WriteFailed",
  "data": {
    "kind": "forkBoundaryInvalid",
    "retryable": false,
    "sessionId": "<id-1>"
  }
}
```

The extension continues to hide conversation rewind and Side chat on Windows.
File-only rewind remains available.

## #26 — Correct cwd here; sandbox reliability still unresolved

The sandboxed PowerShell command was:

```powershell
Write-Output (Get-Location).Path; Set-Content -LiteralPath ./muse143-probe.txt -Value MUSE143
```

After `approval/decide` returned `status: "accepted", terminal: true`, the
tool output began:

```text
Microsoft.PowerShell.Core\FileSystem::\\?\<workspace>
Set-Content : Access is denied
```

The tool completed with `status: "failed"`, `failureReason: "process exited
with code 1"`; the enclosing turn completed normally. The wrong-System32
cwd symptom did **not** reproduce on this already-prepared owner host.
This does not retest the fresh Windows sandbox's non-completing command
recorded on 1.4.2 in `docs/certification/musecode-write-asks.md`, nor establish
which earlier version fixed cwd on this host. The denied write is additional
1.4.3 evidence, not proof of the old cwd failure. Do not mark #26 fully fixed
or lift the profile-workspace workaround from this capture alone.

## #29 — No ledger fault in the requested approval check

The single shell approval returned `status: "accepted", terminal: true`
without a ledger durability error, and the stream resolved it as approved.
This agrees with the upstream closure supplied in the lane brief: updating
to 1.4.3 or later is enough. This run did not reproduce the older
partly-approved/cancelled-session trigger and does not certify recovery of
an already damaged session. Fault detection remains active on every version.
