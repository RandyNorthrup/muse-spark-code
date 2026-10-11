# FIX0160RVB — Honest relocation setting for 0.16.0

Branch `fix/0160-rvb`; base release/0.16.0 `54f5f9d06`; 2026-10-07.
Tests ran on the Kubuntu rig through `rig-test.sh` (slot `rvb`). No
dependency install, live/paid call, credential, merge, rebase or push.

## Finding

`src/core/resources/resourceGovernorEntry.ts` passed
`hasRelocationTarget: () => false` to the governor, so `paired` and `ask`
could never enter the relocate level: sustained pressure went from throttle
straight to pause. Nothing in production constructs `ResourceRelocator`, and
the CHANGELOG/README highlight said eligible work "can relocate through an
existing approved device or runner route". The setting did nothing.

## Path taken: honest setting, no faked route

There is no production route source on this branch:

- **Paired devices (M100):** no device pool, receiver, offer, pairing or
  dispatch code. `ResourceLinkedDevice` and `deviceResourceSchema` are
  contract types only. The usage companion is a read-only page, not a
  work receiver.
- **Runner routes (M96c):** `routeChecks` sends team checks to configured SSH
  runners by runner health, regardless of the resource level. It provides no
  `ResourceRelocationTarget`: no level/headroom report (`resource()`), no
  repository/kind offer (`hasOffer`), no attempt-bound `dispatch` with
  refused/uncertain receipts. C2's exclusive claim/settle and local
  retirement proof are absent (PLAN §9). `resourceRunnerPreference` has no
  production caller.
- **Relocator (R):** `ResourceRelocator` is referenced only by
  `test/unit/relocate.test.ts`. Even if `canRelocate()` returned true, no
  work would move. Entering relocate would only raise capacity from 0 to 1
  under pressure, a regression.

So the route is declared absent rather than invented:

- The governor option is now `hasRelocationTarget: (() => boolean) | null`.
  `null` means this host has no route. Both shipped factories pass it: the
  window factory and the runtime factory, `createRuntimeResourceHost`, which
  backs `createResources` and is re-exported by the same entry.
- `ResourceStatus` gains an optional `relocation` field: `off`, `available`,
  `noTarget` (a bound route with no target that has room) or `noRoute`.
  `canRelocate()` is true only for `available`, meaning the setting allows
  relocation and a bound route reports a target.
- `UI_TEXT.resourceRelocationNoRoute` (English plus all 14 tables) appears
  for `noRoute` in `resources status` text, CLI/ACP `/resources`, the
  pause notice and the popover. JSON status carries the field.
- The setting description and `paired` value (NLS and the en/14 UI copies),
  README highlight, setting table and levels text, Marketplace README and
  CHANGELOG highlight now say relocation needs a paired device or runner
  route and is not available yet. A Fixed entry records the change. The
  reference was regenerated with `node scripts/gen-reference.mjs`.

Still needed for real relocation: M100 paired-device offer/dispatch and
receiver admission, C2 claim/settle/retirement, an adapter from those
cached approved offers to `hasRelocationTarget`/`ResourceRelocationTarget`,
and a per-conversation `ResourceRelocator` bound to rows, notices, Traffic
and the journal (PLAN §9 `M107-R-integration-binding`).

## Tests

- `test/unit/resourceRelocationRoute.test.ts` (new): runs both production
  factories for `paired`, `ask` and `off`. Only the OS sampler is scripted;
  a recording subclass captures the factory's real governor. Under sustained
  memory pressure the levels are normal, throttle at 5 s, and pause at 65 s,
  never relocate. Status (and runtime JSON) reports `noRoute` for paired/ask
  and `off` for off. Status text includes the reason only for paired/ask.
- `governor.test.ts`: for each setting, a bound route reports `available`,
  then `noTarget`, and `off` never calls the target. A `null` route reports
  `noRoute`, escalates throttle to pause with exactly two level events, and
  never calls a target.
- `resourceStatus.test.ts`: the pause notice ends with the reason only for
  `noRoute` (not off/noTarget/available/absent).
- `ResourceSurface.test.tsx`: a real governor with no route shows the reason
  in the popover; other states and an absent field hide it.

## Red drills (Kubuntu, complete owning file, default timeout)

| Mutation                                                       | Result                                                                                                |
| -------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| Restore the pre-fix `() => false` in both production factories | Exit 1: 4 failed (window/runtime × paired/ask), 2 passed (off); `expected 'noTarget' to be 'noRoute'` |
| Window factory claims a route (`() => true`)                   | Exit 1: 2 failed (window paired/ask), 4 passed; `expected 'available' to be 'noRoute'`                |

Each drill copied the source first and restored it in the same command.
SHA-256 matched byte for byte afterwards: `resourceGovernorEntry.ts`
`af6f03efdd6392de4541b08601526edbf2418adf71aee6c6d83331c4d3758cd5`,
`runtime/resources/host.ts`
`4561af65bda19cdf7f9090b501bcabf0bc3764b2bbcae3489e45c117b3e47bed`.

## Verification

- Kubuntu vitest, restored tree: 10 resource files, 244/244 tests (new
  file 6, governor 56, relocate 106, runtime 20, exec 6, ACP 8, contracts 16,
  status 11, portable 1, surface 14). Also 24 more resource, team, reference,
  README/CHANGELOG, What's New, l10n and UI-text region files: 465/465.
- Kubuntu `npm run typecheck` (all five projects) exit 0; `knip` exit 0
  (only the existing vendor/axe-core configuration hints).
- Kubuntu `npm run build` exit 0, all existing caps: `resourceGovernor.js`
  93.2/125 KiB, `resourceSurface.js` 4.0/25 KiB, resource controls
  38.6/50 KiB, deferred webview JS 32.1/50 KiB. The new string goes only to
  the resource English chunk. Surface English (24.9/25 KiB) does not carry it.
- Re-run of the 5 changed test files after the lint fixes: 107/107.
  README/packaging consistency (`vsixPackaging`, `checkBadges`,
  `acpNpmReadme`, `whatsNewBundle`, `teamChangelog`): 135/135.
- Local `node scripts/check-l10n.mjs`: 14 UI tables, 14 usage tables, 211
  manifest strings, 0 problems. `node scripts/gen-reference.mjs` regenerated
  `docs/reference.md` and `src/shared/reference/reference.generated.*`;
  `--check` reports current.
- Local changed-file ESLint (zero warnings) and Prettier pass. Full
  `npm run quality` and hosted CI belong to the release lead.
