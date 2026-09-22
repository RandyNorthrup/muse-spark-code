# Copilot instructions

Follow `AGENTS.md` at the repository root. In short:

- TypeScript 6.0.x, strict flags from `tsconfig.base.json`; the webview is a
  separate browser project under `src/webview/`.
- No magic literals outside `src/shared/constants.ts`; no `any`; no
  `eslint-disable` without an inline reason and a `PLAN.md` §8 entry.
- Validate every host/webview message and every external response with zod.
- Secrets only in `vscode.SecretStorage`; never log them.
- Add or update tests with every change; `npm run quality` must pass.
- Update `README.md` for user-facing changes and `CHANGELOG.md` under
  `[Unreleased]` for every meaningful change.
