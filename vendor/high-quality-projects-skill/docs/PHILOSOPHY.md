# Philosophy

Why these rules, and — more importantly — where "strictest" is the wrong call.

A linter config nobody can live with gets disabled wholesale, which is worse
than a moderate one that stays on. Each enabled rule should earn its place by
catching real defects more often than it generates noise; deliberate-trigger
tests are required because configuration alone does not prove that outcome.

---

## Strict means strictest *correct*, not strictest available

Enabling every rule a tool ships is easy and usually wrong. Some rules
contradict each other, some encode one project's house style as universal law,
and some fire so often they train people to ignore output.

The bar used throughout: **would a competent reviewer defend this finding?** If
the honest answer is "no, that's the linter being pedantic," it is off, and the
reason is written in the config file next to it.

Concrete examples of rules deliberately disabled:

| Rule | Why off |
|---|---|
| `readability-identifier-length` (clang-tidy) | rejects `i`, `x`, `os` |
| `cppcoreguidelines-avoid-magic-numbers` | too noisy to gate on; phase 6 handles literals with judgment |
| `bugprone-easily-swappable-parameters` | fires on any two same-typed adjacent params |
| `disallow_any_explicit` (mypy) | forces `object` + casts through JSON and `**kwargs`; reads worse |
| `skipLibCheck: false` (tsc) | fails on third-party `.d.ts` bugs you cannot fix |
| `multiple_crate_versions` (clippy) | you rarely control transitive duplicates |
| `unicorn/prevent-abbreviations` | renames `req`/`res`/`props` against every framework convention |
| `CS1591` (C#) | XML doc on every public member is busywork |
| `PSUseCorrectCasing` (PSScriptAnalyzer) | crashes intermittently; the crash dropped a real finding while the gate exited 0 |

Each is a one-line revert. The point is that the decision was made
deliberately and written down, not that it is permanent.

The former blanket PowerShell `ShouldProcess` exclusion has been removed:
state-changing commands need working `-WhatIf`/confirmation behavior. Rename a
pure function with a misleading mutating verb or justify a narrow exception.
Apply the shared [language and semantic review contract](CODE-QUALITY.md) before
assuming that more flags alone produce better design.

---

## Magic numbers: the rule that needs judgment

The naive version — "no numeric literals" — produces `const ZERO = 0` and makes
code worse. The rule is about **information**, not syntax.

> Does the name tell you something the value does not?

```
setTimeout(fn, 86400000)   →  CACHE_TTL_MS = 24 * 60 * 60 * 1000    extract
if (status === 3)          →  status === OrderStatus.Shipped        extract
retry(5)                   →  MAX_RETRIES = 5                       extract
buffer[1024]               →  kBufferSize = 1024                    extract

if (xs.length === 0)                                                leave
for (i = 0; i < n; i++)                                             leave
return []                                                           leave
arr[0]                                                              leave
if (flag)                                                           leave
HTTP 200/404 in a switch that reads as status codes                 leave
```

`const TWO = 2` adds nothing. `const RETRY_LIMIT = 2` adds everything. Same
literal, different answer, because the question is about meaning.

This is why phase 6 of the retrofit is explicitly judgment-heavy and runs
per-module with tests green after each step. Getting a unit wrong — `86400`
seconds versus `86400000` milliseconds — is a behavior change that looks
identical in a diff.

---

## Dead code: the tools are not authoritative

Dead-code detectors can produce false positives on these common patterns:

- **Dynamic dispatch** — `getattr`, reflection, DI containers, plugin registries
- **String-keyed lookup** — route tables, event maps, serializer registries
- **Library public API** — "unused internally" is the entire point of a library
- **Test-only helpers** — fixtures, `conftest`, factories
- **Framework entry points** — invoked by the framework, never by your code

So the rule is: the tool produces *candidates*, a human or an agent that has
grepped the whole repo produces *deletions*. The `quality_retrofit` workflow
lists an unverified candidate in its report rather than deleting it.

They also do not overlap as much as the names suggest:

- `tsc --noEmit` sees unused symbols **inside** a file, and is blind to unused exports
- `knip` sees the whole graph — dead *modules*, unused exports, unused deps
- `vulture` is heuristic and reports a confidence percentage for a reason
- `cppcheck --enable=all` includes `unusedFunction`, but per-file invocation
  cannot see cross-TU callers, so it false-positives unless run over the whole tree

Running one and calling it done leaves real holes.

---

## Phasing is a correctness requirement, not politeness

A retrofit that lands everything in one commit will be reverted, and the revert
takes the good changes with it.

Formatting is the clearest case. It is intended to change layout only, but can
touch most files and obscure `git blame`. It gets verification, its own commit,
and an entry in `.git-blame-ignore-revs`. Without that entry, reformatted lines
blame the formatting commit instead of the earlier change.

Type strictness is the opposite: small diff, high risk, needs real review.
Bundling it with a 4,000-file format commit guarantees nobody reads it.

---

## A false green is the worst outcome

The failure mode all workflows are built to prevent: reporting a gate as passing
when it was skipped, deferred, or its tool was never installed.

A red gate gets fixed. A green gate that never ran gets trusted, and the bug it
would have caught ships.

A suite can also run every test and still accept broken behavior. Red drills
establish sensitivity by changing the protected behavior while leaving its test
intact. Require the intended failure, not just any non-zero exit; a missing
dependency proves nothing about an assertion. All workflows use the shared
[red-drill procedure](RED-DRILLS.md) and retain evidence of restored green.
This is a recurring project requirement, not a one-time setup demonstration.

So: every gate that could not run is named in the report with the reason. "MSan
deferred — needs instrumented libc++" is a useful sentence. Silence is not.

This extends to documentation. `README.md` must contain no command that has not
been run successfully. A stale command in a README is a false green with a
longer fuse.

---

## Where this philosophy does not apply

- **Prototypes and spikes.** Code you will delete this week does not need a
  strict type gate. Use the skills on code that will live.
- **Vendored or generated code.** Exclude it. Enforcing house style on
  `protoc` output helps nobody.
- **A codebase mid-migration.** Two competing conventions plus a strict linter
  produces noise, not signal. Finish the migration, then retrofit.
- **Someone else's repository.** Do not open a 4,000-file formatting PR against
  a project that did not ask for one.
