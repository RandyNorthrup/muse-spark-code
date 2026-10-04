# Code quality by language

Reviewed against primary sources on 2026-09-07; the test-depth, supply-chain,
and CI sections were added from primary sources on 2026-09-24. Read the common
contract and the sections for the detected stack before implementation or
template changes.
These are this package's engineering decisions informed by the linked sources;
they are not a claim that a language author endorses every supplied setting.
Select supported runtimes and pin compatible tools in the target project.

## Common contract: useful behavior, clear ownership

- Organize by cohesive responsibility and the project's established dependency
  boundaries. Keep domain decisions separate from transport, storage, and UI
  details where those boundaries exist. Do not introduce layers, factories,
  managers, wrappers, interfaces, or directories without an actual consumer or
  invariant they protect. A small program may need only a few functions.
- Use names that express domain meaning, units, state, and ownership. Keep
  constants and types near their owners; share them when their semantics are
  shared, not merely because their values or shapes match.
- Preserve contracts and public/dynamic entry points when simplifying. Do not
  remove runtime validation because a static type assumes trusted input. Parse
  external values at the boundary and represent missing, invalid, and successful
  results distinctly.
- Reject vacuous production code: empty implementations presented as features,
  success returned without the promised effect, swallowed errors, unreachable
  branches, unused configuration, identity wrappers with no contract, and
  speculative compatibility paths. Empty collections, identity functions,
  abstract declarations, deliberate no-ops, and defaults can be legitimate:
  require a concrete contract and a test, not a blanket syntactic ban.
- Reject accidental tautologies and contradictions: comparing a value to itself,
  constant assertions, checking a known result instead of performing the work,
  or branches whose outcomes are identical. Prove simplifications preserve
  side effects, exceptions, ordering, and concurrency behavior.
- Comments explain intent, invariants, units, constraints, or tradeoffs. Public
  documentation states the usable contract and failure behavior. Do not pad
  either with line-by-line paraphrases, repeated headings, empty sections, or
  claims copied from planned work. Preserve required language documentation
  conventions; a doc comment beginning with a symbol name is not itself fluff.
- Tests use independently specified expected results, observable effects, and
  fixtures where failures can occur. Check non-empty discovery/collections when
  relying on `all`/`every`/`All`; an empty collection can satisfy universal checks.
  Pair inverse/round-trip properties with known examples or an independent
  oracle: two wrong functions can agree. Exercise awaited async work, rejected
  inputs, failure propagation, and boundaries. Follow [red drills](RED-DRILLS.md).
- Fix the source, types, fixtures, configuration, or invocation before adding an
  exception. Scope unavoidable suppressions to a specific rule and location,
  record evidence and review conditions, and revisit them on upgrades. Do not
  disable a correctness rule across production or tests just to reduce findings.

At closeout, identify canonical paths enhanced, justified new responsibilities,
contract/semantic checks, and red-drill results in the existing report. Static
analysis, code coverage, and passing examples complement review; none alone
establish that all generated code is correct.

