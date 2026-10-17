---
name: quality_retrofit
description: Scan an existing codebase and bring it into compliance with strict quality standards — style, formatting, linting, type checking, dead-code removal, magic-number and literal extraction, sanitizer wiring, secret scanning, and CI-ready gates. Extends existing configuration rather than replacing it, and lands changes in reviewable phases with tests green between each. Use when the user says "retrofit", "clean up this codebase", "add quality gates", "enforce standards", "fix lint", "remove dead code", or invokes the quality_retrofit skill. For a brand-new project with no source files, use project_setup instead.
---

# Quality retrofit — bring an existing codebase into compliance

Take a working codebase and raise it to strict standards without breaking it.

The hard constraint that shapes everything below: **this code already works and
someone depends on it.** A retrofit that lands 4,000 mechanical changes in one
commit is unreviewable and will be reverted. Phase the work.

Use this workflow for quality-only improvements. A requested feature or behavior
change belongs to `feature_delivery`; do not turn it into an unsolicited whole-
repository retrofit.

## Communication style

Status updates: short, direct, no filler. Caveman style if that plugin is
active. Never compress code comments, documentation, findings rationale, or
risk notes.

## Locating this package

Paths below use `${SKILL_ROOT}/...` as a placeholder for the directory holding
this package's `scripts/` and `templates/`. Resolve it once with the active
shell. On Windows PowerShell:

```powershell
$SkillRoot = & 'C:\path\to\high-quality-projects-skill\scripts\skill-root.ps1'
```

On Linux, macOS, or another POSIX environment:

```bash
SKILL_ROOT="$(bash /path/to/high-quality-projects-skill/scripts/skill-root.sh)"
```

Both root scripts locate themselves, so they work from a plain clone, a vendored
copy, or a submodule with no environment set. They honour `SKILL_ROOT`, then
`CLAUDE_PLUGIN_ROOT` under Claude Code. Do not invoke Windows `bash.exe`: it can
exist as a WSL relay even when `/bin/bash` does not.

Nothing here is specific to one vendor. If your agent cannot run shell commands,
read the files directly out of the repository — the templates are plain config
files and the phases below are plain instructions.

## Rule zero: scan, enhance, then create only if needed

```powershell
$Scan = & "$SkillRoot\scripts\detect-stack.ps1" . | ConvertFrom-Json
```

Or from a POSIX shell:

```bash
"${SKILL_ROOT}/scripts/detect-stack.sh" .
```

Returns languages present, existing config, and installed tools. **Do not
change anything yet.** Report:

- Languages found, by file count
- Quality config that already exists
- Required tools that are missing from this machine
- Estimated blast radius: how many findings, in how many files. Run the
  strict template against the tree to get a real number — do not guess

If the JSON contains `error`, stop and report it. Do not modify the target
workspace after a failed inventory.

A Python tool counts as present when it is **importable**, which is not the same
as being on `PATH` — an unactivated venv, or a Windows install without the
scripts directory exported, routinely leaves `ruff` fully usable while
`command -v ruff` finds nothing. Everything the scan lists under
`python_runtime.module_only_tools` needs an invocation verified for that
interpreter, usually `<python_runtime.bin> -m <module>`. Semgrep rejects that
form: use its installed console scripts with the selected environment's scripts
directory on the child process PATH. A missing PATH entry or unsupported CLI
form does not justify a duplicate installation or a false passing gate.

Supplement the inventory with a focused search by path, symbol, behavior, and
responsibility across code, components, utilities, types, schemas, tests,
configuration, docs, infrastructure, and assets. Read the closest matches and
trace callers, fixtures, entry points, and generated-code boundaries. File
counts and a clean duplication-tool report do not establish semantic uniqueness.

Record canonical paths, consumers, and the reuse/extension decision in the
existing report or `PLAN.md`. Enhance that work before adding another helper,
wrapper, component, model, config, test harness, or document with the same role.
If new work is necessary, record why existing work cannot satisfy the contract
and how overlap is prevented. Similar syntax alone does not justify merging
unrelated responsibilities into a shared abstraction.

Repeat the focused scan before each change and when scope or source changes.
For replacements, migrate callers and tests and verify preserved behavior;
remove superseded code only after checking dynamic and public consumers. Keep
two active paths only for an explicit compatibility need with an owner and
removal condition. Search again for duplicates and stale callers at closeout.

