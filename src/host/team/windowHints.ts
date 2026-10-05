import { chmod, mkdir, readFile, readdir, rm } from 'node:fs/promises'
import path from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import * as z from 'zod/mini'
import { canonicalPath } from '../canonicalPath'
import { writeFileAtomically } from '../fsAtomic'
import { storeErrorCode } from '../backend/storeErrors'

const OWNER_DIRECTORY_MODE = 0o700
const countSchema = z.number().check(z.int(), z.nonnegative())
const hintSchema = z.strictObject({
  instanceId: z.uuid(),
  workspaceName: z.string(),
  at: countSchema,
  trees: z.array(
    z.strictObject({
      commonDirectory: z.string(),
      branch: z.string(),
      worktree: z.string(),
      paths: z.array(z.string()),
    }),
  ),
  exclusiveServers: z.array(z.string()),
  workers: countSchema,
  processWorkers: countSchema,
  heavyCommands: countSchema,
})

export type WindowHint = z.infer<typeof hintSchema>
export type HintCollision =
  | {
      readonly kind: 'paths'
      readonly instanceId: string
      readonly repository: string
      readonly branch: string
      readonly paths: readonly string[]
    }
  | { readonly kind: 'server'; readonly instanceId: string; readonly server: string }

export interface HintIntent {
  readonly repository: string
  readonly paths: readonly string[]
  readonly exclusiveServers: readonly string[]
}

async function assertHintPath(target: string) {
  if ((await canonicalPath(target)) !== target) throw new Error('TEAM_HINT_PATH_CHANGED')
}

