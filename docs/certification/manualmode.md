# Certification — MANUALMODE: Manual really asks before every command (Muse Code backend)

## 2026-10-18 — protocol mechanism (first result)

Real use (linuxlt, VS Code 1.139, extension in Manual, Muse Code 1.4.7)
showed commands (`touch`, `sleep 300; curl …; rm`, `sudo ls`) running with no
approval reaching the editor; the session files record
`"policy_decision":"allow:llm_judge"`. Manual selects MSP `promptUnmatched`
(`src/shared/permissionModes.ts:75`), so the judge decides unmatched calls
inside that mode.

### Mechanism: per-session permission profile `:ask-me` (stable in 1.4.7)

Muse Code 1.4.7's own schema (`muse schema generate-json-schema`, pinned
binary `/home/randy/lanes/_rig/muse-pinned/1.4.7-R6101.1/muse-bin`,
exported 2026-10-18 to worktree `temp/schema147/`) carries a stable
`session/start.permissionProfile` member (amendment 42624, ADR 42197 D2):
"a profile id the host catalog already admits — the rows
`permissionProfile/list` serves … Select, never create. Omitted means
today's behavior." `ApprovalMode` stays closed (select, never create);
`SessionConfig` still admits only `mcpServers`. There is NO wire member that
turns the judge off besides the profile.

Live catalog from the pinned 1.4.7 host (`serve --provider echo`,
`permissionProfile/list` with `experimentalApi`, 2026-10-18,
worktree `temp/probe-profiles.mjs`, zero model calls):

| profileId       | label        | reviewerAuthority | description                                                                                                                     |
| --------------- | ------------ | ----------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| `:read-only`    | Read only    | human             | Reads files only.                                                                                                               |
| `:ask-me`       | Ask me       | **human**         | Edits workspace and temporary files; requires approval for protected writes, new network targets, and other restricted actions. |
| `:auto-review`  | Auto-review  | **autoReview**    | Same access as Ask me; AI reviews eligible actions; trusted permission hooks may decide approval requests first.                |
| `:unrestricted` | Unrestricted | none              | No filesystem sandbox or approval prompts…                                                                                      |

`:ask-me` and `:auto-review` have the SAME access; only the reviewer
differs (human vs AI). That is exactly Manual's promise
(`src/shared/l10n/en.ts` `permissionModeDetails.manual`: "Muse asks before
running each command, unless a permission rule allows it; Muse Code edits
workspace files without asking").

Durable sessions on the pinned 1.4.7 host (`serve --provider echo`, stable
handshake WITHOUT `experimentalApi`, `session/start` with
`approvalMode: promptUnmatched`, 2026-10-18, `temp/probe-start-profile.mjs`):

- default (profile omitted): `permission_profile_committed`, cause
  `new_session_default`, reviewer `auto_review` — the judge is installed.
  Same definition sha as explicit `:auto-review`, so the default IS
  `:auto-review`.
- `permissionProfile: ':ask-me'`: accepted, cause `launch_cli`, reviewer
  **`human`** — no executable reviewer installed for the session.
- `permissionProfile: ':bogus'`: refused
  (`no profile :nope in the host catalog`), proving the member is honored.

### Ruled out (with sources)

- MSP approval modes (`muse schema`, SDK 1.4.4 `msp.d.ts:87`, 1.4.7 schema
  `ApprovalMode` closed enum): selecting `promptUnmatched` does not remove
  the judge — the incident happened inside it.
- `muse serve` flags (1.4.10 `--help`, 2026-10-18): "Approval mode is …
  selected on the wire, so there is no approval flag here."
  `serve --approval-judge off` is refused
  ("--approval-judge is not a serve option"); serve's hidden approval args
  are refusal routes (binary strings, `ServeArgs`).
- `MUSE_DISABLE_APPROVAL_JUDGE` (binary `EnvSnapshot … gate_overrides …
muse_disable_approval_judge`): process-wide for the whole serve host, so
  it would also strip Auto's judge, whose words allow it
  ("Muse Code runs the commands it judges simple without asking").
  Per-session profile is the precise tool; the env var is not used.
- `session/setApprovalMode` (1.4.7 schema): mode-only change, writes no
  profile fact — a mid-session Manual↔Auto switch keeps the starting
  profile. Mid-session profile switch is `session/setPermissionProfile`
  (amendment 42624 FR-42624-2), marked `x-msp-stability: experimental`,
  TO VERIFY live (next step), with `session/read` `permissionState`
  (`reviewerAttached` live evidence) as the ongoing observable.

### What remains to prove

1. `session/setPermissionProfile` on 1.4.7 with `experimentalApi`
   (mode-switch path), and whether `session/read` serves `permissionState`.
2. A real session where a command produces an approval request in Manual —
   needs a model turn; no model calls from this lane (not in brief), so the
   lead runs that drill in the real-life run. Up to that step, everything is
   proven against the real pinned binary above.