For cross-language SAST, use `semgrep scan --error` with the selected rules:
ordinary scans otherwise report findings without a failing exit. Pin or retain
the rule source used for repeatable CI, and verify include/exclude scope. See
the [Semgrep CLI contract](https://docs.semgrep.dev/cli-reference/).

## Test depth and performance evidence

Coverage shows which code ran, not whether a test would notice it breaking;
red drills and mutation testing show that. Set a coverage floor from a measured
baseline, leaving only the margin that differs between supported platforms or
runtimes, and raise it as tests improve. Never lower it to admit untested code.
Run mutation testing on the changed code in CI and across the whole project on
a schedule. Add property or fuzz tests where inputs are parsed or unbounded.

| Stack | Coverage floor | Mutation testing | Property / fuzz | Benchmarks |
|---|---|---|---|---|
| Python | [coverage.py](https://coverage.readthedocs.io/en/latest/config.html) `fail_under`, branch on | [mutmut](https://mutmut.readthedocs.io/en/latest/) (needs `fork`; WSL on Windows) | [Hypothesis](https://hypothesis.readthedocs.io/en/latest/) | [pyperf](https://pyperf.readthedocs.io/en/latest/) |
| TS / JS | [Vitest](https://vitest.dev/config/coverage) `coverage.thresholds` | [StrykerJS](https://stryker-mutator.io/docs/stryker-js/introduction/) | [fast-check](https://fast-check.dev/) | [size-limit](https://github.com/ai/size-limit) for bundle budgets |
| Rust | [cargo-llvm-cov](https://github.com/taiki-e/cargo-llvm-cov) `--fail-under-lines` | [cargo-mutants](https://mutants.rs/in-diff.html) `--in-diff` | [proptest](https://proptest-rs.github.io/proptest/), [cargo-fuzz](https://rust-fuzz.github.io/book/cargo-fuzz.html) | [Criterion](https://criterion-rs.github.io/book/index.html) |
| C / C++ | [gcovr](https://gcovr.com/en/stable/manpage.html) `--fail-under-line` | none selected | [FuzzTest](https://github.com/google/fuzztest) | [Google Benchmark](https://google.github.io/benchmark/) |
| C# | [coverlet](https://github.com/coverlet-coverage/coverlet/blob/master/Documentation/MSBuildIntegration.md) `/p:Threshold` | [Stryker.NET](https://stryker-mutator.io/docs/stryker-net/introduction/) | [CsCheck](https://github.com/AnthonyLloyd/CsCheck) | [BenchmarkDotNet](https://benchmarkdotnet.org/) |
| Go | [`go test -coverprofile`](https://pkg.go.dev/cmd/go#hdr-Testing_flags); no built-in floor | no mature tool; record as open | [native fuzzing](https://go.dev/doc/security/fuzz/) | `testing.B` with [benchstat](https://pkg.go.dev/golang.org/x/perf/cmd/benchstat) |

Record performance budgets in the plan with the workload, data size, and
hardware they apply to. Compare benchmarks against a baseline from the same
machine class; shared CI runners are too noisy for absolute wall-clock gates, so
gate on relative change or use a dedicated runner. Time whole commands with
[hyperfine](https://github.com/sharkdp/hyperfine) and profile Python with
[py-spy](https://github.com/benfred/py-spy) before optimizing. A tool listed
here is a starting point: drill it in the project before trusting it as a gate.

## Dependencies and supply chain

- Commit lockfiles and install from them in CI: `npm ci`, `cargo build --locked`,
  `uv sync --locked`, `pip install --require-hashes`, and NuGet
  [locked mode](https://learn.microsoft.com/en-us/nuget/consume-packages/package-references-in-project-files#locking-dependencies).
  Add `--ignore-scripts` to npm installs that do not need package scripts.
- Scan every lockfile together with
  [OSV-Scanner](https://google.github.io/osv-scanner/usage/scan-source)
  (`osv-scanner scan source -r .`) in addition to each ecosystem's audit.
- Automate updates with [Dependabot](https://docs.github.com/en/code-security/reference/supply-chain-security/dependabot-options-reference)
  or [Renovate](https://docs.renovatebot.com/). A short cooldown lets a new
  release age before it is proposed; every update still passes the full gates.
- When the brief requires an SBOM, generate it from the built artifact with
  [Syft](https://github.com/anchore/syft) and publish it beside provenance.
- Lint Dockerfiles with [hadolint](https://github.com/hadolint/hadolint), and
  pin scanner images and actions by digest or SHA. Trivy's own release actions
  were [compromised in March 2026](https://github.com/aquasecurity/trivy/security/advisories/GHSA-69fq-xp46-6x23).

## CI workflows (GitHub Actions)

Workflows run with repository credentials, so review them as production code.
Follow GitHub's [secure use reference](https://docs.github.com/en/actions/reference/security/secure-use):

- Pin every action to a full-length commit SHA with the version as a comment.
  A tag can be moved to different code; a SHA cannot.
- Declare `permissions` at the top (`{}` or `contents: read`) and grant write
  scopes only to the job that needs them.
- Check out with `persist-credentials: false` unless a later step runs
  authenticated Git commands.
- Pass untrusted values such as branch names, PR titles, and issue text into
  `run:` through `env:`; an inline `${{ }}` becomes shell source.
- Set `timeout-minutes` on every job and verify downloaded binaries against a
  pinned checksum.

Gate workflows with [actionlint](https://github.com/rhysd/actionlint) (syntax,
expressions, embedded shell) and [zizmor](https://docs.zizmor.sh/audits/)
(security audits); both are in the pre-commit template.

## Python

Keep cohesive packages and explicit public APIs; isolate I/O and mutable state
from testable domain logic. Use context managers for owned resources, specific
exceptions, and typed boundaries and fixtures. Do not use production `assert`
for authorization or input validation: optimized execution removes assertions.
Use explicit validation and errors. Assertions remain appropriate in tests.
See the [Python assertion semantics](https://docs.python.org/3/reference/simple_stmts.html#the-assert-statement)
and [Ruff S101](https://docs.astral.sh/ruff/rules/assert/).

Match Ruff's target and mypy's Python version to the minimum supported runtime.
Keep Ruff correctness/test rules and mypy's unreachable, redundant-expression,
truthiness, unused-awaitable, explicit-override, and exhaustive-match checks
(the last two mirror TypeScript's `noImplicitOverride` and exhaustive switch
check); annotate test helpers rather than blanket-exempting tests. Run mypy in
the project's environment: an isolated hook cannot see dependency types. Drill constant assertions, always-truthy expressions,
and an unhandled failure. See [mypy optional checks](https://mypy.readthedocs.io/en/stable/error_code_list2.html).

## TypeScript and JavaScript

Choose module resolution and output for the actual host: a bundler, Node, and
a published library have different contracts. The shared strict base must not
choose those product settings. Keep strict nullability, checked indexed access,
and exact optional properties. Treat external input as unknown until validated.
See the [TypeScript configuration reference](https://www.typescriptlang.org/tsconfig/).
If using `skipLibCheck` for dependencies, still validate a library's emitted
declarations in a consumer fixture that checks them; do not apply that exemption
to the public API being delivered.

Use type-aware linting for application code, including JavaScript when the
project uses `allowJs`/`checkJs`. Scope tooling-file exemptions explicitly; an
`.mjs` extension does not mean a file is tooling. Keep promise checks, exhaustive
union handling, unused-symbol checks, and rules against unnecessary conditions,
casts, and empty abstractions. A required unused parameter may use `_`; a dead
local must be removed. Read [typed linting](https://typescript-eslint.io/getting-started/typed-linting/)
and [unnecessary-condition limitations](https://typescript-eslint.io/rules/no-unnecessary-condition/)
before deleting a guard: inaccurate types can hide real runtime cases.

Keep domain constants local and test expectations independent. Drill a missing
union case, an ignored promise, a tautological condition, and any changed test.
For React, keep render pure, state owned, and effects tied to external systems;
do not add mirrored state or effects for values derivable during render. See
[React purity rules](https://react.dev/reference/rules/components-and-hooks-must-be-pure).
Enforce the hook rules with
[eslint-plugin-react-hooks](https://react.dev/reference/eslint-plugin-react-hooks)
(`reactHooks.configs.flat.recommended`).

## Rust

Use modules and visibility to express ownership; keep APIs small and resource
lifetimes explicit. Represent recoverable failure with `Result`/`Option` and
propagate or handle it. Localize unsafe code behind documented invariants and
tests. A deny-unwrap policy must not suggest `expect` when expect is also denied.
See [Rust error handling](https://doc.rust-lang.org/book/ch09-00-error-handling.html).

Cargo lint levels belong in the package manifest, or in `workspace.lints` with
explicit `[lints] workspace = true` in each member. `clippy.toml` only configures
lint options. Verify every member is covered, and test supported feature sets
instead of assuming mutually exclusive features can all be enabled. See
[Cargo workspace inheritance](https://doc.rust-lang.org/cargo/reference/workspaces.html#the-lints-table).

Use rustfmt, compiler/Clippy gates, and tests. Keep correctness checks for
self-comparison, constant assertions, and redundant conditions. Restrict panic
allowances to intentional test cases. Drill a real member violation and failure
propagation; use [Clippy's lint reference](https://rust-lang.github.io/rust-clippy/master/)
for the pinned toolchain rather than enabling conflicting restriction lints.

## C and C++

State ownership, lifetimes, buffer lengths, and error conventions in interfaces.
In C++, prefer RAII, values, standard containers, and explicit ownership types;
avoid manual cleanup duplicated over return paths. In C, pair acquisition and
release on all paths and preserve allocation/I/O failure handling. Do not apply
C++-only checks or a C++ language standard to C files. See the
[C++ Core Guidelines](https://isocpp.github.io/CppCoreGuidelines/CppCoreGuidelines).

Run analysis with the project's compilation database, defines, include paths,
and language standard. Verify header filters match absolute Windows and POSIX
paths and actually cover owned headers. Drill a header diagnostic as well as a
source diagnostic. See [clang-tidy configuration](https://clang.llvm.org/extra/clang-tidy/).
Use supported compiler warnings and the existing [sanitizer guidance](../templates/cpp/sanitizers.md);
prove runtime failures in separate supported builds. A successful parse with
missing headers, wrong flags, or zero tests is not verification.

## C# and .NET

Use namespaces and projects for real boundaries, explicit nullability, owned
`IDisposable`/`IAsyncDisposable` lifetimes, awaited tasks, and propagated
cancellation. Avoid empty catches and success-shaped fallback values. Keep
interfaces tied to contracts and consumers; do not introduce one per class by
default. See [.NET exception practices](https://learn.microsoft.com/en-us/dotnet/standard/exceptions/best-practices-for-exceptions).

Pin the SDK in `global.json`; keep target frameworks and intentional language
overrides in their owning project. Do not force a TFM from early-imported
`Directory.Build.props` or set `LangVersion=latest`. Microsoft explicitly warns
that [latest varies by installed compiler](https://learn.microsoft.com/en-us/dotnet/csharp/language-reference/configure-language-version).

Run compiler, analyzer, formatting, and test gates on every supported target.
Verify relevant IDE diagnostic severity at build time instead of assuming
`EnforceCodeStyleInBuild` enables every suggestion: without the `.editorconfig`
template's severities, an unused private method (IDE0051) builds cleanly. Include a nullable-error
drill and [CA1508 dead-condition drill](https://learn.microsoft.com/en-us/dotnet/fundamentals/code-analysis/quality-rules/ca1508).
Install the selected test framework's analyzers explicitly; the shared props
file does not supply them.

## PowerShell

Use approved verbs, meaningful parameter/output contracts, literal paths, and
object pipelines. Separate machine-readable output from progress messages.
Check native command exit codes explicitly; non-terminating errors and native
failures do not universally follow `try/catch` or `$ErrorActionPreference`.
See [PowerShell preference semantics](https://learn.microsoft.com/en-us/powershell/module/microsoft.powershell.core/about/about_preference_variables).

State-changing functions must implement actual `ShouldProcess` guards around
effects; merely adding `SupportsShouldProcess` is insufficient. Test `-WhatIf`
by verifying the resource is unchanged, plus a real success/failure case on
disposable resources. Follow Microsoft's
[ShouldProcess rule](https://learn.microsoft.com/en-us/powershell/utility-modules/psscriptanalyzer/rules/useshouldprocessforstatechangingfunctions).

Use explicit encodings and restore process state in `finally`. Select real,
installed [compatibility inventories](https://learn.microsoft.com/en-us/powershell/utility-modules/psscriptanalyzer/rules/usecompatiblecmdlets)
and execute on the supported hosts; historical profile matches do not certify
PowerShell 5.1/7 behavior. Drill ignored native failures and empty result sets.
Run the analyzer with `-ErrorAction Stop`: a rule that throws otherwise loses
its findings while `-EnableExit` still reports success.

## Shell

Declare the actual shell dialect. Quote expansions, use argument arrays where
supported, preserve command status, and clean only owned resources with traps.
Avoid `eval`, parsing `ls`, and strings assembled as commands. ShellCheck
[SC2086](https://www.shellcheck.net/wiki/SC2086) explains splitting/globbing risks;
[SC2050](https://www.shellcheck.net/wiki/SC2050) catches literal-only conditions.

Use ShellCheck and shfmt with matching dialects and test the real supported
shells. `set -e` is not universal failure propagation; conditional invocation
can suppress it. Read [SC2310](https://www.shellcheck.net/wiki/SC2310) and drill a
failed child command, filenames with spaces, empty input, and cleanup after
failure. Keep Bash-specific options out of scripts that promise POSIX `sh`.

## HTML and CSS

Use native elements for meaning: headings, landmarks, buttons for actions,
links for navigation, and explicit form labels. Do not replace native behavior
with clickable generic containers or redundant/conflicting ARIA. Follow
[W3C structural-role guidance](https://www.w3.org/WAI/ARIA/apg/practices/structural-roles/).
HTML syntax checks complement keyboard, focus, accessible-name, and screen-reader
verification; they do not replace it. Run [axe-core](https://github.com/dequelabs/axe-core)
against rendered pages in end-to-end tests, for example through
[Playwright](https://playwright.dev/docs/accessibility-testing); automated rules
find a subset of problems, so manual checks remain required. Validate rendered
markup as well as source
templates, including errors, loading, and empty states.

Keep CSS ownership clear, reuse design tokens, and keep specificity bounded.
Reject empty blocks and accidental duplicate rules/properties; intentional
compatibility fallbacks need narrowly configured exceptions and browser proof.
See [Stylelint rules](https://stylelint.io/user-guide/rules/) and its
[duplicate-property options](https://stylelint.io/user-guide/rules/declaration-block-no-duplicate-properties/).
Verify responsive reflow, zoom, contrast, focus visibility, and reduced motion
at the project's supported targets. Drill a duplicate selector and a broken
accessible interaction; a stylesheet lint pass does not establish usability.

## Go

The scanner recognizes Go; there is no supplied Go configuration template.
Choose tooling explicitly rather than treating absent template coverage as a
pass. Follow [Go module organization](https://go.dev/doc/modules/layout) and
[Go review guidance](https://go.dev/wiki/CodeReviewComments): cohesive packages,
consumer-owned small interfaces, explicit error handling, context propagation,
and clear goroutine lifetimes. Avoid generic `utils` packages and interfaces
created before they have a consumer.

Use gofmt, `go vet`, tests, and a compatible pinned analyzer such as Staticcheck
where selected. Check formatting output because gofmt can report differences
without a failing exit. Use the race detector on supported targets, and
fuzz parsers/boundaries where useful. Add [govulncheck](https://go.dev/doc/security/vuln/)
for reachable vulnerability analysis. Drill a swallowed error, self-comparison,
and a regression test; record unavailable tooling and targets as open gates.
