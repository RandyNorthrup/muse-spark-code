# Quality review: 2026-09-07

Scope: the initial local review of source based on `753a866`, plus the workflow,
template, test, and documentation changes prepared for v0.5.0. Primary sources
and decisions are linked beside the relevant guidance in
[CODE-QUALITY.md](CODE-QUALITY.md). These results
supersede only the corresponding older template observations.

## Findings corrected

| Area | Finding | Correction |
|---|---|---|
| Workflow | Reuse and failure verification uneven across workflows | Shared red-drill procedure, focused rescans, canonical-path evidence, recurring verification |
| Python | Production assertions and untyped test helpers broadly exempt | Assertions limited to test paths; fixture annotations retained |
| TypeScript | Runtime defaults, global constants bucket, broad local/test/MJS exemptions | Project-owned host settings, domain-local constants, narrow exemptions |
| ESLint | Existing presets accepted self-comparison | Explicit `no-self-compare`; exhaustive union-switch checks |
| Rust | Workspace inheritance unclear; duplicated unwrap bans defeated allowances | Explicit member inheritance and one canonical panic policy |
| C++ | Relative-only header filter missed absolute header paths | Owned directory-component filter for Windows and POSIX |
| C# | Early props forced a TFM and `LangVersion=latest` | Project-owned frameworks/language choice; SDK pinning guidance |
| PowerShell | State-change rule excluded; Core profiles did not exist | Rule restored; real shipped inventories with historical limits |
| SAST | Ordinary Semgrep findings could exit zero | `semgrep scan --error` and verified console-entrypoint guidance |
| Maintainer safety | Reviewer guidance deleted pre-existing environments | Explicit scope or isolated copies |

## Executed template drills

Each row used the current template in a disposable project. The command first
passed, then rejected the intended defect, then passed after restoration of the
original bytes. Unrelated errors received no credit. Commands are relative to
the fixture project with the listed tools installed; use the selected
interpreter/console entry point if an executable is absent from PATH.

| Gate command | Injected defect | Required diagnostic | Exit sequence |
|---|---|---|---|
| `ruff check .` | Production assertion | `S101` | 0 -> 1 -> 0 |
| `ruff check .` | Integer self-comparison | `PLR0124` | 0 -> 1 -> 0 |
| `mypy .` | Code after unconditional return | `unreachable` | 0 -> 1 -> 0 |
| `eslint src --max-warnings=0` | Self-comparison | `no-self-compare` | 0 -> 1 -> 0 |
| `eslint src --max-warnings=0` | Unused `_dead` local | `no-unused-vars` | 0 -> 1 -> 0 |
| `eslint src --max-warnings=0` | Missing union switch case | `switch-exhaustiveness-check` | 0 -> 1 -> 0 |
| `tsc --noEmit` | Undefined returned from boolean function | `TS2322` | 0 -> 2 -> 0 |
| `cargo clippy --offline --workspace --all-targets --all-features -- -D warnings` | Self-comparison in package | `eq_op` | 0 -> 101 -> 0 |
| Same Clippy command in a virtual workspace | Self-comparison in inheriting member | `eq_op` | 0 -> 101 -> 0 |
| `dotnet build --nologo --verbosity quiet` | Redundant condition after early return | `CA1508` | 0 -> 1 -> 0 |
| `clang-tidy src/main.cpp -- -std=c++23` | Self-comparison in included owned header | `tautological-compare` | 0 -> 1 -> 0 |
| `Invoke-ScriptAnalyzer -Path ./canary.ps1 -Settings ./PSScriptAnalyzerSettings.psd1 -EnableExit` | Remove `SupportsShouldProcess` while calling guard | `PSShouldProcess` and state-change warning | 0 -> 2 -> 0 |
| `stylelint domain.css --max-warnings=0` | Duplicate selector | `no-duplicate-selectors` | 0 -> 2 -> 0 |
| `htmlhint domain.html` | Duplicate element ID | `id-unique` | 0 -> 1 -> 0 |
| `semgrep scan --error --metrics=off --disable-version-check --config rules.yml domain.py` | Self-comparison matched by local synthetic rule | `self-comparison` | 0 -> 1 -> 0 |

Additional positive controls:

- A named TypeScript constant local to its domain passes without a file-wide
  exemption; NodeNext module/resolution settings work with the strict base.
- The C# fixture builds both project-owned `net8.0` and `net10.0` targets.
- The PowerShell fixture preserves an absent resource under `-WhatIf`, writes
  under normal execution, and surfaces an invalid-destination failure.