Confirm scope before writing, reusing authorization already given in the
conversation. Ask only about material unresolved choices or scope expansion.
A retrofit that surprises someone is a failed retrofit.

### Extend, never replace

Read `${SKILL_ROOT}/docs/CODE-QUALITY.md` before editing: apply the common
semantic/organization contract and the detected languages' guidance. Review for
vacuous behavior, tautological checks, unclear ownership, and redundant layers;
use the existing suite and red drills to prove any simplification.

For every config file that already exists:

1. Read it.
2. Keep every rule the project already chose — those choices encode knowledge
   you do not have.
3. Add missing strictness on top.
4. Where the existing config and the strict template genuinely conflict, keep
   the project's and note the divergence in the report.

Copy a template wholesale **only** when no config of that type exists. Templates
live in `${SKILL_ROOT}/templates/`.

Special cases:

- `pyproject.toml` already has `[tool.ruff]` → merge into that table. Do not add
  a competing `ruff.toml`; both existing means the standalone file wins and the
  project's settings silently stop applying.
- `.eslintrc.*` (legacy) present → migrating to flat config is a breaking change
  for their editor setup. Ask first.
- `eslint.config.js` present and ESM → leave the name alone. Only use `.mjs` for
  a file you are creating.

## Safety rails

Before the first modification:

```console
git status --porcelain     # must be clean, or stop and ask
git rev-parse HEAD         # record for rollback
```

- **Never retrofit a dirty working tree.** Uncommitted work will be tangled
  with mechanical changes and become impossible to separate.
- **Not a git repo** → offer `git init` and an initial commit first. Refuse to
  bulk-modify unversioned code.
- Establish the test baseline **before** touching anything. If tests already
  fail, record which ones. You cannot tell what you broke otherwise.
- One phase per commit. Each commit passes the gates that existed before it.
- **Every project requires repeatable red drills.** Read and follow
  `${SKILL_ROOT}/docs/RED-DRILLS.md` before trusting inherited tests or gates.
  Break the affected behavior in isolation, require the intended assertion and
  a non-zero exit, restore exactly, and prove green again. A green suite, code
  coverage, or an unrelated failure does not establish test sensitivity.

## Phases

Run in order. Each is independently reviewable and independently revertible.
Stop and report between phases; do not chain them silently.

For scoped retrofit work, follow `${SKILL_ROOT}/docs/DELIVERY.md` for stable
acceptance/task IDs, separate readiness and implementation proof, closeout
reconciliation, and checkpoints. Keep the existing canonical plan and phase
boundaries. A formatter-only change can use one compact obligation; do not invent
feature stories or duplicate the detailed quality/red-drill procedures.

On resuming a retrofit, re-observe the tree and current tool context and validate
the checkpoint. Reopen affected work when evidence is stale, preserve user edits,
and use the atomic update helper for native plan state. A changed rule needs an
amendment and impact review in the canonical project rules file.

### Phase 0 — baseline
Record: test results, build status, current lint/type error counts. This is the
number every later phase is measured against. Write it into the report.
Confirm actual test discovery and execution, then drill the tests protecting
behavior in scope before relying on them. Record surviving mutations, unrelated
failures, missing tests, and blocked drills as gaps; never as verified green.

**Leave no trace.** Running the gates is not a read-only act: `ruff`, `mypy`,
`pytest` and `cargo` all write cache directories, and in a repo whose
`.gitignore` does not cover them yet, they land as untracked files. That is
worse than untidy — `git status --porcelain` is the guard on every later phase,
so a baseline that dirties the tree disarms the check it depends on, and the
next phase either stops on damage this workflow caused or learns to ignore the
one signal that protects the user's work.

Record what exists before the gates run, and remove only what they created:

```bash
CACHES=(.ruff_cache .mypy_cache .pytest_cache .tox htmlcov .coverage)
PRE=(); for d in "${CACHES[@]}"; do [ -e "$d" ] && PRE+=("$d"); done

# ... run the baseline gates ...

for d in "${CACHES[@]}"; do
    [ -e "$d" ] || continue
    printf '%s\n' "${PRE[@]:-}" | grep -qxF "$d" || rm -rf "$d"
done
git status --porcelain    # must match what it printed before the baseline
```

PowerShell equivalent:

