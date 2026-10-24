# cc/fixes — three defects on int/recovery (2026-10-24)

Worktree `mx-cc-fixes`, branch `cc/fixes`. The worktree was made at
int/recovery `fcbd0e3f1f`; int had moved on to `de0c671a28` (cc/gates'
`spawnResourceFile`, cc/rlm116's playbook landing, cc/rlm104), which items
2 and 3 need, so `cc/fixes` was fast-forwarded to `de0c671a28` before the
first commit (no rebase, no merge commit). Model attempts: **0**. Provider
calls: **0**. Every run below is on this PC (Windows 11 Pro 10.0.26200,
Windows PowerShell 5.1.26100.9711, PowerShell 7.6.6, Git Bash 5.2.37, WSL
Arch bash 5.3.20), vitest with `TMP`/`TEMP` in the worktree's `temp/`.

## Item 1 — the shell trailer reported every PowerShell failure as exit 0

The Model API shell tool wraps the model's command with
`shellDirectoryTrailer` (`src/core/backends/modelapi/tools.ts`, M91 lane S,
D70) so the session keeps its directory. On Windows the trailer began
`; $__m91code=$LASTEXITCODE; $__m91ok=$?; …`: the assignment before it set
`$?` to true, so `$__m91ok` was always true and the trailer always ran
`exit 0`. A failing native command and a failing cmdlet both reached the
model as `exit code 0`.

Root cause, probed in both PowerShells (`-NoProfile -NonInteractive
-Command`): `cmd /c exit 3; $c=$LASTEXITCODE; "$?"` prints `True`;
`cmd /c exit 3; "$?"` prints `False`, in Windows PowerShell 5.1.26100.9711
and in PowerShell 7.6.6 alike.

Fix: the trailer's first statement reads `$?` (`$__m91ok=$?`), then
`$LASTEXITCODE`, which no assignment changes. The rest is unchanged: a
success stays 0, a native failure keeps its code, anything else fails as
1, and the side file still gets the sequence and directory.

bash (and zsh): the POSIX trailer already reads `$?` first
(`; __m91status=$?; …`). Probed through the trailer's text with
`--noprofile --norc -c` in Git Bash 5.2.37 and in WSL Arch's bash 5.3.20:
`sh -c 'exit 3'` exits 3, `false` exits 1, `echo ok` exits 0, and the
report carries sequence and directory; `false; x=1; echo $?` prints `0`,
so the order matters there too and is right. The product's tool shell is
bash on every POSIX host (`shellInterpreter` resolves `bash`); zsh is not
installed on this PC or in its WSL distribution, so zsh was not probed.
Its `$?` rule for assignments is the same as bash's, and the trailer's
first statement reads it before any assignment.

Proof `test/unit/shellDirectoryTrailer.test.ts` (8 tests on Windows): the
real trailer behind a real command, through the product's own shell (the
shell tool's real `ToolIo.runShell`: Windows PowerShell 5.1 on Windows,
bash elsewhere) and, on Windows, through PowerShell 7 with the product's
own `shellArguments`. Cases: `cmd /c exit 3` exits 3; `Get-Item` on a
missing path exits 1; `cmd /c exit 3; Write-Output ok` exits 0; a success
exits 0; each also reads the side file back through
`parseShellDirectoryReport` (sequence and directory). On POSIX the same
suite runs `sh -c 'exit 3'` (3), `false` (1) and `echo ok` (0) through
bash.

Red and green (this PC):

- Before the fix (base `fcbd0e3f1f`): 4 failed, 4 passed, exit 1. Both
  PowerShells: `a failing native command keeps its own code` expected 3,
  received 0; `a failing cmdlet fails as 1` expected 1, received 0.
- After the fix: 8 passed, exit 0 (on `fcbd0e3f1f` and again on
  `de0c671a28`).
- Drill on `de0c671a28`: the two statements swapped back → the same 4
  failed (`expected +0 to be 3`, `expected +0 to be 1`), exit 1; restored
  → 8 passed, exit 0, the source line byte-identical to the fix.
