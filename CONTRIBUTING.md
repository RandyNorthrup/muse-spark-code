# Contributing

Thank you for helping. This repository is run by its planning document:
`PLAN.md` holds the decisions, the open questions, the milestones and the
definition of done, and `AGENTS.md` holds the working rules every change
follows. Read both before a change of any size.

## Setting up

```sh
git clone https://github.com/RandyNorthrup/muse-spark-code.git
cd muse-spark-code
npm ci
npm run build:dev
```

Press F5 in VS Code to start an Extension Development Host with the
extension loaded; `npm run watch` rebuilds on save. The Muse Code CLI and a
Meta Model API key are optional: the unit tests run against fakes, and the
sign-in gate explains what is missing.

## Before you open a pull request

- Run `npm run quality` and make it green. It runs every gate: formatting,
  ESLint (zero warnings), stylelint, type checks, dead-code and cycle
  detection, duplication, unit tests with coverage thresholds, the
  production build with bundle budgets, `npm audit`, secret scanning and
  semgrep. CI runs the same set on Linux, Windows and macOS plus the
  integration tests, so a green local run is a green CI run.
- Add or change tests with the code. A new check must be seen to fail once
  on purpose; the certification records under `docs/certification/`
  show how that is written down.
- Update `CHANGELOG.md` (Keep a Changelog, under `Unreleased`), the README
  where behaviour changed, and `docs/PRIVACY.md` when anything new leaves
  the machine.
- No new dependency without a reason in the pull request and a
  compatibility check; no suppressed lint rule or `any` without an inline
  reason and a row in PLAN.md §8.
- Keep secrets out: the pre-commit hook runs gitleaks, and nothing in the
  repository may contain a real credential.

## Style

Prettier and ESLint decide formatting and style; the hooks apply them on
commit. Comments explain why, not what. User-facing strings live in
`UI_TEXT` in `src/shared/constants.ts`; timeouts, limits and other magic
values are named constants there too.

## Reporting bugs and proposing features

Use the issue templates. For a bug, run **Muse Spark: Diagnostics** from
the Command Palette and paste the report (it contains no credentials).

## Licence

By contributing you agree that your contribution is licensed under the MIT
licence of this repository.