```powershell
$Caches = @('.ruff_cache', '.mypy_cache', '.pytest_cache', '.tox', 'htmlcov', '.coverage')
$PreExistingCaches = @($Caches | Where-Object { Test-Path -LiteralPath $_ })

# ... run the baseline gates ...

foreach ($Cache in $Caches) {
    if ((Test-Path -LiteralPath $Cache) -and $Cache -notin $PreExistingCaches) {
        Remove-Item -LiteralPath $Cache -Recurse -Force
    }
}
git status --porcelain    # must match what it printed before the baseline
```

A cache that was already there is the user's, regenerable or not, and is not
yours to delete. Anything still listed afterwards is a gap in `.gitignore` —
close it in phase 2, do not clean it by hand every phase.

### Phase 1 — formatting (low risk, huge diff)
`prettier` · `ruff format` · `rustfmt` · `clang-format` · `dotnet format` ·
`shfmt`

Formatting is intended to change layout only. Verify it, review the diff, and
land it as **one isolated commit**.

**Prove it before committing.** "Formatting is safe" is an assumption, not a
fact, and a byte-diff cannot check it: `ruff format` and `black` also add magic
trailing commas and normalize quotes, so the file legitimately changes beyond
whitespace. Comparing the parsed AST checks whether Python syntax structure
changed while ignoring layout:

```bash
cp target.py /tmp/before.py
ruff format target.py
"${SKILL_ROOT}/scripts/verify-format-safe.py" /tmp/before.py target.py
```

PowerShell equivalent; use the interpreter selected by the initial scan:

```powershell
$BeforeFile = Join-Path ([IO.Path]::GetTempPath()) 'before.py'
Copy-Item -LiteralPath target.py -Destination $BeforeFile
ruff format target.py
$PythonBin = $Scan.python_runtime.bin
& $PythonBin "$SkillRoot\scripts\verify-format-safe.py" $BeforeFile target.py
```

Exit 0 means the parsed ASTs are identical; still review non-code artifacts and
the diff. **This tool belongs to phase 1 only** — phases 3 onward change the AST
on purpose (removing an unused import deletes a node), so a difference there is
expected, not a failure.

For non-Python stacks the equivalent is a token-stream or AST diff; where no
such tool exists, at minimum re-run the test suite and read the diff.

Then add the commit to `.git-blame-ignore-revs`:

```bash
git rev-parse HEAD >> .git-blame-ignore-revs
git config blame.ignoreRevsFile .git-blame-ignore-revs
```

PowerShell equivalent uses explicit ASCII encoding so Windows PowerShell 5.1
does not create a UTF-16 file:

```powershell
git rev-parse HEAD | Add-Content -LiteralPath .git-blame-ignore-revs -Encoding Ascii
git config blame.ignoreRevsFile .git-blame-ignore-revs
```

Without that file, reformatted lines blame the formatting commit instead of the
earlier change. This step is not optional.

### Phase 2 — config and gates (no product-source change)
Install or extend the strict configs. Wire the gate scripts. Add pre-commit.
Add or extend the CI workflow, hardened per the CI section of
`${SKILL_ROOT}/docs/CODE-QUALITY.md`: actions pinned to commit SHAs, read-only
default permissions, `persist-credentials: false`, job timeouts, and actionlint
plus zizmor as gates. Install dependencies from lockfiles in CI. Nothing under
`src/` changes in this phase.

Ignore the tool caches here, once, for the rest of the retrofit —
`.ruff_cache/`, `.mypy_cache/`, `.pytest_cache/`, `__pycache__/`, `.tox/`,
`htmlcov/`, `.coverage`, `node_modules/`, `target/`, `dist/`, `build/`, plus whatever the
project's own toolchain writes. Extend the existing `.gitignore`; do not
replace it.

At the end, run every gate and **record the failure counts**. Those counts are
the work list for phases 3–6.
Add or extend a repeatable red-drill command using the existing harness. Prove
each new/changed gate and its aggregate command propagate failures, then restore
and rerun. Wire a deterministic drill set into CI and record broader cadence in
the plan. Repeat affected drills after phases change behavior, tests, or tools.

### Phase 3 — autofixable lint
`ruff check --fix` · `eslint --fix` · `cargo clippy --fix` · `stylelint --fix` ·
`dotnet format`

Machine-applied only. After the run:

- Tests must still pass.
- **Read the diff.** `--fix` is not always semantically neutral —
  `no-unused-vars` autofix can delete a call whose side effect mattered.

### Phase 4 — types
Turn on strict type checking, then fix the fallout. Highest-value flags, and
also the loudest:

