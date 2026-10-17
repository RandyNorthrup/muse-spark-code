# QA templates — strict quality gates

Copy-in configs for lint / format / dead-code / test / security gates, tuned to
the strictest setting that is still *correct* rather than merely loud.

**A gate is not configured until it has been seen to fail on a case it is
supposed to catch.** Use the shared [red-drill procedure](../docs/RED-DRILLS.md)
and [language review contract](../docs/CODE-QUALITY.md), including intended
failure, exact restoration, and final green. That discipline is not decoration — three
separate tools have been found here that loaded cleanly, reported nothing, and
checked nothing (see Gotchas).

Compatibility last reviewed 2026-08-20. Re-check tool versions and deliberately
trigger each enabled gate in the target project; these files do not install
their own dependencies.

That review loaded the configs with Ruff 0.16.4, mypy 2.3.1, ESLint 10.8.1,
`@eslint/js` 10.0.1, typescript-eslint 8.67.0, TypeScript 6.0.3,
eslint-plugin-unicorn 73.0.0, Stylelint 17.14.1,
stylelint-config-standard 40.0.0, knip 6.32.2, .NET SDK
10.0.400, cargo/clippy 1.96.0, and PSScriptAnalyzer 1.25.0. These are dated
compatibility observations, not permanent minimums or automatic dependency
pins.

The 2026-09-07 source-backed review and current validation boundaries are in
[`docs/QUALITY-REVIEW.md`](../docs/QUALITY-REVIEW.md). Its 2026-09-24 audit
drilled the pre-commit, mypy, PSScriptAnalyzer, C#, and cargo-deny changes with
the versions it records; `test_templates.py` also parses every template that
the Python standard library can read. Preserve the older snapshot
as history; select project runtimes explicitly rather than copying version or
module defaults as universal choices.

## Layout

| Path | Copy to | Gate |
|---|---|---|
| `python/ruff.toml` | project root | lint + format (`select = ["ALL"]`) |
| `python/mypy.ini` | project root | types (beyond `strict`) |
| `typescript/tsconfig.strict.json` | extend from your tsconfig | types |
| `typescript/eslint.config.mjs` | project root | lint (type-checked) |
| `web/.stylelintrc.json` | project root | CSS |
| `web/knip.jsonc` | project root | dead files / exports / deps |
| `cpp/.clang-tidy` | project root | C++ static analysis |
| `csharp/Directory.Build.props` | solution root | C# compiler + analyzers |
| `csharp/.editorconfig` | solution root, or merge | C# dead-code rule severities |
| `rust/clippy-strict.toml` | see file — two parts | Rust lint |
| `rust/deny.toml` | workspace root | advisories, licenses, bans, sources |
| `powershell/PSScriptAnalyzerSettings.psd1` | project root | PowerShell |
| `workflow/PLAN.md` | extend the canonical project plan | native delivery ledger; Python 3.12+ |
| `.pre-commit-config.yaml` | project root | representative pre-commit hooks |

## Quick start

POSIX shell:

```bash
cd your-project
SKILL_ROOT=/absolute/path/to/high-quality-projects-skill
cp "$SKILL_ROOT/templates/.pre-commit-config.yaml" .
# Copy each relevant language config to the location in the table above,
# delete language blocks you do not use, install/pin remaining system tools,
# then:
pre-commit install
pre-commit run --all-files
```

PowerShell:

```powershell
Set-Location your-project
$SkillRoot = 'C:\absolute\path\to\high-quality-projects-skill'
Copy-Item "$SkillRoot\templates\.pre-commit-config.yaml" .
# Copy each relevant language config to the location in the table above,
# delete language blocks you do not use, install/pin remaining system tools,
# then:
pre-commit install
pre-commit run --all-files
```

## Running gates by hand

Run these as separate commands in the active shell so the first failure remains
visible. Commands still require the corresponding project-local tools.

