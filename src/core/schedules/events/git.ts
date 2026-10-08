import * as z from 'zod/mini'
import { createHash } from 'node:crypto'
import { execResourceFile } from '../../resources/admission'
import { stat } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import path from 'node:path'
import {
  GIT_OUTPUT_MAX_BYTES,
  GIT_TIMEOUT_MS,
  SCHEDULE_EVENT_FIELD_MAX_CHARS,
} from '../../../shared/constants'
import {
  scheduleEventSchema,
  type ScheduleEvent,
  type SchedulePollingEventSource,
  type ScheduleSourceCapability,
} from '../../../shared/scheduleEvents'
import { withoutCredentials } from '../../credentialEnvironment'
import { noEventHistory, unavailableSource, type ScheduleSnapshotPort } from './ports'
import { retainedPollEvents } from './conditions'

const refSchema = z.strictObject({
  repository: z.string().check(z.minLength(1), z.maxLength(SCHEDULE_EVENT_FIELD_MAX_CHARS)),
  name: z.string().check(
    z.maxLength(SCHEDULE_EVENT_FIELD_MAX_CHARS),
    z.regex(/^refs\/(?:heads|tags)\//),
    z.refine((name) => !name.includes('..') && !/[\\\p{Cc}]/u.test(name)),
  ),
  objectId: z
    .string()
    .check(z.minLength(1), z.maxLength(SCHEDULE_EVENT_FIELD_MAX_CHARS), z.regex(/^[\da-f]+$/)),
  revision: z.string().check(z.minLength(1), z.maxLength(SCHEDULE_EVENT_FIELD_MAX_CHARS)),
})
type Ref = z.infer<typeof refSchema>
const exec = execResourceFile

/** No checkout, hooks, helper, credential or network is needed to read refs. */
export function localGitRefs(
  workspaceRoot: string,
  isTrusted: () => boolean,
): ScheduleSnapshotPort {
  const capability = (): ScheduleSourceCapability => {
    if (!isTrusted()) return unavailableSource('workspaceTrust')
    return existsSync(path.join(workspaceRoot, '.git'))
      ? { available: true }
      : unavailableSource('gitRepository')
  }
  return {
    capability,
    read: async () => {
      const available = capability()
      if (!available.available) throw new Error(available.reason)
      const options = {
        env: withoutCredentials(process.env),
        timeout: GIT_TIMEOUT_MS,
        maxBuffer: GIT_OUTPUT_MAX_BYTES,
        windowsHide: true,
      }
      try {
        const common = await exec(
          'git',
          [
            '--no-optional-locks',
            '-C',
            workspaceRoot,
            'rev-parse',
            '--path-format=absolute',
            '--git-common-dir',
          ],
          options,
        )
        const refArgs = [
          '--no-optional-locks',
          '-C',
          workspaceRoot,
          'for-each-ref',
          '--format=%(refname)%00%(objectname)',
          'refs/heads',
          'refs/tags',
        ]
        const result = await exec('git', refArgs, options)
        const refs: Ref[] = []
        const revisions: { readonly file: string; readonly revision: bigint }[] = []
        for (const line of result.stdout.split('\n')) {
          if (!line) continue
          const parts = line.trimEnd().split('\0')
          if (parts.length !== 2) throw new Error('gitRefShape')
          const [name, objectId] = parts
          const ref = refSchema.parse({
            repository: common.stdout.trim(),
            name,
            objectId,
            revision: 'pending',
          })
          // Metadata detects an unstable read; it never identifies an event.
          let metadata
          let file = path.join(common.stdout.trim(), ref.name)
          try {
            metadata = await stat(file, { bigint: true })
          } catch {
            file = path.join(common.stdout.trim(), 'packed-refs')
            metadata = await stat(file, { bigint: true })
          }
          refs.push({ ...ref, revision: String(metadata.mtimeNs) })
          revisions.push({ file, revision: metadata.mtimeNs })
        }
        // A concurrent ref write/pack must not combine an old object with a
        // new revision. Refuse the unstable read; the next poll retries it.
        const verified = await exec('git', refArgs, options)
        if (verified.stdout !== result.stdout) throw new Error('gitRefsChanged')
        for (const revision of revisions) {
          const metadata = await stat(revision.file, { bigint: true })
          if (metadata.mtimeNs !== revision.revision) throw new Error('gitRefsChanged')
        }
        const current = capability()
        if (!current.available) throw new Error(current.reason)
        return refs
      } catch {
        throw new Error(unavailableSource('gitRefs').reason)
      }
    },
  }
}

export class ScheduleGitSource implements SchedulePollingEventSource {
  private previous: Map<string, Ref> | undefined
  private cached: readonly ScheduleEvent[] = []
  readonly id = 'git'
  readonly kinds = ['branchUpdated', 'tagCreated'] as const
  constructor(
    private readonly port: ScheduleSnapshotPort,
    private readonly now: () => number,
  ) {}
  capability() {
    return this.port.capability()
  }
  history() {
    return noEventHistory()
  }
  async poll(since: number): Promise<readonly ScheduleEvent[]> {
    const capability = this.capability()
    if (!capability.available) throw new Error(capability.reason)
    const refs = z.array(refSchema).parse(await this.port.read())
    const current = this.capability()
    if (!current.available) throw new Error(current.reason)
    const next = new Map(refs.map((ref) => [ref.name, ref]))
    const events: ScheduleEvent[] = []
    for (const ref of next.values()) {
      const old = this.previous?.get(ref.name)
      const isBranch = ref.name.startsWith('refs/heads/')
      if (!this.previous || (isBranch ? old?.objectId === ref.objectId : old !== undefined))
        continue
      events.push(
        scheduleEventSchema.parse({
          source: this.id,
          kind: isBranch ? 'branchUpdated' : 'tagCreated',
          eventKey: createHash('sha256')
            .update(JSON.stringify([ref.repository, ref.name, ref.objectId, old?.objectId ?? '']))
            .digest('hex'),
          observedAt: this.now(),
          fields: { branch: ref.name.replace(/^refs\/(?:heads|tags)\//, ''), commit: ref.objectId },
        }),
      )
    }
    this.previous = next
    this.cached = retainedPollEvents(this.cached, events, since)
    return this.cached.map((event) => structuredClone(event))
  }
}
