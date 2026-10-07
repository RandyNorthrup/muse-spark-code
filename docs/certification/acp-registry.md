# ACP Registry compatibility and release gate (lane ACPREG)

Recorded 2026-10-06, branch `fix/acp-registry-auth`, Kubuntu rig.
Context: the ACP agent (`muse-spark-code-acp`) was submitted to the ACP
Registry (agentclientprotocol/registry PR #661). The registry reads the
latest npm version hourly, runs a daily protocol matrix and quarantines
failing agents. The package name and bin entry are unchanged.

## What changed

- `src/acp/agent.ts` (`authMethod`): besides
  `clientCapabilities.auth.terminal === true`, a literal
  `clientCapabilities._meta["terminal-auth"] === true` now also yields the
  terminal method (`{type: "terminal", args: ["login"]}`, the same shape as
  today's terminal method). Only a literal `true` counts on either form.
  `_meta` is a typed member of the SDK's own `ClientCapabilities` (a
  `Record<string, unknown>`), so no cast and no wire capture were needed;
  the key name itself comes from the registry lane brief.
- `test/unit/acpAgent.test.ts`: new matrix test — `auth.terminal`,
  `_meta` only, both, neither (`{}`), and non-boolean junk (`"yes"`, `1`,
  `0`, a nested object) — junk rides a JSON round-trip through the
  `wireCapabilities` helper (one test-only cast, PLAN.md §8 row 2026-10-06).
- `test/e2e/acpRegistryAuth.e2e.test.ts` (new): spawns the built/packed
  `dist/acp.js` bin over stdio exactly as an installed package would (local
  esbuild layout, or `MUSE_ACP_PACKAGE_DIR` when set), sends `initialize`
  with (a) `auth.terminal`, (b) `_meta` `terminal-auth`, and (c) neither,
  and asserts a `terminal`/`agent` method is offered for (a) and (b) only.
  No per-test timeout: the test takes ~0.4 s against the repo default.
- `.github/workflows/build.yml` (`packages` job): the installed-package
  step now also runs the new e2e file against the packed tarball
  (`MUSE_ACP_PACKAGE_DIR`). The windows/macos/ubuntu leg needs no workflow
  change: the full-tier `unit` job runs `npx vitest run` on all three OS
  and `vitest.config.ts` already includes `test/e2e/**/*.test.ts`.

## Gate-fire record (the test bites)

With the `_meta` branch removed from `authMethod` (restored byte-exact
afterwards, SHA-256 `5f80c39a…e375de` before and after):

- `test/e2e/acpRegistryAuth.e2e.test.ts` failed:
  `AssertionError: expected false to be true // Object.is equality`
  (the `_meta` client got no terminal method).
- `test/unit/acpAgent.test.ts` (`-t "older _meta"`) failed on the same
  break (1 failed, 94 skipped).

With the branch restored, both pass (e2e 1/1, unit file 95/95).

## Held back

The "Available in the ACP Registry" README text is deliberately not added;
it waits until the registry PR merges.
