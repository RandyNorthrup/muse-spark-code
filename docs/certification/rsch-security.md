# RSCH-SECURITY certification (2026-11-02, rig `macmini`)

Branch `rec/rsch-security` from `rv/int9` `72d8d5003`. The research
record is `docs/research/agent-security-2026-11-02.md`. This file is
the proof record for the lane's code changes: what the probes
observed before the fix, the red/green drills, and every gate's exit
code on this rig. Tests ran directly here
(`npx vitest run <files> --maxWorkers=3`, the repository's own
timeouts, never `--testTimeout`).

## What changed

- `src/shared/redact.ts`: one any-case unquoted secret-field rule
  (value must look secret-shaped), `passphrase` and key-compound
  suffixes in the unquoted and quoted rules, whole `AIza` keys,
  `dop_v1_`/`pypi-`/`AGE-SECRET-KEY-1` shapes, and the
  `MAY_HOLD_SECRET` literals to reach them (including `passphrase`,
  which the old `passw` literal never matched).
- `src/shared/credentialEnvironment.ts` and
  `CREDENTIAL_ENV_EXACT_NAMES` in `src/shared/constants.ts`:
  credential names classified by meaning (underscore-optional
  spellings, bare `_KEY`, DSN, cookies, webhook URLs, separator-less
  long words, four connection-string names).
- `PROTECTED_PATH_SEGMENTS`, `PROTECTED_FILE_NAMES` and new
  `PROTECTED_FILE_SUFFIXES` in `src/shared/constants.ts`, consumed by
  `src/core/protectedPaths.ts`: composite actions, other CI
  systems, commit-hook configs, `.zed`, `.npmrc`, `.yarnrc.yml`,
  `pnpm-workspace.yaml`, `*.code-workspace`.
- `test/unit/securityHardening.test.ts` (10 tests, all real code, no
  stand-ins); `CHANGELOG.md` `[Unreleased]` Security entries.

## Observed before the fix (throwaway probes, since removed)

`redactSecrets`/`countSecretMatches` on 2026-11-02, before any edit:

```text
"token: opaque-value-12345"        -> unchanged, n=0
"my_token=opaque-value-12345"      -> unchanged, n=0
"github_token: opaque-value-12345" -> unchanged, n=0
"auth_token = opaque-value-12345"  -> unchanged, n=0
"secret: opaque-value-12345"       -> unchanged, n=0
"apiToken: opaque-value-12345"     -> unchanged, n=0
"\"token\": \"opaque-value-12345\"" -> "[redacted]", n=1
AIza…” (46 hex after AIza)         -> "[redacted]3456789", tail kept
dop_v1_… / pypi-AgEI…              -> unchanged, n=0
passphrase: correct-horse-42       -> unchanged, n=0
signing_key/masterKey/session_key  -> unchanged, n=0
```

`isCredentialVariable`: `DATABASE_URL`, `REDIS_URL`, `MONGODB_URI`,
`SENTRY_DSN`, `ENCRYPTION_KEY`, `SSH_KEY`, `KEY`, `APIKEY`,
`PRIVATEKEY`, `SLACK_WEBHOOK_URL`, `SESSION_COOKIE` all `false`;
`MONKEY`/`KEY_PATH` correctly `false`.

`isProtectedPath`: `.github/actions/…`, `.gitlab-ci.yml`,
`.circleci/config.yml`, `bitbucket-pipelines.yml`,
`azure-pipelines.yml`, `Jenkinsfile`, `.travis.yml`,
`.pre-commit-config.yaml`, `lefthook.yml`, `.zed/…`,
`x.code-workspace`, `.npmrc`, `.yarnrc.yml`, `pnpm-workspace.yaml`
all `false`.

Non-findings, also observed: `isPublicAddress` judged all 11 trick
addresses correctly; the shell judge gave no allow to chained,
substituted, redirected, env-prefixed, `git -c` or `env git`
variants of an allowed command (full table in the research record
§3.13); link targets refused parent/root escapes and the host opens
only http/https/mailto.

## Drills (break on purpose, watch it fail, restore)

1. **Red before the fix.** `test/unit/securityHardening.test.ts` as
   first written, against the unfixed tree:
   `Tests 7 failed | 2 passed (9)` (exit 1). The two passes are the
   negative cases (ordinary files, near-miss names), which the fix
   must not break.
2. **Mutant drill after the fix.** `AIza[\w-]{35,255}` temporarily
   reverted to `AIza[\w-]{35}`:
   `Tests 1 failed | 9 passed (10)`, drill exit 1. Restored:
   `Tests 10 passed (10)`, exit 0.
3. **The gate-reach trap, observed live during the fix.** The first
   compound edit left `passphrase:` unredacted because
   `MAY_HOLD_SECRET.test('passphrase: …')` is false (`passw` does
   not occur in "passphrase"); the committed invariant test ("keeps
   the MAY_HOLD_SECRET gate able to reach every rule") now fails any
   future rule shipped the same way.

One test expectation was corrected while writing: `password:
required` was asserted to survive; the long-standing exact-name rule
has always redacted any `password:` value. The code was kept; the
test now asserts the new generic rule's boundary with
`secret: required` instead.

## Suites run (all with `--maxWorkers=3`)

| Suite(s)                                                              | Result                                 |
| --------------------------------------------------------------------- | -------------------------------------- |
| `securityHardening.test.ts`                                           | 10 passed (red beforehand per drill 1) |
| `subscriptionRedaction`, `guardSecrets`, `chatShareScrub`             | 25 passed                              |
| `permissions`, `museCodeProtectedWrites`, `workspacePath`             | 122 passed                             |
| `subscriptionRedaction`, `gistShare`, `guardSecrets` (post-compounds) | 26 passed                              |

`npx vitest related` over the three changed sources was terminated
by this lane after 10+ minutes without output: `redact.ts` is a hub
module and the related graph pulls in a large fraction of the unit
suite. The directly-importing suites above were run instead; the
full unit suite remains hosted CI's. The OS credential-store suites
(`credentialLease` and kin) were not run on this lane (the standing
rule for owner machines; left to hosted CI), and no vault suite was
run.

## Gates (exit codes, this rig)

```text
eslint --max-warnings 0 (touched files)  exit 0
prettier --check (touched files)         exit 0
npm run typecheck                        exit 0
node scripts/check-l10n.mjs              exit 0 (0 problems)
npm run check:reference                  exit 0
npm run check:host-api                   exit 0 (0 problems)
npm run check:plan                       exit 0 (0 drift)
npm run check:roadmap                    exit 0 (current)
npm run check:catches                    exit 0 (baseline match)
npm run duplication                      exit 0 (0 clones)
npm run cycles                           exit 0
npm run deadcode                         exit 0
npm run build                            exit 0 (184 bundles, 0 problems)
```

No new UI sentence was added, so no l10n table changed (check:l10n
still passes); no new command, setting or feature was added, so
`featureCatalog` is untouched (check:reference passes). No paid or
live model call was made; no packed-product run applies to a
research lane whose code change is covered by the suites above.
