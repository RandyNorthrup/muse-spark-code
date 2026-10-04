---
name: project_setup
description: Scaffold a new project from product discovery through production-oriented quality gates. Runs a multi-round Grill Me interview covering users, outcomes, scope, brand assets and colors, accessibility, platforms, signing, distribution, service model, data, security, operations, and release pipeline before stack selection. Scans first and reuses or extends existing code, assets, and configuration instead of creating parallel duplicates. Creates a confirmed PROJECT_BRIEF, README, CHANGELOG, and PLAN, then configures strict practical linting, type checking, dead-code detection, security scanning, tests, and CI. Use when starting a new project, bootstrapping a repo, asking to be grilled on a project idea, or when the user says "set up a project", "new project", "scaffold", or invokes the project_setup skill. For an existing codebase that needs standards applied, use quality_retrofit instead.
---

# Project setup — discovery before commit one

Scaffold a new project with a confirmed product contract and the strictest
practical standards for its stack. The argument is the initial **project
description**. Use it to seed discovery; even a detailed description does not
silently waive the Grill Me readiness gate.

## Communication style

Status updates to the user: short, direct, no filler. Caveman style if the
[caveman](https://github.com/JuliusBrussee/caveman) plugin is active.

**Never compress**: code comments, documentation, `PLAN.md` rationale,
architectural reasoning, security notes, or commit messages. Brevity applies to
chat only. A terse status line and a thorough `PLAN.md` are not in tension.

## Locating this package

Paths below use `${SKILL_ROOT}/...` as a placeholder for this package's root,
including its `scripts/`, `templates/`, and skill resources. Resolve it once
with the active shell. On Windows PowerShell:

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

## Rule zero: scan, reuse, then create

Run this before anything else, even when the directory looks empty:

```powershell
$Scan = & "$SkillRoot\scripts\detect-stack.ps1" . | ConvertFrom-Json
```

Or from a POSIX shell:

```bash
"${SKILL_ROOT}/scripts/detect-stack.sh" .
```

It returns JSON: languages present, config files that already exist, tools
installed on this machine. Supplement it with a read-only search for existing
code, components, types, schemas, tests, documentation, design-system files,
brand assets, infrastructure, and generated-code boundaries. Then:

- **The JSON contains `error`** → stop. Report the scan failure and do not
  create or overwrite anything.
- **A config file already exists** → read it, extend it, preserve its choices.
  Never overwrite a config you did not write in this session.
- **Reusable assets or project material already exist** → inventory their paths,
  formats, owners, licenses, and consumers. Preserve authoritative originals;
  adapt or derive from them instead of drawing replacements or parallel copies.
- **Source files already exist** → this is not a new project. Say so and offer
  `feature_delivery` for requested behavior changes or `quality_retrofit` for
  quality-only improvements. Reuse clear existing intent without another approval round.
- **A tool is not installed** → do not silently skip its gate. Either install
  it or record it in `PLAN.md` under deferred gates with the reason.
- **A Python tool is listed in `python_runtime.module_only_tools`** → it is
  installed and importable but has no console script on `PATH`, which is the
  normal state of an unactivated venv or a Windows install. Run it as
  `<python_runtime.bin> -m <module>` when that CLI form is supported, and verify
  it executes. Semgrep requires its installed console scripts instead; use the
  selected environment's scripts directory on the child process PATH. Do not
  treat an invocation failure as a missing dependency or install a second copy.

Before creating any implementation or guideline, search by path, symbol,
behavior, and responsibility; read the closest matches and trace their callers,
tests, and configuration. The inventory script is a starting map, not a semantic
duplication check. Record the canonical paths, consumers, and reuse decision in
the existing plan. Repeat this focused scan before each change and after scope
or source changes; the initial inventory is not a permanent clearance.

Extend the canonical implementation when one exists. If replacement is
justified, record the reason and migration plan, update every consumer, prove
behavior, and remove the superseded path only when safe. Do not create a second
helper, component, model, config, asset, or document that performs the same role
under a different name.

Do not force unrelated responsibilities into one abstraction merely because
their code looks similar. Document the distinct contract when separate code is
justified. Before completion, search again for overlap and stale callers.

Creating a conflicting file or parallel implementation is the single worst
failure mode of this skill.

## Phase 1 — Grill Me: confirm the project contract

After the successful scan, read
`${SKILL_ROOT}/skills/project_setup/references/grill-me.md` completely. Run its
discovery interview before choosing the framework, installing dependencies, or
creating product code.

### Interview protocol

1. Seed a draft from the request, workspace evidence, linked material, and
   earlier answers. Never ask the user to repeat known information.
2. Start with who has which problem, why it matters, what the smallest useful
   release does, and how success will be measured.
3. Continue in focused rounds of related questions. Cover every applicable
   domain in the guide, but never dump the whole question bank into one message.
4. Explain material tradeoffs. When the user does not know, offer concrete
   options and a recommended reversible default instead of demanding jargon.
5. Classify every decision as **confirmed**, **assumed**, **open/blocking**, or
   **N/A with reason**. Give each deferred decision an owner, due date, and
   downstream impact.
6. Challenge conflicts and vague goals. "Fast", "secure", "accessible", and
   "cross-platform" need measurable targets and a named verification method.
7. Summarize the resulting contract and ask the project owner to confirm or
   correct it.

Scale the interview to project risk. A local throwaway script needs less depth
than a signed desktop app, public service, regulated system, or paid product.
Depth may shrink; applicable critical coverage may not disappear.

### Readiness gate

Do not select the stack or begin implementation until the brief establishes:

- primary users, problem, desired outcome, success measures, and non-goals;
- first-release journeys and explicit scope boundaries;
- product shape, supported environments, and service/tenant/offline model;
- existing brand assets, color schemes, responsive targets, and accessibility
  evidence for UI;
- data classes, authentication, trust boundaries, privacy, and review needs;
- distribution, installation, updates, signing, and store/notarization needs;
- release environments, CI gates, artifact handling, promotion, and rollback;
- operations, observability, support, incident, backup, and retirement owners;
- real schedule, team, budget, external approvals, and unresolved dependencies.

An inapplicable item must say `N/A` and why. Never turn silence into consent for
credential ownership, signing, distribution, telemetry, data retention, legal
obligations, or production operations. If a critical decision remains open,
stop and ask; neutral scaffolding is not proof that product discovery finished.

### Create and confirm `PROJECT_BRIEF.md`

Copy and adapt
`${SKILL_ROOT}/skills/project_setup/assets/PROJECT_BRIEF.md` into the target
project. Remove template guidance, fill every applicable section, and preserve
the decision ledger. Present the concise decision summary to the project owner.

Mark the brief **Confirmed** only after the owner accepts it and no open decision
blocks stack selection. Keep it current when scope, support, security,
distribution, signing, or release decisions change. `PROJECT_BRIEF.md` defines
what is being built; `PLAN.md` defines how confirmed scope will be delivered.

### Verify compatibility — do not guess

Before installing anything, confirm versions actually work together. Check
official docs, release notes, peer dependencies, or a published compatibility
matrix.

Prefer official documentation and registries. `context7` can help locate current
library docs when available. `npm info <pkg> peerDependencies`, `cargo info`,
and `dotnet list package --outdated` query real package metadata and normally
need network access unless the required metadata is already cached.

Record every version decision and its source in `PLAN.md`. "Latest" is not a
version; pin what you install.

**Worked example — the trap this step exists to catch.** Checked against npm on
2026-08-20, `npm info typescript version` reports `7.0.2`, while
`typescript-eslint@8.67.0` reports:

```
$ npm info typescript-eslint peerDependencies
{ eslint: '^8.57.0 || ^9.0.0 || ^10.0.0', typescript: '>=4.8.4 <6.1.0' }
```

Installing TypeScript 7 alone succeeds, but a normal install with current
typescript-eslint should reject the unsupported peer range. Do not bypass that
error: `no-floating-promises`, `no-misused-promises`, `await-thenable`, and the
`no-unsafe-*` family need a supported type checker. The compatible choice at
the check date is `typescript@6.0.3`; verify again before pinning it.

Check whether this is still true rather than trusting the paragraph above. The
general lesson holds regardless: **the newest version of a language toolchain is
routinely ahead of its lint ecosystem, and taking it can quietly delete a gate.**
Peer ranges are the cheapest place to find that out.

Two more that recur in JS/TS setups:

- `madge@8.0.0` declares optional peer `typescript@^5.4.4`. Normal npm
  resolution rejects that beside TypeScript 6; `--legacy-peer-deps` bypasses
  the declared compatibility constraint. Use `dpdm` instead.
- knip 6 rejects unknown config keys, so the knip 5 `"//": [...]` comment
  convention is a hard error. Use `knip.jsonc`, which takes real comments.

## Phase 2 — quality gates

Read `${SKILL_ROOT}/docs/CODE-QUALITY.md`: apply its common semantic/organization
contract and the sections for the selected languages. Carry them into canonical
project instructions and milestone review; copying lint presets alone does not
enforce useful behavior or prevent tautological tests and vacuous code.

Set up the strictest practical gate set for the stack. Copy from
`${SKILL_ROOT}/templates/` — those configs are pre-tuned and tested,
and each documents its own deliberate loosenings.

| Stack | Format | Lint | Types | Dead code | Security | Test |
|---|---|---|---|---|---|---|
| Python | ruff format | ruff (`ALL`) | mypy strict | vulture, deptry | bandit, pip-audit | pytest |
| TS/JS | prettier | eslint strictTypeChecked | tsc strict+ | knip | npm audit, semgrep | vitest |
| Rust | rustfmt | clippy pedantic | (compiler) | cargo-machete | cargo-audit, cargo-deny (`deny.toml`) | cargo test |
| C++ | clang-format | clang-tidy, cppcheck | (compiler) | cppcheck unusedFunction | sanitizers, valgrind | ctest |
| C# | dotnet format | AnalysisLevel latest-all | nullable+warnaserror | IDE0051/0052 (`.editorconfig`) | NuGetAudit | dotnet test |
| CSS | prettier | stylelint | — | — | — | — |
| HTML | prettier | htmlhint | — | — | — | — |
| PowerShell | PSScriptAnalyzer | PSScriptAnalyzer | — | — | — | Pester |
| Shell | shfmt | shellcheck | — | — | gitleaks | bats |
| Go | gofmt | go vet, selected Staticcheck | (compiler) | selected analyzer + review | govulncheck | go test, race/fuzz where supported |
| GitHub Actions | — | actionlint | — | — | zizmor | — |

Cross-cutting regardless of stack: `gitleaks` (secrets; use `gitleaks git` for
reachable checked-out history), `semgrep` (multi-language SAST), `jscpd`
(copy-paste detection), and OSV-Scanner across all lockfiles. Coverage floors,
mutation testing, property/fuzz tests, and benchmarks per stack are in
`${SKILL_ROOT}/docs/CODE-QUALITY.md`.

### The flags that make a linter a gate

Without these the tool prints findings and exits 0, so CI passes over real
problems. This is the most common way a "configured" gate turns out to be
decorative:

```
eslint --max-warnings=0          stylelint --max-warnings=0
cargo clippy -- -D warnings      cppcheck --error-exitcode=1
knip --strict                    Invoke-ScriptAnalyzer -EnableExit -ErrorAction Stop
semgrep scan --error             (findings must fail the command)
ruff check          (nonzero by default)
mypy                (nonzero by default)
<EnforceCodeStyleInBuild>true</EnforceCodeStyleInBuild>   ← C#, else IDE-only
<TreatWarningsAsErrors>true</TreatWarningsAsErrors>       ← C#
-fno-sanitize-recover=all        ← make recoverable UBSan findings halt
```

### Required red drills for tests and gates

**A gate is not configured until it has been seen to fail on a case it is
supposed to catch.** Read and follow
`${SKILL_ROOT}/docs/RED-DRILLS.md` before configuring or trusting tests and gates.
Every project must retain repeatable drills: baseline green, an intentional
defect rejected by the intended assertion/diagnostic with a non-zero exit,
exact restoration, and green again. Run affected drills when behavior, tests,
configuration, or tools change, and the maintained set at milestone/release
verification. Reuse the project's test runner and CI commands.

The flags above are the common failure. These are worse, because the tool loads
its config without complaint and reports nothing:

- **`import-x/no-cycle` does not fire.** Against a deliberately circular pair of
  modules it reported no findings, while `import-x/no-self-import` and
  `import-x/no-unresolved` correctly flagged their cases in the same run — so
  the plugin and its resolver were working and that one rule was not. knip 6's
  `cycles` rule was equally silent, by default and under `--include cycles`.
  `dpdm --no-warning --no-tree --exit-code circular:1 <entry>` works and was
  verified in both directions.
- **A resolver that cannot resolve reports success on everything.** Any
  import-graph rule is blind to imports it cannot follow, so a broken resolver
  reads as a clean graph. Enable `import-x/no-unresolved` alongside them.
- **`maxDepth: Infinity`** becomes `null` when a rule option is JSON-serialised,
  which can disable traversal entirely. Use a finite number.
- **Coverage thresholds are load-bearing.** When a threshold flags a branch as
  unreachable, consider that it may genuinely be unreachable and the branch is
  dead code. Deleting it is usually right; lowering the threshold rarely is.

The same failure happens in tests, and is harder to spot because the test is
green rather than absent:

- **An assertion on a side effect is only as good as that side effect's ability
  to occur.** A test that pressed the arrow keys and asserted the page had not
  scrolled passed on every run — and passed just as happily against a build with
  the `preventDefault` call deleted, because the layout fitted the viewport and
  the page could never scroll in the first place. Assert the behaviour
  (`event.defaultPrevented`) rather than a downstream symptom of it.
- **Give an assertion a case that must come back negative.** In the fixed
  version above, one key is expected to be *un*suppressed. If every input
  produced the same answer, the assertion would not be distinguishing anything —
  and that is indistinguishable from a broken check.

Record drill commands and evidence in `PLAN.md`, including any gate you could
not get to fire as deferred with its reason, owner, and next action. A gate
reported as passing when it was never verified is the single
failure this skill exists to prevent.

### Sanitizers (C/C++/Rust)

Wire these as a separate CI job, not the default build. Full reference:
`${SKILL_ROOT}/templates/cpp/sanitizers.md`.

```bash
# Default pairing for debug/test builds.
-fsanitize=address,undefined -fno-sanitize-recover=all -fno-omit-frame-pointer -g -O1
# TSan is a SEPARATE build — ASan and TSan use incompatible shadow memory.
-fsanitize=thread -fno-omit-frame-pointer -g -O1
```

For full Rust sanitizer coverage, use a supported nightly target with
`-Zbuild-std`; the shipped standard library is not instrumented, so code inside
it is otherwise outside the sanitizer's coverage:

```bash
RUSTFLAGS="-Zsanitizer=address" cargo +nightly test -Zbuild-std --target x86_64-unknown-linux-gnu
```

PowerShell equivalent:

```powershell
$PreviousRustFlags = $env:RUSTFLAGS
try {
    $env:RUSTFLAGS = '-Zsanitizer=address'
    cargo +nightly test -Zbuild-std --target x86_64-unknown-linux-gnu
}
finally {
    $env:RUSTFLAGS = $PreviousRustFlags
}
```

MSan is clang-only and needs an instrumented libc++ to be usable on real C++.
Do not add an MSan gate unless the project builds its own standard library —
otherwise it reports false positives from uninstrumented library internals.

### Script names

Expose gates under conventional names so CI and humans agree:

`format` · `format:check` · `lint` · `typecheck` · `test` · `test:unit` ·
`test:integration` · `test:e2e` · `test:red` · `build` · `security:audit` · `deadcode` ·
`quality` · `quality:ci`

`quality` runs everything and **fails on any blocking issue**. For stacks
without a script runner (C++, C#), put the same commands in a `Makefile`,
`justfile`, or `Directory.Build.props` target and document them in `README.md`.
Reuse an existing equivalent red-drill command instead of adding an alias with
separate logic. `test:red` succeeds only when defects are caught as intended and
restored-green checks pass; a surviving mutation fails it.

## Phase 3 — code standards

Enforce throughout. These are the rules the generated agent-instruction files
must also carry.

**Reuse before creation**
- Apply rule zero's scan-and-enhance approach before each change, including
  existing code, types, components, utilities, tests, config, docs, and assets.
- Prefer enhancing the canonical implementation over wrappers, forks, copied
  helpers, alternate configs, or renamed duplicates.
- Add a new implementation only when existing work cannot satisfy the confirmed
  contract. Record why reuse is unsafe or insufficient and how overlap is
  prevented.
- When replacing something, migrate consumers and tests; do not leave two active
  paths unless the brief explicitly requires a compatibility period with an
  owner and removal date.

**Constants and literals**
- No unexplained magic numbers, strings, booleans, or timeout values.
- Use named constants, typed constants, enums, literal unions, config objects,
  or schema-validated configuration.
- Idiomatic literals are fine where clarity is not reduced: `0`, `1`, `-1`,
  empty array/string/object, booleans in direct conditions, and array index `0`.
  A magic-number linter that rejects `if (xs.length === 0)` is misconfigured.

**Dead code**
- No dead code, commented-out legacy code, unused files, unused exports, unused
  dependencies, or stale configuration.

**Honesty**
- No silent fallbacks, fake implementations, or placeholder production code.
- No mock data outside test/dev/demo boundaries.
- A function that cannot do its job raises or returns an explicit error. It
  does not return an empty result that reads like success.

**Tests that can fail**
- Maintain red-drill recipes and evidence using the shared package procedure.
- Do not claim passing tests from zero discovery, skipped cases, stale builds,
  or failures unrelated to the intended assertion.

**Escape hatches**
- No broad `any`, unchecked casts, suppressed lint rules, or ignored type
  errors unless justified inline **and** tracked in `PLAN.md`.
- Suppressions name the specific rule and the reason. Never blanket-disable.

**Dependencies**
- Nothing added without purpose, compatibility check, and security review.
- No global installs unless explicitly required and documented.

## Phase 4 — security

- Dependency vulnerability scanning wired into `security:audit`.
- Secret scanning (`gitleaks`) in pre-commit **and** CI. The pre-commit hook
  scans staged changes; use `gitleaks git --redact` in CI and fetch full history
  before claiming a full-history scan. Gitleaks allowlists well-known example
  keys such as `AKIAIOSFODNN7EXAMPLE`, so verify the gate once with a randomized,
  real-shaped canary and delete it immediately.
- Environment variable validation at startup, schema-checked where the stack
  supports it.
- `.env.example` documents every required variable with no real values.
- `.env` in `.gitignore` before the first commit.
- Secure headers, input validation, output encoding where applicable.
- Least-privilege defaults.
- Lockfiles committed and installed in locked or hash-checked mode; update bot
  (Dependabot or Renovate) with a cooldown; SBOM when the brief requires one.
- CI workflows hardened: actions pinned to commit SHAs, top-level read-only
  `permissions`, `persist-credentials: false`, untrusted values passed through
  `env:`, and actionlint plus zizmor as gates. See the supply-chain and CI
  sections of `${SKILL_ROOT}/docs/CODE-QUALITY.md`.

Document security assumptions and accepted residual risk in `PLAN.md`.

## Phase 5 — required documents

### `PROJECT_BRIEF.md`

Confirmed product contract from the Grill Me phase: users · problem · outcomes ·
scope and non-goals · journeys · brand and accessibility · supported platforms ·
service and tenant model · data and trust boundaries · distribution and signing ·
quality targets · release pipeline · operations · ownership · decision ledger.

Do not duplicate the full brief in `PLAN.md`. Link to it and translate confirmed
scope into architecture, milestones, gates, and delivery work.

### `README.md`
Overview · stack · requirements · installation · development commands · build ·
test · quality gate commands · environment variables · project structure ·
deployment notes · security notes · troubleshooting.

Never contains false claims, unverified claims, stale commands, or features
that do not exist. Every command in it must have been run successfully.

### `CHANGELOG.md`
Real implementation history. Update after meaningful change. Track what
happened, not what was planned. Keep superseded entries. Keep a Changelog
format, semver.

### `PLAN.md`
Brief reference · implementation assumptions · resolved technical decisions ·
open non-product questions · architecture notes · research and version-
verification notes · milestones · per-milestone tasks, tests, and certification
gates · security gates · performance gates · documentation requirements ·
definition of done.

Each milestone carries: goal · scope · files affected · implementation steps ·
acceptance criteria · required tests and red drills · required gates · required
doc updates · required security checks · required performance checks ·
certification checklist.

**A milestone is not complete until its certification checklist passes.**

For scoped implementation, use `${SKILL_ROOT}/docs/DELIVERY.md` and the native
plan asset under `templates/workflow/PLAN.md`. Enhance the canonical plan rather
than creating a second tracker. Keep requirements readiness distinct from code
completion, and link acceptance to tasks and current evidence.

### Agent instruction files
Create project-local files for the active tooling: `AGENTS.md`, `CLAUDE.md`,
`.cursor/rules/*`, `.github/copilot-instructions.md`.

They must reinforce: code standards, quality gates, documentation rules,
testing rules, security rules, changelog discipline, planning discipline, and
the requirement to update `PROJECT_BRIEF.md` when the product contract changes.
They must also require the sequence **scan -> reuse or extend -> create only when
needed**, with explicit checks against duplicate code, components, types,
configuration, documentation, and assets.
Require a focused rescan before each change, canonical-path/reuse evidence, and
green -> intended red -> restored green drills for affected behavior and gates.
Keep these project rules in one canonical file; make other active-tool adapters
point to it instead of copying policies into competing files.

**Never create or modify global user memory, global IDE settings, or
machine-wide agent instructions without explicit approval.** Project-local only.

## Phase 6 — performance and visual gates

Where applicable:

- Production build validation — the build must actually succeed.
- Bundle size awareness with a recorded budget.
- For services, libraries, and CLIs: benchmarks of the hot paths the brief
  names, compared against a recorded baseline on the same machine class, and a
  profile before any optimization. Shared CI runners are too noisy for absolute
  timing gates; gate on relative change or use a dedicated runner.
- Lighthouse on visual milestones: **Performance, Accessibility, Best
  Practices**. SEO excluded unless explicitly requested.
- Prefer static/server-side work where the stack favors it.
- Measurable targets, not adjectives.
- Keyboard, focus, semantics, contrast, zoom/reflow, reduced-motion, screen-
  reader, touch-target, and error-state checks required by the confirmed brief.
- Responsive verification across the brief's supported widths, orientations,
  window sizes, and input modes; no desktop-only signoff for a responsive UI.
- Color-token and theme verification for required light, dark, high-contrast,
  and system-theme modes.

For UI projects, milestone certification includes visual verification: local
preview instructions plus screenshots or an explicit manual-check record at the
confirmed responsive targets. Use available browser automation when possible.

## Execution

1. Scan (rule zero). Report what exists.
2. Run the Grill Me interview in focused rounds.
3. Write and confirm `PROJECT_BRIEF.md`; stop on critical open decisions.
4. Verify stack and dependency compatibility against current sources.
5. Write `PLAN.md` — architecture and milestones before code.
6. Scaffold structure, configs, and gates.
7. Install dependencies. Lock them. Verify the install.
8. Run every applicable gate and its red drill. Record behavior-test drills as
   pending until runnable behavior exists; zero tests is not a test pass.
9. Write `README.md` and `CHANGELOG.md` from what actually exists.
10. Commit.

Hand subsequent scoped implementation to `feature_delivery`, carrying the
confirmed brief, canonical rules, plan, and existing authorization. Do not
restart the product interview for settled decisions. Work milestone by milestone.
Do not skip certification gates. Do not
write fallback, legacy, or temporary code to force progress. When blocked by a
product decision, ask.

## Completion report

- Files created
- Grill Me coverage and `PROJECT_BRIEF.md` confirmation status
- Confirmed users, first-release scope, non-goals, and success measures
- Distribution, signing, service, release, rollback, and operations decisions
- Dependencies installed, with pinned versions
- Quality gates configured, and the command for each
- Canonical work enhanced, justified new paths, and final duplication check
- Red-drill evidence: intended failures, restoration, and remaining test gaps
- Commands to run
- Assumptions made
- Open questions, with owner, due date, impact, and blocking status
- First milestone status
- **Gates that failed or were deferred, and why**
- Next recommended action

Do not call the project production-ready unless every documented
production-readiness gate actually passed. If a gate was skipped because a tool
is missing, say that plainly — a deferred gate reported as passing is the one
failure this skill exists to prevent.
