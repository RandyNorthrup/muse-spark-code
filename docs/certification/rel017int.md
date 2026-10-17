# REL017INT — 0.17.0 release integration and the last reds (2026-10-09)

Lane on Kubuntu, worktree `rel017/int` from `ba7f703ce` (PR #145 head after
POSTSPAWN). No model calls. Tests ran with the repository's default
timeouts.

## Integration

| Step                                               | Result                                                                                                                                                                                                                                                                                                                                         |
| -------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `git merge --no-ff rel017/citime` (`fc186cd94`)    | Clean.                                                                                                                                                                                                                                                                                                                                         |
| `git merge --no-ff rel017/actbudget` (`32865d0d3`) | Clean.                                                                                                                                                                                                                                                                                                                                         |
| cherry-pick `56a4fb51f`, `abc82f12f`, `e929d6b64`  | CHANGELOG conflict on `56a4fb51f` (both sides' Fixed entries kept). Landed in the order `abc82f12f`, `56a4fb51f`, `e929d6b64`: an aborted sequence had rolled the first pick back, and it was re-applied from its resolved commit. Each file matches `e929d6b64`. `932b81647`/`643437288` not taken. `npm run prepare` ran after the hook fix. |
| `git merge --no-ff rel017/docs` (`fad4ddaef`)      | CHANGELOG conflict under Changed: both sides kept.                                                                                                                                                                                                                                                                                             |

## Reds

### `check:cycles` (dpdm)

Four cycles, red since spawn4 (the same four appeared through
`resourceGovernorEntry.ts` before POSTSPAWN):

1. `admission.ts → resourceProcessEntry.ts → process.ts → admission.ts`
2. the same through `mcpJobLaunch.ts`
3. `… → resourceProcessEntry.ts → runtime/resources/jobs.ts → shellJob.ts → processTree.ts → admission.ts`
4. the same through `jobBuild.ts → bootstrapCommand.ts`

Root cause: the admission facade held the window's admission state _and_
lazily imported the launcher entry, whose modules import that state; and the
launcher entry re-exported the runtime's Windows helper preparation, which is
a client of the launcher (its compiles are bootstrap launches through the
facade).

Fix:

- The three lazy launch shims (`spawnResourceProcess`, `execResourceFile`,
  `handoffResourceFile`) moved verbatim to `src/core/resources/launcher.ts`;
  their twelve callers import them from there. `admission.ts` keeps the state
  and imports nothing from the launcher.
- `dist/resourceAdmission.js` is built from `admissionEntry.ts`, which
  re-exports both, so the state and the shims still ship once.
  `sharedResourceAdmission` maps both source files to that bundle (and leaves
  them inline when building it); the M107 resource check allows the three
  files only there.
- `runtimeResourceJobs` left `resourceProcessEntry.ts`. The runtime's
  `load.ts` imports it statically; it ships in `dist/acp.js`, which already
  carried the job builders. The split check: `RESOURCE_PROCESS_SHARED`
  (`mcpJobLaunch.ts`) must be in the launcher bundle; the governor still must
  carry none of `RESOURCE_LAUNCH_SHARED` (now including `jobs.ts`).
- Tests that replaced a shim through `vi.mock('…/admission')` mock
  `…/launcher` instead (the Windows vault native case keeps its admission mock
  for `admitBootstrap`); `spawnRuntimeAdmission` spies on the jobs module
  instead of injecting it through `loadBundle`; the spawn inventory and its
  table in `int0170-combined.md` name `launcher.ts` for the four forwarding
  sites.

Sizes (production build): `dist/resourceProcess.js` 35.6 → 24.1 KiB (cap 50),
`dist/acp.js` 233.1 → 234.9 KiB (cap 850), `dist/resourceAdmission.js`
3.2 KiB (cap 25), `dist/extension.js` 549.4 KiB unchanged. No cap changed.

### Models activation budget

`modelsActivationBudget.test.ts` passes on the integrated head:
`Activation baseline=560851 current=562563 growth=1712` (limit 3,072 B).
The 26,271 B reported earlier came from the Model API session store at
activation, which ACTBUDGET017 (`rel017/actbudget`, merged above) made lazy
(`dist/modelApiSessions.js`). No cap or baseline changed.

### jscpd

One real clone (10 lines, 51 tokens) inside
`test/unit/modelApiLoopGuarantees.test.ts`: two cases parsed a command-hook
config and built the hook-runner rig identically. Both call
`setupCommandHooks`; hooks and assertions unchanged (42/42). jscpd: 0 clones.

## Drills (each restored, SHA-256 compared)

| Break                                                                                 | Result                                                                                              | Restored               |
| ------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- | ---------------------- |
| `admission.ts` re-exports `spawnResourceProcess` from `./launcher`                    | `npm run cycles` exit 1: `admission.ts -> launcher.ts -> resourceProcessEntry.ts -> process.ts`     | `3bd7f777…7124ebe`     |
| `resourceProcessEntry.ts` re-exports `runtimeResourceJobs` again                      | `npm run cycles` exit 1: `bootstrapCommand.ts -> launcher.ts -> resourceProcessEntry.ts -> jobs.ts` | `0be7a313…bf43eef5`    |
| `sharedResourceAdmission` maps only `admission.ts` (launcher inlined in every bundle) | `deferredBundles.test.ts` exit 1: "M107 keeps every policy module and admission state out …"        | `acf71571…d0304516158` |

## Tests run (Kubuntu, default timeouts)

`deferredBundles`, `spawnRuntimeAdmission`, `spawnGovernance`,
`reportHistory`, `windowsVaultTransport`, `windowsVaultNative`,
`macVaultTransport`, `mediaConvert`, `nativeScheduleBackground`,
`vault/channel`, `windowsTrustedPath`, `spawnProfiles`, `spawnBoundaries`,
`attestedJob`, `spawnBootstrap`, `resourceStops`, `resourceAdapters`,
`resourceMuseLifecycle`, `runtimeResources`, `execTestLauncher.e2e`,
`gitHookStubs`, `scheduleEvents.local`, `spawnInventory`,
`modelsActivationBudget`, `modelApiLoopGuarantees`: all pass (Windows-only
cases skip on Linux). `npm run build`, `npm run cycles`, `knip`, typecheck
(host, unit) pass.
