---
name: judge-lint
description: Review production code against the six high-quality-projects criteria with advisory judge findings and independent checks.
---

Read `standards.md` and the strict upstream-compatible `rules.json` pack.
Inspect the changed production code for each applicable criterion. Use a
configured, admitted judge only when available; otherwise report that the
judge did not check it. Do not change the user's chosen model or request a
download. Keep deterministic checks and ordinary review in place.

Every finding is advisory unless the user explicitly selects a severity
gate. Jev/TypeSafe alone cannot fail that gate: require independent evidence.
An unsure or missing answer supplies no opinion. Report the checked
language/kinds and every unsupported or unavailable pair as not checked.

The development evals in `jevlint-evals.json` reference independently labelled
fixtures under the repository's `test/fixtures/judge/lint/standards/`. The
offline configuration in `test/fixtures/judge/lint/upstream/jevlint.json`
assigns `.txt` to the JavaScript grammar to read these fixtures. They
verify mechanics with fake responses; they do not establish model accuracy.
Installed command registration, grammar packaging and skill installation
must be certified before this skill can promise an installed lint command.