- Every PowerShell compatibility profile exists in the installed analyzer.

Environment: Windows; Python 3.14.0; Ruff 0.16.4; mypy 2.3.1; Node 24.20.0;
ESLint 10.10.0; `@eslint/js` 10.0.1; typescript-eslint 8.69.0; TypeScript 6.0.3;
Unicorn 74.0.0; Rust/Clippy 1.96.0; .NET SDK 10.0.400; clang-tidy 22.1.1;
PSScriptAnalyzer 1.25.0; Stylelint 17.15.0 with standard config 40.0.0;
HTMLHint 1.9.2; Semgrep 1.174.0. npm peer constraints were queried before the
temporary JS install; none were bypassed. Python/JS audit dependencies were
installed only in disposable directories. Existing host tools were reused.

## Package drill harness

`tests/cross-platform-smoke.ps1 -RedDrills` maintains three repeatable drills
using the existing suite: directory pruning, explicit root override, and
unreadable-path errors. Each completed green/red/restored-green under PowerShell
7 and Windows PowerShell 5.1.

The harness was itself checked in an isolated snapshot under both shells. A
surviving mutation, wrong expected diagnostic, and stale mutation anchor each
caused a non-zero parent exit. The snapshot was restored clean afterwards.
Release archives from the isolated current-source snapshot passed structure,
metadata, notes, checksums, and cross-time-zone reproducibility under both shells.

## Limits and follow-up gates

- These are selected semantic canaries, not exhaustive verification of every
  rule, template combination, feature set, or generated project.
- Go, ShellCheck/shfmt, and a standalone C compiler gate were not executed.
  Go/shell guidance uses primary sources; runtime checks remain required in
  target projects. C++ evidence does not certify C. Sanitizers were not rerun.
- HTML/CSS checks prove the named static diagnostics, not keyboard,
  screen-reader, browser, or responsive behavior of an application.
