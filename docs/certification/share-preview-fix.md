# Share preview hotfix (0.17.1) — red drill and fix record

Lane SHAREFIX, worktree `/Users/user/lanes/SHAREFIX`, base `82d50d5e4`
(released 0.17.0). Review RVCM1132B confirmed the shipped bug; lane
SHAREFIX2 answers its three P3 findings (no P1/P2).

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

## The fix (`src/runtime/main.ts`, `src/runtime/sharing/sharingPorts.ts`)

- New `defaultServeOptions()`: `parseCommandLine([])` — the documented
  default — narrowed to `serve`, throwing `exportHistoryUnavailable`
  otherwise. `sharingPorts().read` uses the passed runtime when present and
  otherwise builds one from these options.
- RVSHAREFIX P3-1 (whole class, same commit): `defaultServeOptions`
  and `sharingPorts` moved out of `main.ts` into the import-safe module
  `src/runtime/sharing/sharingPorts.ts`, so the committed render tests drive
  the production ports with a fake backend standing in for `runtimeFor`
  (`main.ts` self-executes on import via `void run()`, so it is not
  import-safe). The backend surface is a minimal structural type
  (`SharingRuntime`: `backend.kind`/`hostFor` returning
  `Pick<AgentHost, 'readSession'>`, plus `close`), which the live
  `RuntimeBackend` satisfies; live-only dependencies (engine factory, taken
  credential values, OS keyring read) arrive as `SharingPortsDeps`, built by
  `sharingDeps()` in `main.ts`. Behaviour is unchanged: the moved bodies are
  byte-identical apart from reading credentials through the deps parameter.
- Sweep: the only other `parseCommandLine` calls in `main.ts` parse real
  user argv (`process.argv.slice(2)`); no other internal literal-argv call
  exists.
- The CLI `share`/`prompts` case builds a runtime from the default serve
  options for a chat target and passes it to
  `sharingPorts(log, runtime, sharingDeps())`, closing it afterwards.
  Non-chat targets keep today's lazy ports (they never touch a backend).

## Red drill

`test/unit/sharePreviewFix.test.ts` holds four tests. The literal-argv scan
now covers both process-entry files (`src/runtime/main.ts` and
`src/runtime/sharing/sharingPorts.ts`) and validates each captured argv
from `unknown` with `z.array(z.string())` — no `as` cast, so no AGENTS.md
rule-4 escape hatch and no `PLAN.md` §8 row (RVSHAREFIX P3). The ACP and CLI
render tests build ports through the production `sharingPorts` factory and
the production `defaultServeOptions()` with a fake backend host whose
`readSession` returns the session history; the CLI test additionally asserts
the backend was created with exactly the empty-argv default's options.

Drill A (the 0.17.0 regression): `parseCommandLine([])` back to
`parseCommandLine(['serve'])` in `sharingPorts.ts`. All four tests fail:

`parseCommandLine(['serve']) must parse: expected 'invalid' not to be 'invalid'`
(the scan), `exportHistoryUnavailable` from `defaultServeOptions()` (the
direct and ACP tests), `expected '' to contain 'Assistant text'` (the CLI
test). Before this lane only the scan test failed; the render tests stayed
green.

Drill B (the review's scenario): `throw new Error(UI_TEXT.exportHistoryUnavailable)`
at the top of the production `read`. Both render tests fail; the scan and
direct-options tests stay green, as they should.

Drill C (the P3 cast guard): a scratch node probe feeding
`["serve", 7]` shows the old `as string[]` form accepts element types
`string,number` with no check, while `z.array(z.string()).parse` rejects the
non-string element.

Both production mutations were restored byte-exact (`sha256sum`
`60aba78ca5049cc45b344aa3f2df63720c29ca9f430d2d2d01d3f4e0b6a50197`
before and after); the scratch probe touched no committed file. The test file
is untouched by the drills (`33dad10c0f76d1b0c4603a352d361b3ef950d8b0a1157c80d0308ef8aa863784`).

Test-environment note: the preview scrubs the OS user name in
`renderPreview` (`src/runtime/sharing/sharingEntry.ts:97`), which runs
before the chat/prompt branch and before `ports.read` — so every preview
reaches `userInfo()`, including saved-prompt previews whose `read` rejects
or is never called at all (the aliased-workspace cases assert
`read` was not called). The committed tests therefore pin `node:os`
`userInfo` to a fixed tester identity: this macbook rig has no passwd entry
and the call throws `uv_os_get_passwd ENOENT`. (The previous revision of
this note wrongly said the existing sharing tests never reach `userInfo()`
because their `read` rejects; corrected for RVSHAREFIX P2.)

## Verification (macbook rig)

- `npx vitest run test/unit/sharePreviewFix.test.ts --maxWorkers=3`: 4 passed,
  repository timeouts.
- `npx vitest run test/unit/runtimeSharing.test.ts test/unit/acpSharing.test.ts
--maxWorkers=3`: 32 passed, 2 failed — both failures are the pre-existing
  aliased-workspace cases in `runtimeSharing.test.ts`, which fail only on
  rigs without a passwd entry (exit 7 with `promptFileInvalid` on stderr:
  the catch-all mask over the `userInfo()` ENOENT, thrown before any `read`
  call). They pass on rigs with a passwd entry (the review's macmini run:
  37 passed) and involve no file this lane touches. `acpSharing.test.ts`:
  27 passed.
- `npm run typecheck` (all five projects), changed-file ESLint/Prettier,
  `npm run check:l10n` (14 UI tables, 14 usage tables, 0 problems),
  `npm run check:reference` (current), `npm run deadcode` (no findings on
  the touched files): green.
- `npm run build`: `dist/acp.js` 235.7 KiB (budget 850 KiB),
  `dist/sharingRuntime.js` 159.1 KiB (budget 175 KiB).
- No new user-visible strings: CHANGELOG entry only. No browser/listener
  tests involved: nothing for the lead to run outside the sandbox.