/** Advisory only. The caller still performs trust, caps, leases and paid admission. */
export function createWindowHints(options: {
  readonly directory: string
  readonly instanceId: string
  readonly platform: NodeJS.Platform
  readonly freshMs: number
  readonly writeMs: number
  readonly maxHintBytes: number
  readonly now: () => number
  /** Windows mode bits do not set ACLs: the native host must secure and verify this folder. */
  readonly secureWindowsDirectory?: (directory: string) => Promise<void>
  readonly disabled: () => void
  readonly question: (collision: HintCollision) => Promise<'continue' | 'wait' | 'openWindow'>
  /** Lane I expands globs and excludes json-table/changelog files before calling. */
  readonly overlap: (mine: readonly string[], theirs: readonly string[]) => readonly string[]
}) {
  const instanceId = z.uuid().parse(options.instanceId)
  const directory = path.resolve(options.directory)
  const file = path.join(directory, `${instanceId}.json`)
  const lifecycle = { isDisabled: false, isClosed: false, isStarting: false }
  // Read again after awaits: dispose/disable may run while filesystem work is pending.
  const isUnavailable = () => lifecycle.isDisabled || lifecycle.isClosed
  let timer: ReturnType<typeof setInterval> | undefined
  let pending = Promise.resolve()
  const answers = new Map<
    string,
    {
      readonly collision: HintCollision
      readonly answer: Promise<'continue' | 'wait' | 'openWindow'>
    }
  >()
  const disable = () => {
    if (lifecycle.isDisabled) return
    lifecycle.isDisabled = true
    if (timer !== undefined) clearInterval(timer)
    timer = undefined
    options.disabled()
  }
  const prepare = async () => {
    await assertHintPath(directory)
    await mkdir(directory, { recursive: true, mode: OWNER_DIRECTORY_MODE })
    await assertHintPath(directory)
    if (options.platform === 'win32') {
      if (options.secureWindowsDirectory === undefined) throw new Error('TEAM_HINT_ACL_UNAVAILABLE')
      await options.secureWindowsDirectory(directory)
    } else {
      await chmod(directory, OWNER_DIRECTORY_MODE)
    }
  }
  const readFresh = async (): Promise<readonly WindowHint[]> => {
    if (lifecycle.isDisabled || lifecycle.isClosed) return []
    try {
      await prepare()
      const names = await readdir(directory)
      const hints: WindowHint[] = []
      for (const name of names) {
        if (!name.endsWith('.json')) continue
        const target = path.join(directory, name)
        try {
          await assertHintPath(target)
          const text = await readFile(target, 'utf8')
          if (Buffer.byteLength(text) > options.maxHintBytes) continue
          const parsed = hintSchema.safeParse(JSON.parse(text))
          if (!parsed.success || name !== `${parsed.data.instanceId}.json`) continue
          const age = options.now() - parsed.data.at
          if (age >= 0 && age < options.freshMs) hints.push(parsed.data)
        } catch (error: unknown) {
          // A torn, malformed, linked or concurrently removed hint carries no authority.
          if (storeErrorCode(error) === 'EACCES') throw error
        }
      }
      return hints
    } catch {
      disable()
      return []
    }
  }
  const publish = (state: Omit<WindowHint, 'instanceId' | 'at'>): Promise<void> => {
    const previous = pending
    pending = (async () => {
      await previous
      if (lifecycle.isDisabled || lifecycle.isClosed) return
      try {
        await prepare()
        const hint = hintSchema.parse({ ...state, instanceId, at: options.now() })
        const text = JSON.stringify(hint)
        if (Buffer.byteLength(text) > options.maxHintBytes) throw new Error('TEAM_HINT_TOO_LARGE')
        await assertHintPath(file)
        if (isUnavailable()) return
        await writeFileAtomically(file, text, { sleep: delay, expectedCanonicalPath: file })
      } catch {
        disable()
      }
    })()
    return pending
  }
  const collisionsFor = (intent: HintIntent, hints: readonly WindowHint[]) => {
    const collisions: HintCollision[] = []
    for (const hint of hints) {
      if (hint.instanceId === instanceId) continue
      for (const tree of hint.trees) {
        if (tree.commonDirectory !== intent.repository) continue
        const paths = [...new Set(options.overlap(intent.paths, tree.paths))].toSorted(
          (left, right) => left.localeCompare(right),
        )
        if (paths.length > 0)
          collisions.push({
            kind: 'paths',
            instanceId: hint.instanceId,
            repository: intent.repository,
            branch: tree.branch,
            paths,
          })
      }
      for (const server of intent.exclusiveServers) {
        if (hint.exclusiveServers.includes(server)) {
          collisions.push({ kind: 'server', instanceId: hint.instanceId, server })
        }
      }
    }
    return collisions
  }
  const collisionKey = (collision: HintCollision) =>
    JSON.stringify(
      collision.kind === 'server'
        ? [collision.kind, collision.instanceId, collision.server]
        : [collision.kind, collision.instanceId, collision.repository, collision.paths],
    )
  const isPresent = (collision: HintCollision, hints: readonly WindowHint[]) =>
    hints.some(
      (hint) =>
        hint.instanceId === collision.instanceId &&
        (collision.kind === 'server'
          ? hint.exclusiveServers.includes(collision.server)
          : hint.trees.some(
              (tree) =>
                tree.commonDirectory === collision.repository &&
                collision.paths.every((leased) => options.overlap([leased], tree.paths).length > 0),
            )),
    )
  return {
    readFresh,
    publish,
    async check(intent: HintIntent): Promise<'continue' | 'wait' | 'openWindow'> {
      const hints = await readFresh()
      const collisions = collisionsFor(intent, hints)
      // Answers survive rewrites, but lapse when the other window drops their paths/server.
      for (const [key, saved] of answers) {
        if (!isPresent(saved.collision, hints)) answers.delete(key)
      }
      let result: 'continue' | 'wait' | 'openWindow' = 'continue'
      for (const collision of collisions) {
        const key = collisionKey(collision)
        let saved = answers.get(key)
        if (saved === undefined) {
          saved = { collision, answer: options.question(collision) }
          answers.set(key, saved)
        }
        const choice = await saved.answer
        if (choice !== 'continue') result = choice
      }
      return result
    },
    async advisory() {
      const hints = await readFresh()
      const sum = { windows: 0, workers: 0, processWorkers: 0, heavyCommands: 0 }
      for (const hint of hints) {
        sum.windows += 1
        sum.workers += hint.workers
        sum.processWorkers += hint.processWorkers
        sum.heavyCommands += hint.heavyCommands
      }
      return sum
    },
    async start(state: () => Omit<WindowHint, 'instanceId' | 'at'>) {
      if (timer !== undefined || lifecycle.isStarting || lifecycle.isDisabled || lifecycle.isClosed)
        return
      lifecycle.isStarting = true
      try {
        await publish(state())
        if (isUnavailable()) return
        timer = setInterval(() => {
          try {
            void publish(state())
          } catch {
            disable()
          }
        }, options.writeMs)
        timer.unref()
      } finally {
        lifecycle.isStarting = false
      }
    },
    async dispose() {
      lifecycle.isClosed = true
      if (timer !== undefined) clearInterval(timer)
      timer = undefined
      answers.clear()
      await pending
      try {
        await assertHintPath(file)
        await rm(file, { force: true })
      } catch {
        disable()
      }
    },
  }
}
