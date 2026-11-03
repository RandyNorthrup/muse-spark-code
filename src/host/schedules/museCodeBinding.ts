// Muse Code timed sends' account binding (M88 lane C, D67 item 15): a
// timed send must never fire under another account than the one that
// scheduled it, and never bill META_API_KEY unseen. The binding reads
// the credential file's STRUCTURE only (D67's fallback: size/mtime
// would false-positive on token refreshes), through
// `credentialFileVerdict`, never a value in it.
//
// - While META_API_KEY is present in the window's environment, Muse
//   Code offers no timed send: creation (the panel channel) and
//   admission (every dispatch) refuse in words.
// - The sign-outs and sign-ins the host SEES clear the workspace's
//   Muse Code once-schedules: a transition between the signed-in and
//   signed-out shapes retires every once schedule created before the
//   consuming check, and the transcript says why. Anything the
//   structure cannot settle (`unknown`) neither triggers nor consumes:
//   only a seen sign-out or sign-in clears.
// - No per-job account field is stored and the v2 schema is unchanged:
//   staleness is `createdAtMs` against the last consumed transition.
//
// Activation-safe on purpose: no runtime schedule-schema import, so
// the window's bridge and delivery ports can use it without pulling
// the v2 schemas into the activation bundle. List views arrive
// already parsed by the engine side.
import * as z from 'zod/mini'
import type { CredentialFileVerdict } from '../../core/backends/musecode/credentialFile'
import { scheduleDispatchRefusal } from '../../core/schedules/dispatchRefusal'
import { UI_TEXT } from '../../shared/constants'
import { plural } from '../../shared/l10n/text'
import type { ScheduleTarget, ScheduleV2 } from '../../shared/scheduleV2'

/** The host's read of the CLI's sign-in for one binding check. */
export type MuseCodeScheduleSignIn = 'signedIn' | 'signedOut' | 'unknown'

/**
What one workspace last saw, persisted across restarts so a sign-out
or sign-in while the window was closed still clears. `transitionMs`
is the consuming check's moment, the line staleness is read against.
*/
export interface MuseCodeSeen {
  readonly signIn: Exclude<MuseCodeScheduleSignIn, 'unknown'>
  readonly transitionMs?: number | undefined
}

const museCodeSeenSchema = z.strictObject({
  signIn: z.enum(['signedIn', 'signedOut']),
  transitionMs: z.optional(z.number().check(z.gte(0))),
})

export function parseMuseCodeSeen(value: unknown): MuseCodeSeen | undefined {
  const parsed = museCodeSeenSchema.safeParse(value)
  return parsed.success ? parsed.data : undefined
}

/**
The verdict as a sign-in read. `inline`/`keychain` hold the sign-in;
`empty` is what a sign-out leaves and a missing file never signed in.
Anything the structure cannot settle stays `unknown`: only the CLI
could say, so the host sees neither a sign-out nor a sign-in.
*/
export function museCodeSignInOf(
  verdict: CredentialFileVerdict | 'absent',
): MuseCodeScheduleSignIn {
  if (verdict === 'inline' || verdict === 'keychain') return 'signedIn'
  return verdict === 'empty' || verdict === 'absent' ? 'signedOut' : 'unknown'
}

/** Timed sends only: a once trigger on a Muse Code conversation target. */
export function isMuseCodeOnceTarget(
  target: ScheduleTarget,
  trigger: ScheduleV2['trigger'],
): boolean {
  return (
    trigger.kind === 'once' &&
    (target.kind === 'conversation' || target.kind === 'newConversation') &&
    target.backend === 'museCode'
  )
}

/** The listed rows a transition retires: Muse Code onces from before it. */
export function staleMuseCodeOnceIds(
  schedules: readonly Pick<ScheduleV2, 'id' | 'target' | 'trigger' | 'createdAtMs'>[],
  transitionMs: number,
): readonly string[] {
  return schedules
    .filter(
      (schedule) =>
        schedule.createdAtMs < transitionMs &&
        isMuseCodeOnceTarget(schedule.target, schedule.trigger),
    )
    .map((schedule) => schedule.id)
}

/**
A check's read of the binding. `unknown` never answers (only the CLI
could say); the first sight records silently, since the host has seen
no transition yet; a changed read records the transition's moment.
*/
export function bindingTransition(
  current: MuseCodeScheduleSignIn,
  seen: MuseCodeSeen | undefined,
  nowMs: number,
): { readonly seen: MuseCodeSeen; readonly transitioned: boolean } | undefined {
  if (current === 'unknown') return undefined
  if (seen === undefined) return { seen: { signIn: current }, transitioned: false }
  return seen.signIn === current
    ? undefined
    : { seen: { signIn: current, transitionMs: nowMs }, transitioned: true }
}