- TypeScript: `strict`, then `noUncheckedIndexedAccess` — the latter is not part
  of `strict` and typically produces the largest error count. It is also the one
  that finds real bugs.
- Python: `mypy --strict`, then the extra flags in the template.
- C#: `<Nullable>enable</Nullable>` with `<TreatWarningsAsErrors>`.

If the error count is in the hundreds, do **not** fix them all in one commit.
Enable per-directory or per-file and work inward. Every `any`, `# type: ignore`,
or `!` you add to make it compile is a debt entry — record it in the report.

### Phase 5 — dead code
Each tool sees something the others structurally cannot:

- `knip --strict` — unused files, exports, and dependencies (whole-graph)
- `tsc --noEmit` with `noUnusedLocals` — unused symbols within a file
- `vulture` — Python, heuristic
- `cppcheck --enable=all` — includes `unusedFunction`
- `cargo machete` — unused Cargo deps
- Roslyn `IDE0051`/`IDE0052` — unused C# private members, reported at build
  only when `.editorconfig` sets their severity (see the C# template)
- `dpdm --no-warning --no-tree --exit-code circular:1 <entry>` — import cycles

**Confirm the tool fires before trusting a clean run.** A dead-code tool that
reports nothing is indistinguishable from one that is misconfigured, and the
failure is silent by construction. Add an unused export, confirm the tool
catches it, then remove it.

Three that were found reporting nothing while appearing configured:
`import-x/no-cycle`, knip 6's `cycles` rule (both silent against a deliberately
circular pair of modules), and `madge@8.0.0`, whose optional
`typescript@^5.4.4` peer makes normal npm resolution reject TypeScript 6. Use
`dpdm` for cycles; dated project evidence records exit 1 on a real cycle and 0
once removed.

Note also that knip 6 rejects unknown config keys, so a knip 5 config using the
`"//": [...]` comment convention fails to load outright — rename to
`knip.jsonc` and use real comments.

**Coverage can find dead code the dead-code tools miss.** A branch a coverage
threshold flags as unreachable may genuinely be unreachable. Work out whether it
can ever execute; if it cannot, delete it rather than lowering the threshold.

**Verify every deletion before making it.** These tools produce false positives
on:

- dynamic dispatch — `getattr`, reflection, DI containers, plugin registries
- string-keyed lookup — route tables, event maps, serializer registries
- public API of a library — "unused" internally is the entire point
- test-only helpers, fixtures, conftest
- entry points invoked by a framework, not by your code

Grep for the symbol name across the whole repo, including config, templates, and
docs, before deleting. When in doubt, list it in the report rather than removing
it.

### Phase 6 — magic numbers and literals
The judgment-heavy phase. Extract unexplained literals into named constants,
enums, literal unions, or schema-validated config.

**Extract:**
```
setTimeout(fn, 86400000)          → const CACHE_TTL_MS = 24 * 60 * 60 * 1000
if (status === 3)                 → if (status === OrderStatus.Shipped)
retry(5)                          → const MAX_RETRIES = 5
if (role === "adm")               → if (role === Role.Admin)
buffer[1024]                      → constexpr size_t kBufferSize = 1024
```

**Leave alone** — extracting these makes code worse:
```
if (xs.length === 0)      i = 0, i++, i - 1      return []      x * 2
arr[0]                    if (flag)              ""             .5 in a midpoint
HTTP 200/404 in a switch that reads as status codes
```

The test: does the name add information the value lacks? `const TWO = 2` adds
nothing. `const RETRY_LIMIT = 2` does.

Do this **per-module with tests green after each**, never as a bulk sweep. This
phase changes behavior if you get a unit wrong — `86400` seconds and
`86400000` milliseconds look alike in a diff.

### Handing the tree to an external reviewer

If a step invokes an outside reviewer (Codex, a SAST service, another agent),
**scope it to specific files or the diff.** Those tools read the filesystem, not
git, so `.gitignore` does not protect them: a `.venv/`, `node_modules/`, or
`target/` you created during the retrofit will be crawled, burning the entire
budget on vendored stubs before it reaches your code.

Name the files explicitly, for example: "review only src/foo.py and the diff
A..B; exclude .venv, node_modules, target, and generated output." Do not delete
pre-existing environments or build directories to constrain a review. If the
reviewer cannot honor scope, provide an isolated copy of only the relevant
files. Remove only resources this workflow created, following phase 0 ownership
checks.

