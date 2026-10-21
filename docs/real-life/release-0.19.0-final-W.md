# Real use: final 0.19.0, Windows (the lead, this PC)

Version: **0.19.0**. Packed product first built from the final tree
`bc71fc506b`, then rebuilt from the final branch after each fix below
(the rebuilt package is named where a fix was re-checked). Platform:
Windows 11 Pro 10.0.26200, x64. Backend: **Muse Code 1.4.11** (the
person's own install, `muse-bin-1.4.11-R6667.1.exe`), contributor mode on
in the person's own `~/.config/muse/settings.json`; the product started
`muse serve --contributor-mode on` from it every time (agent stderr). No
API key was read or stored.

Every request named **`muse-spark-1.3-contributor`**: each ACP session was
put on it with `session/set_config_option` before any prompt (a new
session opens on Muse Code's own default, `muse-wonder-1.0`; nothing was
ever sent on it — Muse Code's records show only the session start and the
switch away). Model calls are counted from `model_completed` events in
Muse Code's session records (main session plus its subagents):
**27 of 40, $0.00 of $2.00**, every call
`muse-spark-1.3-contributor`, none plain `muse-spark-1.3`.

The ACP drives used a small editor-side client (`temp/realuse-w/acp.mjs`,
not committed) that speaks to the installed agent over stdio as an editor
does; the VS Code drives used a separate VS Code build (1.138.0) with its
own `--user-data-dir` and `--extensions-dir`, driven over the remote
debugging port. The person's own VS Code and Chrome were never touched.

Key: PASS = happened for real as documented. FAIL = defect found here;
each was fixed in code on the final branch and re-checked.

## Behaviour log

### Packed product, version, two-turn conversation — PASS

- `muse-spark-code-acp --version` → `0.19.0`; ACP `initialize` →
  `{"name":"muse-spark-code-acp","version":"0.19.0"}`.
- Turn 1 "In one short sentence: what is the capital of Australia?" →
  "The capital of Australia is Canberra.", `end_turn`.
- Turn 2: create `hello.txt` with exactly `W190a`, no newline → Write tool
  `hello.txt`, `od -c` reads exactly `W 1 9 0 a` (5 bytes).

### The fallback notice ran on from the answer — FAIL, fixed (f7c6b8fd04)

An ACP client without notice support got Muse Code's turn notice glued to
the answer: "…is Canberra.The turn finished its visible work; background
checks are still running." Fixed: the notice opens its own paragraph
after text that ended mid-line (`src/acp/translate.ts`; red/green in
`test/unit/acpTranslate.test.ts`).

### Manual mode asks before every command; a denial is honoured (#251) — PASS

- Untrusted workspace: the product starts `serve … --disable-shell` (the
  Restricted Mode posture, D13); the model answered "Shell command
  execution is not allowed in this session" — true.
- `--trust-workspace`: `serve --disable-sandbox --contributor-mode on
--trust-workspace`; prompt to run `whoami` in Manual → the client was
  asked **"PowerShell: whoami"**, answered reject; the model said "The
  `whoami` command was declined", nothing ran. On Muse Code, Manual edits
  workspace files without asking — the product's own mode description says
  so — and the turn-2 write above matched it.

### Deleting a conversation (#250) — PASS

`session/delete` on Muse Code 1.4.11 → `-32603 "Internal error: Muse Code
1.4.11 cannot delete conversations."` — the CLI version and the real
cause, matching the earlier record (`release-0.19.0-newprs.md`).

### The workspace PATH guard (#249) — PASS

Logging stand-ins named `muse`, `git`, `bash`, `sh`, `powershell`,
`pwsh`, `where`, `node`, `cmd`, `whoami`, `icacls` (`.cmd` and `.bat`)
in the workspace and its `bin`, both first on PATH. Run directly, a plant
logs (proved). Through session/list and session/new with
`--trust-workspace` the agent spawned
`C:\Users\Randy\AppData\Local\Programs\muse\muse-bin-1.4.11-R6667.1.exe
serve …` and `plant.log` stayed absent.

### Paths on any drive, `..foo` folders (#200) — PASS

Workspace `E:\mx-realuse-w\ws-e`; "create `..foo/note.txt` with exactly
`E200`" → the tool location reads `E:\mx-realuse-w\ws-e\..foo\note.txt`;
`od -c` reads exactly `E 2 0 0`.

### No limit of ours (#229 #234 #239 #240 #228, D121)

- `exec --max-requests 100000 --max-budget-usd 25` with the Model API
  backend (no Meta key stored) → accepted, then "No Meta Model API key is
  stored; store one and try again." with `requests 0; settled $0.000000`:
  the large values are taken, and the refused request books nothing
  (#217). PASS.
- The same flags on the default Muse Code backend answered only "These
  options require the Model API backend." — **FAIL, fixed (a67a5d82ab)**:
  it now names the options and the backend flag ("…(--backend modelApi):
  --max-budget-usd, --max-requests."), in all 15 languages.
- `--questions-defer-after` documented "1–9 read as 10, maximum 3600" —
  a floor and a ceiling of ours on a person's value: **FAIL, fixed**
  (lane NOLIMITSQ, f62ff272aa + 6d67e499c3): any whole number of seconds
  is used as set, 0 never defers, and a wait past one timer's reach still
  holds.
- `exec --max-requests` absent: "without it, there is no request limit"
  (help) — PASS.

### `auth status` printed the same line twice — FAIL, fixed (e7fa323f5c, 7b09307e19)

With providers `anthropic-s1` and `anthropic-s2` it printed "The Anthropic
key is stored in Windows Credential Manager, bound to
https://api.anthropic.com." twice; the Models panel likewise showed two
identical "Anthropic" cards. One shared rule now adds the provider's id to
a label two providers share.

### The vault on Windows inside VS Code (#247) — FAIL, fixed (6b03a11189)

The Vault section said only "Vault — Unavailable. The vault operation
failed. Try again." Traced through the extension host's inspector: the
governed launch of the broker refused `process.execPath` (Code.exe) as
a program planted in the workspace, because VS Code's extension host
works in its own install folder and the launcher's workspace defaulted
to it ("Governed command unavailable" on every try). Fixed: the running
runtime is never refused as a planting (`src/core/resources/commands.ts`;
red/green in `test/unit/pathGuardRound6.test.ts`). Re-check on the
rebuilt package: the section reached its broker and read "Vault — Not
set up". To keep the person's own per-user vault untouched, setup ran
with the separate VS Code's `LOCALAPPDATA` pointed at a throwaway folder
(no model requests from that instance): Set Up Vault → recovery code
dialog (one click, one dialog; Cancel creates nothing and asks nothing
again) → I Saved It → vault created with a `windowsDpapi` osStore slot and
a recovery slot → "Vault — Locked". Every Unlock Vault then failed with
the same generic sentence: **FAIL, fixed** by helper VAULTW
(49898dd119, certification rows 23–30): the broker's audit log fell back
to the POSIX file handling on Windows, its writer refused a missing file,
its checkpoint lived only in the keyring the VSIX does not ship, file
checks locked out the log's own writer, and the pipe relay lost early
bytes, let the pipe name vanish between connections (the hosted
`connect ENOENT`), crashed on late bytes and capped requests at 4 KiB. A
new Windows suite drives the panel's own flow end to end.

Re-check on the rebuilt package (cd5ddc70fa): the vault the old build
had created read "Locked"; Unlock Vault → **"Vault — Unlocked. Protected
by your operating system's credential store"** (tier OS Credential Store,
provider Windows DPAPI). Add to Vault → Named Secret → name
`w190-realuse`, label `W real use`, targets `[]`, Ask Every Time,
presence off, no expiry, hidden off, unattended off, shown off, value in
the password box → "1 item — W real use (secret://w190-realuse)". Lock
Vault Now → "Locked"; Unlock Vault → "Unlocked", the item still listed;
no failure toast anywhere. The store's writer lease (process birth read
natively, #220) ran on every write. PASS.

One more FAIL found on the way, handed to lane VAULTTARGET: the Target
box (pre-filled `[]`) takes only a JSON list of bindings, says only
"Target", and a plain answer ended the whole flow with "The vault
operation failed" (`SyntaxError: Unexpected token 'W'` in the extension
host), losing the name and label typed before it.

### "Stopped unexpectedly last time — report it?" at every start — FAIL, fixed (be5a4ce9b8)

Reported by the owner from their own VS Code; reproduced in the separate
VS Code: after an ordinary close the next start showed the offer. The
owner's own report folder held four left-over markers (17–20 October).
Causes: deactivate cleared the marker only after the whole shutdown,
which VS Code cuts short; and a marker whose process id Windows had given
to another process read as a live window and was kept forever. Fixed:
the marker is cleared first, the journal still closes after a failed
shutdown, and on Windows and macOS a live id born after the marker counts
as gone (`test/unit/crashMarker.test.ts`, red/green).
Re-check on the rebuilt package (separate VS Code): the first start after
upgrading offered once, consuming the marker the old build had left; a
normal close then left **no marker**, and the next two starts showed no
offer. PASS.

### Windows PowerShell started from a PowerShell 7 terminal — FAIL, fixed (WINPSMOD)

Hosted CI, once the Windows unit step ran from PowerShell 7, showed the
product defect behind it: a `powershell.exe` child started from a
process that inherited PowerShell 7's `PSModulePath` cannot load
Microsoft.PowerShell.Security, so `Set-Acl`/`Get-Acl` fail
(`CouldNotAutoloadMatchingModule`; reproduced here from pwsh). Lane
WINPSMOD (f6d4ce9c89): every Windows PowerShell 5.1 child now gets
Windows PowerShell's own module path through one shared rule, a source
gate keeps new starts on it, and Windows OpenSSH children keep
`ProgramData` (without it `ssh`/`ssh-keygen` exit 255 silently).
Red/green from pwsh and from Git Bash; record rows 21–22 in
`docs/certification/winvault0190.md`.

### First panel open starts Muse Code at once (STARTUP0190) — PASS

Opening the Muse Spark sidebar started `muse serve --disable-sandbox
--contributor-mode on --trust-workspace` within seconds of the click.

### The composer names this platform's real focus shortcut (F67) — PASS

Placeholder "Ask Muse… (Ctrl+Alt+Esc to focus)"; the extension's Windows
keybinding is `ctrl+alt+escape`. Pressing it in the window toggled focus
out of Muse and, pressed again, into the composer textarea.

### What's New shows the 0.19.0 notes — PASS

"What's New in Muse Spark Code — You're on version 0.19.0", loaded from
the extracted webview archive. (The notes say "Released Oct 18, 2026";
the release step sets the real date.)

### Models panel provider names — PASS after the fix above

The rebuilt panel lists "ChatGPT | Anthropic (anthropic-s2) | Anthropic
(anthropic-s1)".

### Attach Latest Screen Recording (#236)

With no recording folder: "No recent screen recording was found." A real
2-second recording of the separate VS Code window (ffmpeg gdigrab, by
window title) saved to `Videos\Screen Recordings` → the command opened
"Preview Screen Recording" (0:02, "This recording includes whatever was
on your screen.", Attach / Discard) from the owner-only preview folder;
Attach put it in the composer with "This media needs the Model API
backend." — true on Muse Code. The recording and the folder were removed
afterwards. PASS for the flow.

Three FAILs around it, fixed (helper MEDIA, 110c4aacac): the setting
`museSpark.screenRecordingMaxSeconds` said "a set value stays within
10–600" (a floor and a ceiling of ours) — now any whole number of
seconds is used as set, through the Windows and macOS recorders; Attach
Latest skipped any recording older than ten minutes (a cutoff of ours) —
now the newest recording at any age; and on Windows only the Snipping
Tool folder was searched — Xbox Game Bar's `Captures` folder is searched
too (through Windows' registered folder), and when nothing is found the
message names the folders it looked in. Red/green three ways
(`docs/certification/media0190.md`).

### Usage history had stopped on this PC — FAIL, fixed (ceeb998b1f)

The extension host threw `invalidUsageLock` every 5 seconds: the newest
resource-history lock claim (16 October) held 36 NUL bytes, a write cut
off after the length reached the disk. Every later acquisition refused
it, so nothing was recorded since. Fixed: a claim holding only NUL bytes
is an unwritten claim, taken over once stale (`test/unit/usageTornLock.test.ts`,
red/green). The same failure had been logged every 30 seconds as
"Resource tree or sampler reading is unavailable": the window's handler
dropped the error. Fixed (11733df2be): the log names the cause.

### Re-checks on the rebuilt package (5646155a6b + VAULTTARGET + LEASEFIX)

Package `muse-spark-code-win32-x64-0.19.0.vsix`, 3,641,970 bytes (budget
3,788,800), installed into the separate VS Code; the agent package
`muse-spark-code-acp-0.19.0-win32-x64.tgz` installed into its own folder.
No model requests.

- **Vault Target (VAULTTARGET) — PASS.** Add to Vault → Named Secret →
  name `w190-target`, label `W target check` → the Target step is a picker
  ("Nowhere yet — the vault holds it and nothing may use it", "One SSH
  computer — its name, user and host key", …, "Something else — type it as
  JSON"). Something else → the box explains each kind with an example; a
  plain `W190_TEST` → "That did not parse as JSON. Type a JSON list. …"
  with `W190_TEST` still in the box; `[{"kind":"ssh","host":"ssh.example.com"}]`
  → "The hostKeyFingerprint entry is missing or not valid. …"; `[]` → the
  flow went on (Ask Every Time, presence, Expires, hidden, unattended,
  shown, value) and the list read "W target check (secret://w190-target)",
  no failure toast.
- **Expires — FAIL, handed to helper EXPIRY.** "next tuesday" was asked
  again ("That date is not valid. Leave it empty for no expiry, or type a
  date.") with the text kept, but the box never says what shape a date
  takes, and the parse takes anything `new Date()` takes ("1" is
  2001-01-01, an expiry already past).
- **CLI bad values (CLIVALUE) — PASS after one more fix.** `--questions-defer-after abc`
  and `-5`, `--backend foo`, `usage --json=foo` each answered "Invalid value
  for --…" with exit 2, and `exec --cpu-max x hi` "Invalid number or limit
  for --cpu-max/--memory-max." (exit 2). The sentence pointed at
  `run serve --help`, which no one can type: **FAIL, fixed (3f5967f5cc)**,
  it now names `muse-spark-code-acp <command> --help`.
- **Settings past our old bounds (NOLIMITSSET) — PASS.** In the separate
  VS Code's settings: `resourceCpuMaxPercent` 5, `resourceMemoryMinFreeGiB`
  0.1, `mediaUploadExpiryDays` 90, `usageHistoryDays` 3000 — no validation
  problem, no refusal. The 5% was used as set: "Machine busy: CPU Use is
  46% (limit 5%). New background work is paused." and the status bar read
  "Resources: Throttling"; with the setting removed the status item left
  on its own.
- **Restart Muse Code (RESTART0190) — PASS on Windows.** Chat and Models &
  Agents panels held 850 → 858 and 813 characters across the restart; the
  log shows `muse serve exited as asked`, a new `serve` spawned and
  connected in 995 ms. The blank panels seen once on Linux did not occur
  here either.
- **The vault logged a failure each time it opened — FAIL, fixed
  (d8a9289d11).** The extension log read `Vault operation failed: Error` on
  every first open, with a correct panel and no toast. Through the
  extension host's inspector: the first load was overtaken by the vault's
  own events ("The use changed after approval"), a retirement the panel
  already kept off the screen but logged first. It is no longer logged as
  a failure (`docs/certification/cifinal0190.md` §8).

### Final pass on the rebuilt package (1069fc6243)

Package 3,644,973 bytes, installed into the separate VS Code.

- **The vault's first open logs no failure — PASS** (the log after the
  window started holds no `Vault operation failed`).
- **Expires (helper EXPIRY, d63d9a343b) — PASS.** The box reads "Expires:
  a date as YYYY-MM-DD (the start of that day, your time), or a date and
  time as YYYY-MM-DDTHH:MM. Leave it empty for no expiry."; `1` and
  `2026-02-30` → "That date is not valid. Type it as YYYY-MM-DD or
  YYYY-MM-DDTHH:MM." with the text kept; `2020-01-01` → "That date has
  already passed."; `2027-01-15` went on, and the list read "W expiry
  check (secret://w190-expiry)", no failure logged.
- **A conversation continued from History after Restart Muse Code and a
  window reload (RESTART0190, SENDFAIL) — PASS.** Picking
  `muse-spark-1.3-contributor` in the panel opens the product's consent
  dialog ("Contributor-Tier Model … Meta may use prompts and completions
  sent to a contributor-tier model to train its models, in exchange for the
  lower price. Use it for this conversation?"); confirmed, the pill read
  `muse-spark-1.3-contributor High` and Muse Code's record holds
  `run.model` on it before any send. Turn 1 → "Hello, welcome to
  WRESTONE!". Restart Muse Code → Developer: Reload Window → Session
  History → the conversation → it reopened with turn 1 and no "Could not
  resume". A reopened conversation runs on the panel's current pick (the
  restart-recovery rule in `enforceResumedModel`, shown on the pill):
  after the reload that was `muse-spark-1.3 Max`, so the contributor model
  was picked and confirmed again before turn 2 → "WRESTONE returns
  alongside WRESTWO." — the conversation continued with its context.
- **Session History showed model-only text in titles — FAIL, handed to
  helper TITLES.** The conversation above was listed as "In one short
  sentence, say hello and include the word WRESTONE.<harness_note>When you
  offer the user a choice … request_user_input tool …</harness_note><harness_note>After
  you edit files, call mcp__ide__getDiagnostics …</harness_note>": Muse
  Code titles a session by the full model-visible first message, and the
  panel shows that title as it comes.

Operator incident (mine, not the product's): driving the palette by typing
"Muse Spark: Vault" (a command the palette hides) let VS Code run its
closest match, "Install Bundled Skills for Muse Code". It refreshed the
person's own `~/.config/muse/skill-sources` copy to this build's skills
and added a `legal` link into the separate VS Code's extension folder. The
link was removed (the person's 0.18.2 never links `legal`); the person's
five existing links are unchanged. Commands are now run only by exact
title, checked before Enter.

### Chrome's network service wait (#222) — NOT RUN

Chrome on this PC is the owner's open browser; the brief rules it out.

### Process birth on Windows (#220) — PASS

The vault store's writer lease names its holder by process id and birth,
read natively (`processOwner`). Every vault write in the passes above (Add
to Vault three times, Lock, Unlock, setup's own writes) took and released
that lease in the separate VS Code with no refusal and no failure logged;
the Windows panel-flow suite proves the same through the real broker
(`test/unit/vault/windowsVaultPanelFlow.test.ts`, run from PowerShell with
an owner-only `TEMP`, since this PC's own `%TEMP%` grants Modify to other
accounts and the vault guard rightly refuses it).

## Model calls

Counted from `model_completed` events in Muse Code's own session records
(`~/.local/share/muse/sessions/2026/10/20/<id>/session.jsonl`, main session
and subagents), matched by `workspace_root` to the separate workspaces.

| Session    | Workspace              | What it drove                                                     | Calls  | Model                                        |
| ---------- | ---------------------- | ----------------------------------------------------------------- | ------ | -------------------------------------------- |
| `01a15aa8` | `ws1`                  | two-turn conversation, `hello.txt` write, fallback notice         | 7      | `muse-spark-1.3-contributor`                 |
| `01a15aaf` | `ws2`                  | `whoami` in Manual, untrusted workspace (`--disable-shell`)       | 3      | `muse-spark-1.3-contributor`                 |
| `01a15ab0` | `ws3`                  | `whoami` in Manual with `--trust-workspace`, denied               | 4      | `muse-spark-1.3-contributor`                 |
| `01a15ae8` | `E:\mx-realuse-w\ws-e` | `..foo/note.txt` on another drive (#200)                          | 4      | `muse-spark-1.3-contributor`                 |
| `01a15b40` | `ws7`                  | the notice's own paragraph after the fix (`W190-SEP`)             | 3      | `muse-spark-1.3-contributor`                 |
| `01a15c64` | `ws6`                  | VS Code panel: turn 1, Restart Muse Code, reload, History, turn 2 | 6      | `muse-spark-1.3-contributor`                 |
| **Total**  |                        |                                                                   | **27** | all contributor, none plain `muse-spark-1.3` |

The panel's two turns cost six calls: its background checks after each turn
call the model too. No call went to any other model; the sessions' only
other model lines are the session start on Muse Code's default and the
switches away from it before any prompt.
