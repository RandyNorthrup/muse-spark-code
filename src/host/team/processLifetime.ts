import { randomUUID } from 'node:crypto'
import * as z from 'zod/mini'
import type { ChildProcessWithoutNullStreams } from 'node:child_process'
import type { TeamJournal } from './teamJournal'

const confirmationSchema = z.strictObject({
  pid: z.number().check(z.int(), z.positive()),
  group: z.string().check(z.minLength(1)),
  /** OS identity, not a timestamp inferred from when spawn returned. */
  startTime: z.string().check(z.minLength(1)),
  container: z.enum(['windowsJob', 'linuxScope', 'processGroup']),
})
const endSchema = z.strictObject({
  childExited: z.boolean(),
  descendants: z.enum(['proved', 'uncertain']),
})
const launchSchema = z.strictObject({
  id: z.uuid(),
  command: z.string().check(z.minLength(1)),
  cwd: z.string().check(z.minLength(1)),
  taskId: z.string().check(z.minLength(1)),
  confirmation: z.optional(confirmationSchema),
  end: z.optional(endSchema),
})

export type TeamLaunchRecord = z.infer<typeof launchSchema>
export type LaunchConfirmation = z.infer<typeof confirmationSchema>
export type Retirement = z.infer<typeof endSchema>

export interface TeamLaunchRequest {
  readonly command: string
  readonly args: readonly string[]
  readonly cwd: string
  readonly taskId: string
  /** The worker/bridge supplies its credential-free environment. */
  readonly env: NodeJS.ProcessEnv
  readonly priority: 'belowNormal' | 'normal'
}

export interface ContainedTeamChild {
  readonly child: ChildProcessWithoutNullStreams
  readonly confirmation: Promise<LaunchConfirmation>
  /** Resolves separately from the direct child's exit. */
  readonly ended: Promise<Retirement>
  retire(): Promise<Retirement>
}

/** Explicit OS seam. No uncontained spawn or taskkill fallback is accepted here. */
export interface TeamProcessDriver {
  launch(request: TeamLaunchRequest, launchId: string): ContainedTeamChild
}

export interface TeamProcessLifetime {
  launch(request: TeamLaunchRequest): Promise<ContainedTeamChild & { readonly launchId: string }>
  dispose(): Promise<readonly Retirement[]>
  recoveryRecords(journal: TeamJournal): Promise<readonly TeamLaunchRecord[]>
}

/** Constructed only by the lazy team host; construction itself launches nothing. */
export function createTeamProcessLifetime(options: {
  readonly journal: TeamJournal
  readonly driver: TeamProcessDriver
  readonly isHostBusy: () => boolean
}): TeamProcessLifetime {
  const active = new Set<Promise<ContainedTeamChild>>()
  const failedChildren = new Set<ContainedTeamChild>()
  const state = { isDisposed: false }
  const save = (record: TeamLaunchRecord) =>
    options.journal.write(`launch-${record.id}`, record, launchSchema)
  return {
    async launch(request) {
      if (state.isDisposed) throw new Error('TEAM_PROCESS_LIFETIME_DISPOSED')
      if (options.isHostBusy()) throw new Error('TEAM_HOST_BUSY')
      const record = launchSchema.parse({
        id: randomUUID(),
        command: request.command,
        cwd: request.cwd,
        taskId: request.taskId,
      })
      // Register pending work synchronously, so dispose cannot miss a launch awaiting its intent.
      const pending = (async () => {
        await save(record)
        if (state.isDisposed) throw new Error('TEAM_PROCESS_LIFETIME_DISPOSED')
        if (options.isHostBusy()) throw new Error('TEAM_HOST_BUSY')
        const launched = options.driver.launch(
          {
            ...request,
            env: { ...request.env, MUSE_SPARK_LAUNCH_ID: record.id },
          },
          record.id,
        )
        try {
          const confirmation = confirmationSchema.parse(await launched.confirmation)
          await save({ ...record, confirmation })
          const ended = (async () => {
            const raw = await launched.ended
            const end = endSchema.parse(raw)
            if (
              end.descendants === 'proved' &&
              (!end.childExited || confirmation.container === 'processGroup')
            )
              throw new Error('TEAM_RETIREMENT_PROOF_INVALID')
            await save({ ...record, confirmation, end })
            return end
          })()
          // Prevent an unhandled rejection if the caller is still working with the pipes.
          void ended.catch(() => {
            // The returned ended promise retains this rejection for its caller.
          })
          return { ...launched, ended }
        } catch (error: unknown) {
          // Confirmation/journal failure must not hide a child whose retirement is uncertain.
          failedChildren.add(launched)
          await launched.retire()
          throw error
        }
      })()
      active.add(pending)
      try {
        const launched = await pending
        void (async () => {
          const end = await launched.ended
          if (end.descendants === 'proved') active.delete(pending)
        })().catch(() => {
          // A failed end remains open in the journal and counted in active.
        })
        return { ...launched, launchId: record.id }
      } catch (error: unknown) {
        active.delete(pending)
        throw error
      }
    },
    async dispose() {
      state.isDisposed = true
      const outcomes = await Promise.allSettled([
        ...[...active].map(async (pending) => {
          const launched = await pending
          await launched.retire()
          return await launched.ended
        }),
        ...[...failedChildren].map(async (launched) => {
          await launched.retire()
          // No validated confirmation: do not turn an adapter's assertion into proof.
          return { childExited: false, descendants: 'uncertain' as const }
        }),
      ])
      return outcomes.map((outcome) =>
        outcome.status === 'fulfilled'
          ? outcome.value
          : { childExited: false, descendants: 'uncertain' },
      )
    },
    async recoveryRecords(journal) {
      const records: TeamLaunchRecord[] = []
      const names = await journal.names()
      for (const name of names) {
        if (!name.startsWith('launch-')) continue
        const result = await journal.read(name, launchSchema)
        if (result.kind === 'record' && result.value.end?.descendants !== 'proved') {
          records.push(result.value)
        }
      }
      return records
    },
  }
}