export interface MuseCodeBindingCheckDeps {
  readonly workspaceKey: string
  readonly currentSignIn: () => MuseCodeScheduleSignIn
  readonly seen: {
    readonly load: (workspaceKey: string) => Promise<unknown>
    readonly save: (workspaceKey: string, seen: MuseCodeSeen) => Promise<void>
  }
  /** Already-parsed list rows; the engine side parses the control answer. */
  readonly list: (
    workspaceKey: string,
  ) => Promise<readonly Pick<ScheduleV2, 'id' | 'target' | 'trigger' | 'createdAtMs'>[]>
  /** True only when the engine accepted the removal. */
  readonly remove: (workspaceKey: string, id: string) => Promise<boolean>
  readonly notice: (text: string) => void
  readonly nowMs: number
}

/**
One workspace's binding check: consume a seen transition, then retire
every Muse Code once-schedule from before the last transition and say
why. A workspace whose transition an admission consumed (below) still
sweeps: the sweep reads `transitionMs`, not the fresh transition.
Concurrent checks for one workspace share a single run.
*/
const bindingChecks = new Map<string, Promise<number>>()

export function checkMuseCodeBinding(deps: MuseCodeBindingCheckDeps): Promise<number> {
  const pending = bindingChecks.get(deps.workspaceKey)
  if (pending !== undefined) return pending
  const run = (async () => {
    try {
      const stored = parseMuseCodeSeen(await deps.seen.load(deps.workspaceKey))
      const transition = bindingTransition(deps.currentSignIn(), stored, deps.nowMs)
      if (transition !== undefined) await deps.seen.save(deps.workspaceKey, transition.seen)
      const transitionMs = transition?.seen.transitionMs ?? stored?.transitionMs
      if (transitionMs === undefined) return 0
      const stale = staleMuseCodeOnceIds(await deps.list(deps.workspaceKey), transitionMs)
      let removed = 0
      for (const id of stale) {
        if (await deps.remove(deps.workspaceKey, id)) removed += 1
      }
      // Only an actual removal speaks: a concurrent check's rows are gone
      // already, and silence then is not a refusal but no news.
      if (removed > 0) deps.notice(plural(UI_TEXT.museCodeOnceCleared, removed))
      return removed
    } finally {
      // No replacement can intervene while this run is registered: a
      // second caller shares it, a later one starts after this delete.
      bindingChecks.delete(deps.workspaceKey)
    }
  })()
  bindingChecks.set(deps.workspaceKey, run)
  return run
}

export interface MuseCodeOnceAdmitDeps extends Pick<
  MuseCodeBindingCheckDeps,
  'currentSignIn' | 'seen'
> {
  readonly hasEnvironmentKey: () => boolean
  readonly nowMs: number
}

/**
One fire's admission (M88 lane C): while the window's environment
carries META_API_KEY every Muse Code once-schedule refuses, and a
schedule from before the last consumed transition refuses as stale.
An admission that SEES the transition consumes it, so later checks
and fires read the same line; anything else dispatches untouched.
Throws the branded refusal the dispatch settles as refused.
*/
export async function admitMuseCodeOnce(
  schedule: Pick<ScheduleV2, 'target' | 'trigger' | 'createdAtMs' | 'workspaceKey'>,
  deps: MuseCodeOnceAdmitDeps,
): Promise<void> {
  if (!isMuseCodeOnceTarget(schedule.target, schedule.trigger)) return
  if (deps.hasEnvironmentKey()) {
    throw scheduleDispatchRefusal(UI_TEXT.museCodeOnceEnvKeyRefused)
  }
  const stored = parseMuseCodeSeen(await deps.seen.load(schedule.workspaceKey))
  const transition = bindingTransition(deps.currentSignIn(), stored, deps.nowMs)
  if (transition !== undefined) await deps.seen.save(schedule.workspaceKey, transition.seen)
  const transitionMs = transition?.seen.transitionMs ?? stored?.transitionMs
  if (transitionMs !== undefined && schedule.createdAtMs < transitionMs) {
    throw scheduleDispatchRefusal(UI_TEXT.museCodeOnceAccountChanged)
  }
}

/** The engine tail's window binding; absent hosts stay unbound. */
export interface MuseCodeBindingPorts extends Pick<
  MuseCodeBindingCheckDeps,
  'currentSignIn' | 'seen'
> {
  readonly hasEnvironmentKey: () => boolean
  readonly notice: (text: string) => void
}
