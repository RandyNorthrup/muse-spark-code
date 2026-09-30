# PR #61 — compatible grouped development dependencies

## Scope and readiness

Source preparation only; runtime, full quality and hosted acceptance remain
open. Original Dependabot head `6155ada003931c8e06b79b95fec4ee47edbb6b19`
is preserved locally as `origin/pr61-preserved`. The isolated integration
starts at main `327094412dac315b1f8dcf971b014c6c69b27104`.

| Dependency                 | Change          | Registry compatibility checked 2026-09-30                                                      |
| -------------------------- | --------------- | ---------------------------------------------------------------------------------------------- |
| `@agentclientprotocol/sdk` | 1.4.0 → 1.5.0   | zod peer `^3.25.0                                                                              |     | ^4.0.0`; current 4.6.5 fits. |
| `jsdom`                    | 30.1.0 → 30.1.1 | Same Node floor: `^22.22.2                                                                     |     | ^24.15.0                     |     | >=26.0.0`. Optional canvas peer remains `^3.2.3`. |
| `prettier`                 | 3.9.8 → 3.9.9   | Node >=14; no peers.                                                                           |
| `typescript`               | Keep 6.0.3      | Grouped 7.0.2 rejected: `typescript-eslint@8.70.1` accepts `>=4.8.4 <6.1.0`. No peer override. |

Primary release sources:

- [ACP SDK 1.5.0](https://github.com/agentclientprotocol/typescript-sdk/releases/tag/v1.5.0):
  updates schemas to 1.23.0 and 2.0.0-alpha.5. Published classic ACP
  implementation, connection and stream modules were compared with 1.4.0;
  existing application imports stay on v1. New optional notices are neither
  emitted nor advertised here. No new external shape or v2 support is claimed.
- [jsdom 30.1.1](https://github.com/jsdom/jsdom/releases/tag/v30.1.1):
  focus, CSS, parsing and selector fixes, including a focus regression in
  30.1.0. Webview tests and accessibility gates must exercise the resulting
  development environment; this package is not a product runtime dependency.
- [Prettier 3.9.9](https://github.com/prettier/prettier/releases/tag/3.9.9):
  fixes Markdown dollar-sign parsing. Keep existing formatting gate unchanged.

## Lock and source inspection (2026-09-30)

The compatible lock was rebuilt from main's existing lock with only the
three approved exact pins. This removes TypeScript 7's optional platform
packages and avoids its unrelated ESLint dependency relocation. Main's
TypeScript 6.0.3 and ESLint 8.70.1 dependency records remain unchanged.
Besides the three direct upgrades, jsdom changes its own encoding sniffer
to 7.0.0 and XML serializer to 6.0.0. The application's direct encoding
sniffer 6.0.0 used by the bundled page worker stays intact; no host, worker
or ACP application source changed. `npm audit --json` reported zero
vulnerabilities, and the locked-only install ran with scripts disabled.
These are registry/source checks, not installed runtime evidence.

Detailed original archive, registry JSON, SDK tarballs and byte comparison,
first lock attempt and resulting minimal lock inspection are retained under
the external `pr61-compatible-source-20260930` evidence directory.

## Required next evidence

Exact lock audit and source-delta inspection, all five types, affected
ACP/runtime and webview tests, formatting/static gates, independent review,
fresh locked installs and full quality on Windows host, Windows VM, Mac mini
and Kubuntu, then exact-head hosted CI. Package and runtime proof must cover
any changed shipped ACP dependency. Existing captures remain evidence of
their captured shapes only; any newly implemented wire capability would need
its own genuine capture. No models, real credentials or paid calls run during
this preparation. Primary 0.10 release has scheduling priority.