- This local template review ran on Windows. The separate package release gate
  runs the smoke/red-drill suite and archive checks on Windows, Linux, and macOS.
  Consult the [release workflow](https://github.com/RandyNorthrup/high-quality-projects-skill/actions/workflows/release.yml)
  for the tagged commit's result and verify published archive provenance using
  [the installation guide](INSTALLATION.md). Package CI does not expand these
  selected template canaries into cross-platform validation of every language.
- The generic skill validator rejects established underscore names. Names were
  retained for adapter compatibility and checked against folders; remaining
  frontmatter/body checks were exercised on disposable copies with only the
  name normalized.
- This v0.5.0 template review did not include live agent trials. The v0.6.0
  evaluation below covers specific decisions and outcomes; prompt text checks
  and tool drills do not establish behavior for every agent and project.

Ongoing verification: exercise all workflows on representative projects and record
missed behavior. Every release still requires its tagged cross-platform workflow
and independent verification of the published artifacts.

## Native delivery verification for v0.6.0

The shared lifecycle, native ledger, feature-delivery entry point, structural
validator, atomic writer, and workflow handoffs are implemented. New delivery
and evaluation machinery is first-party Python using its standard library.
The previous language-template evidence remains scoped as described above.

Local verification currently passes 46 unittest tests, strict mypy for the ten
delivery source files, Ruff 0.16.4 lint/format, PowerShell 5.1/7 smoke red drills,
and reproducible archive inspection. Tests cover malformed records, coverage,
cycles, stale input/context, false completion, actual file outcomes, artifact
integrity, red-proof rejection, atomic conflicts, interruption, and idempotence.
Two real validator mutations fail existing assertions, restore exact bytes,
and return green. Independent outcome controls reject broken behavior, vacuous
or zero tests, duplicate domain logic, premature changes, forged environment
claims, and replayed side effects.

The first hosted run found missing executable bits on the two new entry points.
Commit `2e39813` corrected their Git modes. All twelve jobs then passed in
[run 34164930093](https://github.com/RandyNorthrup/high-quality-projects-skill/actions/runs/34164930093):
Python 3.12/3.14 on Windows/Linux/macOS, native PowerShell including 5.1,
Bash/PowerShell inventory parity, and release-package checks. Final release
source must pass the same matrix again after evidence reconciliation.

The README uses the tracked warm-ivory, charcoal, and copper artwork. The
GitHub Markdown rendering was inspected with official styles in light/dark
themes at 375px and 1440px widths: no page overflow, one primary heading,
loaded images with meaningful alternatives, and readable comparisons. The
published README and saved GitHub social-preview setting were visually checked.
This is README presentation evidence, not accessibility certification of an
application produced by a workflow.

All 24 live core trials passed independent evaluation: three fresh attempts each
for incomplete discovery, canonical reuse, configuration preservation,
contradictory requirements, vacuous tests, false completion, stale resume, and
uncertain external outcomes. The [compact evidence record](evaluations/v0.6.0.json)
preserves individual outcomes, fixture identities, actual recorded commands,
independent test results, and artifact hashes. Raw workspaces remain under ignored
`dist/behavioral-v0.6.0/` on the evaluation host. No failed outcome was averaged
away or replaced by a self-reported success statement.

A twenty-fifth fresh-agent check resumed an already verified copy of `reuse-1`.
Independent before/after hashing found zero changed existing artifacts. The plan
remained byte-identical at SHA-256
`7e46b9fd7f47d41d104885ba7167470954e1b01ecf23b921bdb8d241bb335164`;
the agent also checked its unchanged modification time. It reran six tests and
Ruff, reviewed still-current red evidence, and created no duplicate task or receipt.

These trials used the supplied Codex collaboration runtime with fresh contexts
on Windows/Python 3.14.0 and Ruff 0.15.9. Session instructions identify the GPT-6
family; the harness does not expose an exact model build, so no build-specific
or cross-model claim is made. Several subjects recovered from an unsupported
PowerShell `-Path` argument by reading the scanner and using `-Root` before any
write. Discovery trials intentionally stop for missing decisions; outcome trials
use local fixture state and do not certify a real deployment. Full application
scaffolding and arbitrary generated projects remain target-project verification,
not capabilities certified by this bounded evaluation.

All three skill files match their folder names. Other generic skill-validator
checks passed on disposable copies with only underscore names normalized, using
Python UTF-8 mode to avoid the system validator's Windows locale-dependent read.
The installed names remain unchanged for package compatibility.

The final code and expanded evidence checks passed all twelve hosted jobs in
[run 34165497453](https://github.com/RandyNorthrup/high-quality-projects-skill/actions/runs/34165497453)
at `40e6d12`. The final documentation/evidence commit `b78723b` also passed all
twelve jobs in [run 34166710142](https://github.com/RandyNorthrup/high-quality-projects-skill/actions/runs/34166710142).

### Publication and installed package receipt

[v0.6.0](https://github.com/RandyNorthrup/high-quality-projects-skill/releases/tag/v0.6.0)
was published from commit `b78723b1a07833e716769678c3af0a612551617a`, annotated tag
object `3674041d48b099e62ab3484e10c374b1ae2e2830`. All thirteen release jobs passed
in [run 34166806043](https://github.com/RandyNorthrup/high-quality-projects-skill/actions/runs/34166806043),
including the reused platform gates and build/attestation/publication job.

All five downloaded assets matched the local exact-tag build byte-for-byte.
Checksums, manifest version/source identity, notes, and all 76 committed files
in both archive formats were independently verified. Archive SHA-256 values:

| Archive | SHA-256 |
|---|---|
| ZIP | `f796d40744836035a93322d1e82bf6217b270c108425dce10173f9ae9f6b8e9f` |
| tar.gz | `3ce31eed4b3e4746772c5f9c180b754d86bfa332430d98b38270f195e74512f6` |

GitHub CLI verified both signed attestations. Their certificate and provenance
fields identify this repository, the exact commit, `refs/tags/v0.6.0`, and
`.github/workflows/release.yml`. A transient verifier initialization error on the
tarball was resolved by a sequential retry; both final verifications succeeded.
Local receipts remain under ignored `dist/verification-v0.6.0/`.

The canonical installed clone was fast-forwarded to the verified release.
All 76 installed files matched the published ZIP byte-for-byte. Existing setup
and retrofit junctions were retained, and the feature-delivery junction was
added. A fresh read-only Codex `skills/list` request with `forceReload` returned
exactly one enabled result for each namespaced workflow. No model turn was
needed for discovery verification.

This post-publication receipt is maintained on main. The installed clone remains
at exact release source; the immutable tagged plan records its prerequisite
boundary, while this audit and the current plan record completed publication.
No implementation or required release gate remains open.

## Post-release audit: 2026-09-24

Scope: an audit of `1789ed0` (v0.6.0 plus evidence commits) for missing tools,
gates this repository prescribed but did not run on itself, and template
defects. Every finding below was reproduced before it was fixed. The earlier
sections remain the record for their own dates.

### Findings corrected

| Area | Finding | Correction |
|---|---|---|
| C# template | `Directory.Build.props` has been malformed XML since v0.5.0 (`--` inside a comment); MSBuild failed with `MSB4024` | Comment reworded; `tests/test_templates.py` parses every template the standard library can read |
| C# template | IDE0051/IDE0052 were listed as the dead-code gate, but no severity was configured, so an unused private method built cleanly | `csharp/.editorconfig` sets IDE0051, IDE0052, IDE0059, IDE0060, and IDE0005 to error |
| PowerShell template | `PSUseCorrectCasing` threw `NullReferenceException` intermittently (1.24.0 and 1.25.0, PowerShell 7.6.6); a planted violation went unreported with exit 0 | Rule disabled with evidence; all documented commands add `-ErrorAction Stop` |
| mypy template | No equivalent of TypeScript's override and exhaustive-switch checks | `explicit-override`, `exhaustive-match`, `mutable-override`, `truthy-iterable`, `deprecated` |
| Pre-commit template | vulture hook exited 2 without paths; mirrors-mypy turned dependencies into `Any`; ShellCheck hook needed Docker; `mixed-line-ending --fix=lf` rewrote CRLF-by-policy files | Hook `args`; project-environment mypy hook; `shellcheck-py`; `--fix=no` |
| Rust template | cargo-deny was a listed gate with no policy; its defaults rejected even an MIT crate | `rust/deny.toml` |
| `verify-format-safe.py` | Missing, undecodable, or directory input exited 1 ("AST changed"); valid Latin-1 source rejected | Parses bytes; input errors exit 2; tests added |
| Plan writer | Replacement plan became owner-only (0600) on POSIX | Mode preserved or umask-derived; directory flushed after rename |
| Release builder | The documented `build-release.ps1 -Version` step recursively deleted the ignored `dist/`, including unrelated local files | Replaces only its own artifacts; refuses a directory holding anything else; release smoke test checks a sentinel |
| `detect-stack.sh` | Unescaped JSON root; case-sensitive matching unlike PowerShell; one tree walk per extension | Escaped strings, one case-insensitive walk, parity-checked |
| Repository gates | ShellCheck, shfmt, PSScriptAnalyzer, vulture, Bandit, gitleaks history, coverage, and mypy on tests were not run by CI | Frozen pre-commit configuration and CI jobs run them all |
| CI supply chain | Actions pinned to movable tags; credentials persisted by checkout; no timeouts; unhashed tool installs; no update automation | SHA pins, `persist-credentials: false`, timeouts, hash lock, Dependabot with cooldown |

### Executed drills

Each row passed first, failed for the named reason, then passed again after
byte-identical restoration, unless the row states otherwise. Commands ran in
disposable copies or fixtures; the working tree was never mutated.

| Gate | Injected defect | Required diagnostic | Exit sequence |
|---|---|---|---|
| `unittest tests.test_verify_format_safe` | Original helper, before the fix | four failures (`1 != 2`, `1 != 0`) | 1 -> 0 after fix |
| `unittest tests.test_update_delivery` (Linux) | Remove mode preservation | `AssertionError: 384 != 420` | 0 -> 1 -> 0 |
| `unittest tests.test_templates` | Original props template | `ParseError: … line 32, column 11` | 1 -> 0 after fix |
| mypy 2.3.1 with the template | Missing `@override`; missing match case; narrowed mutable attribute; truthiness of an `Iterable`; call to a `@deprecated` function | `[explicit-override]`, `[exhaustive-match]`, `[mutable-override]`, `[truthy-iterable]`, `[deprecated]` | 0 -> 1 -> 0 each |
| Template pre-commit hooks | Wrong return type; unused function; lost executable bit; unknown `github` property; unpinned action | `[return-value]`, `unused function 'orphan'`, `marked executable`, `nonexistent_property`, `unpinned-uses` | 0 -> 1 -> 0 each |
| `dotnet build` with both C# templates | Unused private method; unread field; overwritten value; unused parameter; unnecessary `using` | IDE0051, IDE0052, IDE0059, IDE0060, IDE0005 | 0 -> 1 -> 0 each |
| `cargo deny check` with the template | License outside the allow-list; wildcard path dependency | `rejected`; `wildcard` | 0 -> 4 -> 0; 0 -> 2 -> 0 |
| `coverage report` (Linux) | Remove `test_verify_format_safe.py` | `total of 80.7 is less than fail-under=82.0` | 0 -> 2 -> 0 |
| `cross-platform-smoke.ps1 -RedDrills`, PowerShell 7 and 5.1 | Six maintained mutations | Each existing assertion message | 0 -> 1 -> 0 each |

Additional observations:

- PSScriptAnalyzer, ten fresh processes each: the new template exited 0 on a
  clean script every time and 1 on an alias violation every time. With the
  casing rule re-enabled and `-ErrorAction Stop`, three crashes all exited 1.
- The superseded hooks, observed directly: mirrors-mypy rejected correct code
  with `Return type becomes "Any" due to an unfollowed import`; the old vulture
  hook printed `Please pass at least one file or directory`; `--fix=lf`
  rewrote a uniformly CRLF `.ps1` and exited 1, while `--fix=no` passed it and
  still rejected a mixed file.
- A first smoke drill that removed `ToLowerInvariant()` survived: PowerShell
  hashtables already compare keys case-insensitively. It was replaced with the
  case-insensitive directory-pruning drill rather than counted.
- Scanner parity on a mixed-case fixture: bash and PowerShell now agree on every
  section; the previous bash scanner counted `Build/` and missed `.TS` and `.H`.
  On a local multi-project workspace with more than 29,000 counted source
  files, the previous bash scanner took 480.0 s, the new one 16.3 s, and
  PowerShell 16.5 s, with identical counts (Git Bash on Windows). On Linux, a directory
  named with a quote, backslash, and tab produced invalid JSON before the change
  and an exact root afterwards.
- `requirements-dev.txt` installed with `--require-hashes` on Windows (Python
  3.12.14 and 3.14.0) and Linux (3.14.7). Under 3.12 the suite passed 58 tests
  at 84.2% coverage. Coverage measured 83.1% on Windows and 83.3% on Linux.
- The repository pre-commit configuration passed on all 87 files, the smoke
  suite passed under PowerShell 7 and 5.1, actionlint and zizmor reported no
  findings, and gitleaks found no leaks in 31 commits.

Environment: Windows 11, PowerShell 7.6.6 and Windows PowerShell 5.1, Python
3.14.0 and uv-managed 3.12.14; Arch Linux on WSL2 with Python 3.14.7. Ruff
0.16.4, mypy 2.3.1, coverage 7.16.1, Bandit 1.9.4, vulture 2.16, pre-commit
4.6.2, ShellCheck 0.11.0, actionlint 1.7.12, zizmor 1.30.1, PSScriptAnalyzer
1.25.0, .NET SDK 10.0.401, cargo 1.96.0, cargo-deny 0.19.9, gitleaks 8.30.1.
The pinned CI gitleaks 8.30.0 archive matched its published SHA-256.

### Limits and open gates

- Hosted CI: all thirteen jobs passed in
  [run 36073624130](https://github.com/RandyNorthrup/high-quality-projects-skill/actions/runs/36073624130)
  at `1c43b29`, including macOS, the POSIX parity and escaping check, the
  repository hooks, and the full-history gitleaks scan. The release job runs
  only for the v0.7.0 tag; its receipt is recorded after publication.
- `release-package-smoke.ps1` passed on the committed tree under PowerShell 7
  and Windows PowerShell 5.1.
- The release-builder defect was found by running the documented v0.7.0 build
  step, which deleted this checkout's ignored `dist/` before the fix. Its
  earlier contents were not listed first and could not be recovered. If the
  v0.6.0 raw trial workspaces and local verification receipts named above were
  still there, they are gone; the committed evaluation record, hashes, and this
  review are unaffected.
- Dependabot's `uv` and `pre-commit` ecosystems are configured from its
  documentation; their handling of this lock and these frozen revisions is
  unverified until the first scheduled run.
- The release workflow keeps `uses: ./…` instead of zizmor's suggested `$/…`
  self-repository form, because only a tagged release exercises that path.
- New guidance tools (mutation, property/fuzz, benchmark, axe-core,
  OSV-Scanner, Syft, hadolint) cite verified primary sources but were not
  drilled here; target projects must drill them before relying on them.
- No Go, Java/Kotlin, or Swift templates were added. The skill wording changed;
  live agent trials were not rerun for it.
- The scanners' Python interpreter probes (as before) and the new bash
  PowerShell-module probe run without a timeout; a hung interpreter would stall
  the scan. None hung in these runs.
