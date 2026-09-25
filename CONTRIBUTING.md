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
  production build with bundle budgets, `npm audit`, the accessibility
  gate, secret scanning and semgrep. CI runs the gates on Ubuntu, Windows
  and macOS, the accessibility gate and the integration tests on Ubuntu and
  Windows, and gitleaks and semgrep as jobs of their own; the PowerShell lint runs only where Windows PowerShell exists, so a
  green run on one platform is not quite the whole set.
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
- `main` is protected: changes land through a pull request with the CI
  checks green, it cannot be force-pushed or deleted, and release tags
  (`v*`) cannot be moved or deleted.

## Style

Prettier and ESLint decide formatting and style; the hooks apply them on
commit. Comments explain why, not what. Timeouts, limits and other magic
values are named constants in `src/shared/constants.ts`.

## Text the user reads

The panel follows VS Code's display language (PLAN.md D33), so text is
never a literal in the code:

- **Panel and host text** goes in the English table,
  `src/shared/l10n/en.ts`, and is read as `UI_TEXT.key` where it is shown,
  never when a module loads.
  - A sentence around a value is one template, `{duration}` in `Thought for {duration}`, filled with `fill`.
  - A count is `forms({ one: '{count} agent', other: '{count} agents' })`,
    read with `plural`.
  - Numbers, percentages, money, durations and dates go through the `Intl`
    helpers in `src/shared/l10n/text.ts`.
- **Manifest text** (commands, settings, the walkthrough) is a `%key%` in
  `package.json` with its English in `package.nls.json`.
- **Text the model reads** is `MODEL_TEXT` in constants.ts and stays
  English.

`npm run check:l10n` checks all of this. It fails a key missing from a
translation, a changed `{slot}`, a wrong set of plural forms, and a
`UI_TEXT` read at module load. `npm run harness:shots -- --lang=pseudo`
renders the panel in a pseudo-locale where any English left outside the
table stands out.

**Adding or changing a key.** Add it to all fourteen tables in `l10n/`,
because the gate fails a language that lacks it. A plural entry needs the
forms that language uses: Russian, Polish and Czech need `few` and `many`;
French, Spanish, Italian and Brazilian Portuguese need `many`; Chinese,
Japanese and Korean need `other` only.

**Correcting a translation.** The translations are machine-made. Edit the
line in `l10n/ui.<language>.json` or `package.nls.<language>.json`, keeping
its `{slots}` and code spans. Run `npm run check:l10n` and
`npm run harness:shots -- --lang=<language>` to see the result.

- **A value that reads the same as English** (a name, or a word the language
  borrows) goes in `l10n/untranslated.json` under that language.

## Paid features

Anything that bills the user beyond tokens follows AGENTS.md rule 12 and
PLAN.md D34: its own machine-scoped setting, off by default, with the price
in its description; the gate in `src/core/paid/paidFeatures.ts` before any
call; a row marked paid; a count in `PaidUsage`. The tests never spend:
the Model API, the Images endpoint and the Muse Voice WebSocket are all
fakes (`test/unit/helpers/fakeModelApi.ts` and `fakeVoiceServer.ts`, a
small RFC 6455 server over Node's own `http`). A live check bills the
owner's key: say what it will cost first and ask.

## Reporting bugs and proposing features

Use the issue templates. For a bug, run **Muse Spark: Diagnostics** from
the Command Palette and paste the report (it contains no credentials).

## Licence

By contributing you agree that your contribution is licensed under the MIT
licence of this repository.