```console
# Python
ruff check .
ruff format --check .
mypy .
vulture src tests                  # owned source roots
bandit -r .
deptry .
pip-audit

# TypeScript / JS
tsc --noEmit
eslint . --max-warnings=0
knip --strict
dpdm --no-warning --no-tree --exit-code circular:1 src/main.ts
prettier --check .

# CSS / HTML
stylelint "**/*.css" --max-warnings=0
htmlhint .

# C++
cppcheck --enable=all --error-exitcode=1 --project=build/compile_commands.json
clang-tidy -p build src/example.cpp      # use the actual build/source paths

# Rust
cargo fmt --all -- --check
cargo clippy --workspace --all-targets --all-features -- -D warnings
cargo machete
cargo audit
cargo deny check

# C#
dotnet format --verify-no-changes --severity info
dotnet build -warnaserror
roslynator analyze

# PowerShell (run inside PowerShell 5.1+)
Invoke-ScriptAnalyzer -Path . -Recurse -Settings ./PSScriptAnalyzerSettings.psd1 -EnableExit -ErrorAction Stop

# Cross-cutting
gitleaks git --redact             # secrets in reachable git history
semgrep scan --error --config=auto # findings must cause a failing exit
jscpd .                           # configure a project duplication threshold
osv-scanner scan source -r .      # every lockfile against OSV advisories

# GitHub Actions workflows
actionlint
zizmor --offline .github
```

Shell-project gates use POSIX filename expansion:

```bash
find . -type f -name '*.sh' ! -path './.git/*' -exec shellcheck --severity=style --enable=all {} +
find . -type f -name '*.sh' ! -path './.git/*' -exec shfmt -i 4 -ci -sr -d {} +
```

## What each dead-code gate actually sees

They do not overlap as much as the names suggest — running only one leaves
real holes.

- **`tsc --noEmit`** with `noUnusedLocals`/`noUnusedParameters` — unused things
  *inside* a file. Blind to unused exports.
- **`knip`** — whole-graph: files nothing imports, exports nobody consumes,
  `package.json` deps nothing requires. This is the one that finds dead
  *modules*; ESLint and tsc structurally cannot.
- **`vulture`** — Python equivalent, heuristic. Confidence < 100% means it
  guesses; verify before deleting. Dynamic dispatch (`getattr`, plugin
  registries) will produce false positives.
- **`cppcheck --enable=all`** — includes `unusedFunction`. The pre-commit hook
  suppresses that one rule because per-file invocation cannot see cross-TU
  callers and it false-positives constantly. Run cppcheck over the whole `src/`
  tree without the suppression to use it properly.
- **`cargo machete`** — unused `Cargo.toml` deps. `cargo-udeps` is another
  nightly-only option; it is not wired into this template.
- **Roslyn IDE0051/IDE0052** — unused C# private members, via
  `EnforceCodeStyleInBuild` in `Directory.Build.props`.

## Deliberate loosenings

Places where "strictest" is the wrong call, and why:

- **`skipLibCheck: true`** (tsconfig) — type-checking every `.d.ts` in
  `node_modules` is slow and fails on third-party bugs you cannot fix.
- **`disallow_any_explicit = false`** (mypy) — banning explicit `Any` forces
  `object` + casts through JSON and `**kwargs` plumbing; reads worse than the
  problem it solves.
- **`CPY001`** (Ruff) — requiring a copyright header in every Python file is a
  project policy, not a universal correctness rule. Use `LICENSE` and package
  metadata unless the target project explicitly requires headers.
- **`-cppcoreguidelines-avoid-magic-numbers`** (clang-tidy) — too noisy to gate
  on. Enable per-project once the codebase is clean.
