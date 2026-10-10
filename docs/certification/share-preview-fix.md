# Share preview hotfix (0.17.1) — red drill and fix record

Lane SHAREFIX, worktree `/Users/user/lanes/SHAREFIX`, base `82d50d5e4`
(released 0.17.0). Review RVCM1132B confirmed the shipped bug.

## The bug

`sharingPorts().read` in `src/runtime/main.ts` built its backend options with
`parseCommandLine(['serve'])`. The strict parser treats an empty argv as the
default serve command (`src/runtime/cliArgs.ts`, empty positionals) but the
positional word `serve` as unknown, so the parse returned `invalid` and every
chat-target preview failed with `exportHistoryUnavailable` ("Muse Code did
not return this conversation's history…"). The guard threw before the passed
`current` runtime was even used, so the ACP `/share chat` path (which passes
its runtime) failed too. The CLI `share`/`prompts` case called
`sharingPorts(log)` with no runtime, so it had no session to read either.

## The fix (`src/runtime/main.ts`)

- New `defaultServeOptions()`: `parseCommandLine([])` — the documented
  default — narrowed to `serve`, throwing `exportHistoryUnavailable`
  otherwise. `sharingPorts().read` uses the passed runtime when present and
  otherwise builds one from these options.
- Sweep: the only other `parseCommandLine` calls in `main.ts` parse real
  user argv (`process.argv.slice(2)`); no other internal literal-argv call
  exists.
- The CLI `share`/`prompts` case builds a runtime from the default serve
  options for a chat target and passes it to `sharingPorts(log, runtime)`,
  closing it afterwards. Non-chat targets keep today's lazy ports (they
  never touch a backend).

## Red drill

`test/unit/sharePreviewFix.test.ts` ("parses every internal parseCommandLine
call with literal argv") scans `src/runtime/main.ts` for
`parseCommandLine([...])` literals and asserts each parses to a non-invalid
command through the real parser. Against the base revision (dumped with
`git show HEAD:src/runtime/main.ts` to a temp file, same assertion run from
a scratch spec, both removed afterwards) it fails exactly as required:

`AssertionError: parseCommandLine(['serve']) must parse: expected 'invalid' not to be 'invalid'`

After the fix the same test passes (`[]` → `serve`). The two render tests
(ACP `/share chat` preview and CLI share of a chat target through the real
`runtimeAcpSharing`/`runRuntimeSharing` entries with a history-backed read)
lock the fixed behaviour; they use stub ports rather than the process entry
(`main.ts` self-executes on import via `void run()`, so it is not
import-safe) and pass before and after — the scan test is the fail-on-base
guard.

Test-environment note: the preview scrubs the OS user name via
`userInfo()`, which throws `uv_os_get_passwd ENOENT` on rigs with no passwd
entry, so the test pins `node:os` `userInfo` to a fixed tester identity
(the existing sharing tests never hit this because their `read` rejects).

## Verification (macbook rig)

- `npx vitest run test/unit/sharePreviewFix.test.ts --maxWorkers=3`: 3 passed.
- Existing suite `test/unit/runtimeSharing.test.ts`: unaffected (stub ports,
  no chat-target reads); run in the final gate.
- No new user-visible strings: CHANGELOG entry only, `npm run check:l10n`
  unaffected. No browser/listener tests involved: nothing for the lead to run
  outside the sandbox.