### Phase 7 — security and sanitizers
- `gitleaks git --redact` over reachable history. **A hit here is an incident**,
  not a
  lint finding: the secret is in history, so rotate it first, then scrub.
  Report and stop; do not rewrite history unprompted.
- `semgrep scan --error --config=auto`, `bandit`, `npm audit`, `pip-audit`, `cargo audit`,
  and `osv-scanner scan source -r .` across every lockfile
- `zizmor` over `.github/`: an unpinned action or injectable `${{ }}` in a
  workflow that holds write permissions is a supply-chain finding, not style
- C/C++/Rust: wire sanitizer CI jobs. ASan+UBSan in one job, TSan in a
  **separate** one — they use incompatible shadow memory and cannot be combined.
  Use `-fno-sanitize-recover=all` so recoverable UBSan findings halt instead of
  merely reporting and continuing.
- Existing sanitizer findings require triage as potential bugs. Report them;
  do not suppress them merely to make the gate green.

### Phase 8 — documentation reconciliation
Now that the code is known-good, make the docs match it:

- Every command in `README.md` — run it. Fix or delete what fails.
- `CHANGELOG.md` — add a retrofit entry describing what actually changed.
- Create `PLAN.md` if absent, recording remaining debt as tracked items.
- Remove stale claims and obsolete instructions.
- Extend the canonical project agent instructions with recurring scan-and-enhance
  and red-drill rules; keep tooling adapters as pointers to that source.
- Record canonical paths enhanced, justified new code, and the final overlap
  check. Link red-drill recipes and green/red/restored-green evidence, including
  any deferred cases with an owner and next action.

## Compliance checklist

Report against this. Mark each **pass / fail / deferred** with a reason — never
silently omit a row.

```
[ ] Formatter clean, whole tree
[ ] Linter clean at max strictness, warnings-as-errors
[ ] Type checker clean at strict (or documented per-file exemptions)
[ ] No dead code (verified, not just tool-reported)
[ ] No unused dependencies
[ ] No magic numbers outside the idiomatic allowlist
[ ] No commented-out legacy code
[ ] No silent fallbacks or placeholder production code
[ ] No unjustified any / ignore / suppression
[ ] Secret scan clean over reachable checked-out history (full checkout if claimed)
[ ] Dependency audit clean, or exceptions documented
[ ] Lockfiles committed; CI installs in locked or hash-checked mode
[ ] CI actions pinned to SHAs, least-privilege permissions, zizmor clean
[ ] Sanitizers wired (native code) and passing
[ ] Tests pass; coverage floor set from the measured baseline and enforced
[ ] Tests actually discovered/executed; affected red drills caught intended defects
[ ] Maintained drill set passes with exact restoration and final green
[ ] Canonical code enhanced; new paths justified; no unintended parallel implementation
[ ] Build succeeds
[ ] Pre-commit installed
[ ] CI workflow runs the same gates as local
[ ] README commands verified working
[ ] CHANGELOG updated
```

## Report format

```
BASELINE     tests X/Y · build ok/fail · lint N · types M
AFTER        tests X/Y · build ok/fail · lint 0 · types 0
RED DRILLS   command · source/runtime · mutation · expected/actual failure · restored green
REUSE        canonical paths enhanced · new paths justified · overlap/callers checked

PHASE 1 format      1,240 files · whitespace only · blame-ignore added
PHASE 3 lint        312 auto · 47 manual
PHASE 4 types       89 fixed · 6 any added  ← debt, listed below
PHASE 5 dead code   23 removed · 4 kept (dynamic dispatch, listed)
PHASE 6 literals    31 extracted · 12 left as idiomatic
PHASE 7 security    2 findings — see below

DEBT
  src/legacy/parse.ts:88   any — untyped third-party response, no @types
  src/api/handler.ts:142   ts-expect-error — upstream bug, tracked <link>

NOT DONE
  MSan — needs instrumented libc++, not available. Deferred.
  e2e tests — no framework present. Out of scope, flagged.
```

## Refuse to

- Modify a dirty working tree.
- Bulk-modify code that is not under version control.
- Delete code you have not verified is unreachable.
- Rewrite git history to remove a leaked secret without explicit instruction.
- Weaken an existing rule that is already stricter than the template.
- Create a parallel implementation without scanning and evaluating canonical work.
- Count surviving mutations, unrelated errors, zero tests, or unverified cleanup
  as successful red drills.
- Report a gate as passing when it was skipped, deferred, or its tool is
  missing. A false green is worse than a red.
