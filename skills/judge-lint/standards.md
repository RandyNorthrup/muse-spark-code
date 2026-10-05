# Muse Spark Code (Unofficial): first-party lint criteria

These six criteria apply to production code. They are derived from
`vendor/high-quality-projects-skill/docs/CODE-QUALITY.md` and the repository's
AGENTS rules. Judge findings assist a review. Keep deterministic checks;
Jev/TypeSafe alone cannot fail a gate.

## no-silent-fallback

Fail when a failed operation is disguised as a successful default or empty
result. Pass when failure is explicit and distinguishable from a legitimate
empty result. A documented optional capability returning an explicit
unavailable result is valid.

## no-placeholder-production-code

Fail when production code promises an effect it cannot perform, including a
stub, fake implementation or unreachable promised branch. Pass when it does
the promised work or returns an explicit unsupported/error result. Abstract
declarations and deliberate, documented no-ops are valid.

## no-production-mock-data

Fail when a production path presents invented examples, fixtures or canned
responses as actual results. Pass when the result comes from its stated
source. Mocks and synthetic data within test boundaries are valid; examples
clearly labelled as examples are valid.

## actionable-errors

Fail when an error provides neither a useful cause nor a way to fix or
investigate it. Pass when the caller receives the failed operation and a
concrete remedy or diagnostic reference. Do not reveal source content,
credentials or private provider output to make an error more descriptive.

## explained-values

Fail when a nontrivial domain threshold, limit or unit conversion has no
name, units or explanation. Pass when its meaning and units are clear from a
named constant or domain value. Ordinary indices, zero/one identities and
values intrinsic to an independently specified algorithm are valid.

## honest-function-names

Fail when a function's name promises behavior or an effect it does not have,
or hides a materially different effect. Pass when its name describes its
actual result and effects in context. Established API names may be kept
when their contract is clear.

The independently hand-labelled examples are under
`test/fixtures/judge/lint/standards/` and their manifest is
`test/fixtures/judge/lint/standard-evals.json`. That manifest is a local
label inventory, not a claim of upstream jevlint eval compatibility or model
accuracy. `pack.json`, `rules.json` and `jevlint-evals.json` use the pinned
upstream revision's formats. The evals reference the same `.txt` fixtures.
The offline config under `test/fixtures/judge/lint/upstream/` uses upstream's
explicit JavaScript extension override to read them. These are development
evals; installed packaging is Z's work.
