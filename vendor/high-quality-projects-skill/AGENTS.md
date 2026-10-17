# AGENTS.md

Entry point for coding agents that support `AGENTS.md`, or for any agent
explicitly directed to this file.

This package holds three vendor-neutral workflows and the configuration they
install. The Claude Code, Cursor, and Copilot files are optional packaging and
discovery adapters around that shared content.

## The workflows

| Workflow | Read this file | Use when |
|---|---|---|
| **Project setup** | [`skills/project_setup/SKILL.md`](skills/project_setup/SKILL.md) | Starting a new project. Grills the idea, confirms a project brief, then scaffolds. |
| **Quality retrofit** | [`skills/quality_retrofit/SKILL.md`](skills/quality_retrofit/SKILL.md) | An existing codebase needs standards applied. |
| **Feature delivery** | [`skills/feature_delivery/SKILL.md`](skills/feature_delivery/SKILL.md) | Add or resume scoped behavior in an existing project. |

They are plain Markdown instructions. Read the whole file before acting on it —
all open with a mandatory scan step that must run before anything is created or
modified.

The directory is named `skills/` because Claude Code requires that layout to
load them as plugin skills. The files themselves are vendor-neutral; the name is
packaging, not a dependency.

## Resolving paths

The instructions use `${SKILL_ROOT}/...` as a placeholder for this package's
root. Resolve it with the script for the active shell. On Windows PowerShell:

```powershell
$SkillRoot = & 'C:\path\to\high-quality-projects-skill\scripts\skill-root.ps1'
```

On Linux, macOS, or another POSIX environment:

```bash
SKILL_ROOT="$(bash /path/to/high-quality-projects-skill/scripts/skill-root.sh)"
```

Both scripts locate themselves, so they work from a git clone, a vendored copy,
or a submodule with no environment configured. They honour `SKILL_ROOT` first,
then `CLAUDE_PLUGIN_ROOT` (which Claude Code sets automatically), then fall back
to their own location. Do not invoke Windows `bash.exe`: it can be a WSL relay
even when no Linux distribution or `/bin/bash` exists.

If your agent cannot execute shell commands, ignore the variable and read the
files directly — `templates/` is plain configuration and the workflows are plain
instructions.

## What is in here

```
skills/project_setup/SKILL.md     discover, confirm, and scaffold a new project
skills/project_setup/references/  Grill Me product and delivery question bank
skills/project_setup/assets/      confirmed PROJECT_BRIEF.md output template
skills/quality_retrofit/SKILL.md  bring an existing codebase into compliance
skills/feature_delivery/SKILL.md  deliver and reconcile scoped behavior changes
scripts/skill-root.{ps1,sh}       resolve SKILL_ROOT from anywhere
scripts/detect-stack.{ps1,sh}     read-only workspace inventory, emits JSON
scripts/build-release.ps1         exact-commit archives and release metadata
scripts/verify-format-safe.py     compare Python ASTs before and after formatting
templates/                        tuned strict configs per language
docs/PHILOSOPHY.md                why the gates are set the way they are
docs/RED-DRILLS.md                shared test/gate failure-verification procedure
docs/CODE-QUALITY.md              language-specific semantic and organization rules
docs/DELIVERY.md                  shared native lifecycle and evidence schema
scripts/verify-delivery.py        read-only record, coverage, and freshness checks
scripts/update-delivery.py        atomic plan updates with conflict detection
```

## Non-negotiables when using this package

These are the rules the workflows themselves enforce. An agent following them
should not need reminding, but they are the ones most often skipped:

- **Scan, reuse, then create.** All workflows open with the native
  `detect-stack.ps1` or `detect-stack.sh`. Never overwrite a config file you did
  not write in this session — read it and extend it. Search existing code,
  components, types, tests, docs, and assets before adding another
  implementation. Enhance canonical work; do not create renamed or parallel
  duplicates. Repeat a focused scan before each change, trace consumers, and
  record reuse or justified new work in the existing plan. Inventory counts
  alone do not prove that an implementation is unique.
- **Every project requires red drills.** Follow
  [`docs/RED-DRILLS.md`](docs/RED-DRILLS.md): baseline green, inject a known
  defect, require the intended assertion/diagnostic and non-zero exit, restore
  exactly, and prove green again. Keep repeatable drills for affected tests and
  gates, and run the maintained set at milestone/release verification. Zero
  tests, unrelated errors, and surviving mutations cannot count as passing.
- **Confirm the project before choosing the stack.** `project_setup` runs its
  Grill Me interview and confirms `PROJECT_BRIEF.md`. Critical product,
  signing, distribution, security, operations, or release decisions cannot be
  replaced with silent defaults.
- **Verify the effect, not the write.** Reading back the value you just wrote
  proves the write worked, not that behaviour changed.
- **Useful, semantic code.** Apply [`docs/CODE-QUALITY.md`](docs/CODE-QUALITY.md)
  for the detected stack. Reject tautological tests, vacuous success paths,
  redundant layers, and comments that add no contract or rationale.
- **Trace delivery to proof.** Use [`docs/DELIVERY.md`](docs/DELIVERY.md) for
  scoped work. Keep one canonical plan, separate requirements readiness from
  implementation verification, reconcile missing work, and reject stale resume
  evidence. Never overwrite a changed plan or replay an unknown external outcome.
- **Never report a skipped or deferred gate as passing.** Say plainly what was
  not run and why.
- **Do not modify global user or machine configuration.** Project-local only.
- **Release only exact tagged source.** Manifest version, changelog heading, and
  annotated tag must agree. Publish only after reusable cross-platform gates,
  package inspection, checksums, and provenance generation pass.

## Compatibility

Requires PowerShell 5.1 or newer on Windows, or Bash and standard POSIX tools on
Linux and macOS. Bash is not required on Windows. `verify-format-safe.py` needs
Python 3. Individual gates need their own tools, and the native `detect-stack`
script reports which are present — it never installs anything and always exits
0.

Native delivery validation and atomic updates require Python 3.12 or newer and
only its standard library. They do not execute commands stored in a plan.

Always inspect the returned JSON for an `error` property. Exit 0 means the
scanner returned its JSON contract; it does not turn `unreadable path` or
`scan failed` into a successful inventory.

Python tools are detected by importability, not by `PATH`. Use the interpreter
in `python_runtime.bin`; `python_runtime.module_only_tools` lists importable
tools without a PATH executable. Usually `<interpreter> -m <module>` works, but
verify the CLI rather than equating an import with an executable gate.

Semgrep rejects `python -m semgrep`; run its installed console scripts with the
selected environment's scripts directory on the child process PATH. Keep
environment changes local and restore them; do not install a duplicate or
change global PATH to repair an invocation.