- **`CS1591` in `NoWarn`** (C#) — an XML doc comment on every public member is
  busywork. Doc generation stays on so other doc warnings still fire.
- **`multiple_crate_versions = "allow"`** (clippy) — you rarely control
  transitive duplicate versions.
- **`PSAlignAssignmentStatement`** disabled — its required padding conflicts
  with `PSUseConsistentWhitespace.CheckOperator`; enabling both makes one style
  fail whichever alignment is chosen.

Each is a single-line revert in its config file.

Tests retain type/unsafe-assignment checks. Python `assert` is permitted only
in test paths, and PowerShell state-changing functions retain `ShouldProcess`
checks. Domain-local numeric constants need no TypeScript file-wide exemption.

## Gotchas

- **`eslint.config.mjs`, not `.js`.** The config is ESM. Naming it `.js` only
  works when `package.json` has `"type": "module"`; otherwise ESLint dies with
  `SyntaxError: Cannot use import statement outside a module`.
- **`--max-warnings=0`** is what turns ESLint and stylelint into gates. Without
  it, warnings exit 0 and CI passes over them.
- **`EnforceCodeStyleInBuild`** runs supported IDE code-style analyzers during
  build. Set diagnostic severities in `.editorconfig` and drill them; it does
  not promote every suggestion. Keep `dotnet format --verify-no-changes` too.
- **`-EnableExit`** is what makes PSScriptAnalyzer fail a build, and
  **`-ErrorAction Stop`** is what makes an analyzer crash fail it. A rule that
  throws is otherwise a non-terminating error: its findings disappear and the
  command can exit 0 (see `PSUseCorrectCasing` below).
- **The vulture pre-commit hook passes no filenames**, because unused-code
  analysis needs the whole tree. It exits 2 with `Please pass at least one file
  or directory` until the project sets `[tool.vulture] paths` in
  `pyproject.toml` or gives the hook explicit `args`.
- **mypy belongs in a project-environment hook.** `mirrors-mypy` runs in an
  isolated environment holding only its `additional_dependencies`, and its
  default `--ignore-missing-imports` overrides the template's
  `ignore_missing_imports = false`. Every project dependency becomes `Any`, so
  calls into it go unchecked, and `disallow_any_unimported` then rejects
  correct code: `Return type becomes "Any" due to an unfollowed import`. The
  template runs mypy with the project's own interpreter instead.
- **Clippy lint *levels* go in `Cargo.toml`, not `clippy.toml`.** `clippy.toml`
  only tunes thresholds. See `rust/clippy-strict.toml` — it holds both halves.
- **gitleaks allowlists well-known example keys** (e.g.
  `AKIAIOSFODNN7EXAMPLE`). Verify with a randomized, real-shape canary, remove
  it immediately, and keep full-history `gitleaks git` separate from the
  staged-diff pre-commit hook. The template intentionally pins v8.30.0 because
  the v8.30.1 tag is not reachable by `pre-commit autoupdate`; re-check this on
  the next pin refresh.

### Gates that load cleanly and check nothing

Found by deliberately breaking things. Each of these looked configured.

- **`knip.jsonc`, not `knip.json`.** knip 6 validates its config strictly and
  rejects unknown keys, so the `"//": [ ... ]` pseudo-comment convention that
  works in knip 5 is a hard error: `Invalid input (unrecognized_keys: //,
  //rules)`. knip 6 also dropped the `classMembers` rule.
- **`import-x/no-cycle` does not fire.** Against a deliberately circular pair of
  modules it reported nothing, while `import-x/no-self-import` and
  `import-x/no-unresolved` correctly flagged their cases in the same run — so
  the plugin and resolver were both working and that one rule was not. knip 6's
  `cycles` rule was equally silent, by default and under `--include cycles`.
  Use **`dpdm`**, which was verified in both directions:
  `dpdm --no-warning --no-tree --exit-code circular:1 src/main.ts`
- **`madge` declares TypeScript `^5.4.4` as an optional peer.** Normal npm
  resolution rejects that alongside TypeScript 6; bypassing the peer check does
  not make the combination supported.
- **`maxDepth: Infinity`** in any JSON-serialised rule option becomes `null`,
  which can silently disable traversal. Use a finite number.
- **`PSUseCorrectCasing` can crash and still pass.** With PSScriptAnalyzer
  1.24.0 and 1.25.0 on PowerShell 7.6, it intermittently threw
  `NullReferenceException` on this package's own test scripts. In a fresh
  process a planted casing violation then went unreported and `-EnableExit`
  exited 0. The template disables the rule; `-ErrorAction Stop` makes any
  remaining analyzer crash fail the command instead.

### TypeScript 7 is outside typescript-eslint's supported range

Checked against the npm registry on 2026-08-20: `typescript` latest is **7.0.2**
and `typescript-eslint@8.67.0` declares
`peerDependencies.typescript: ">=4.8.4 <6.1.0"`.

Installing TypeScript 7 alone succeeds, but a normal install with the current
typescript-eslint should reject the unsupported peer range. Do not bypass that
error: type-aware rules such as `no-floating-promises`,
`no-misused-promises`, `await-thenable`, and the `no-unsafe-*` family depend on
a supported type checker.

Pin `typescript@6.0.3` — the highest stable release inside the supported range —
until `typescript-eslint` ships TypeScript 7 support. Check before assuming this
is still true:

```bash
npm info typescript-eslint peerDependencies
```

### Prettier conflicts to disable, not fight

`unicorn/number-literal-case` wants uppercase hex digits; Prettier rewrites them
to lowercase. With both enabled, `format` and `lint` can never both pass. The
formatter owns formatting — disable the lint rule.

`unicorn/prefer-global-this` can produce a hard type error in browser-only code:
TypeScript types `window` as `Window & typeof globalThis`, while bare
`globalThis` lacks the Window members, so obeying the rule yields
`TS2345: ... Property 'name' is missing`. Disable it rather than reaching for a
cast.

The templates do not install ESLint, stylelint, or their plugins. Add compatible
versions as project-local devDependencies and commit the lockfile.
