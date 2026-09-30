import path from 'node:path'
import * as z from 'zod/mini'
import { UI_TEXT } from '../../shared/constants'
import type { GitProcess } from '../git'
import { lstatOrUndefined } from './checkpointFiles'
import { listRecords } from './recordRefs'
import { readOptionalText, ShadowGit } from './shadowGit'

// Local records.json projection from the retired 2fa6c1ae implementation;
// only IDs are read, never migrated or interpreted as safe restore objects.
const legacySchema = z.object({
  version: z.number(),
  checkpoints: z.array(z.object({ sessionId: z.string(), turnId: z.string() })),
})

export interface LegacyCheckpointDeps {
  readonly storageDir: string
  readonly workspaceRoot: string
  readonly platform: NodeJS.Platform
  readonly git: GitProcess
  readonly env: NodeJS.ProcessEnv
  readonly signal: AbortSignal
}

/** Read old per-workspace refs in place; no prepare, presence, cleanup or migration. */
export async function legacyCheckpointTurns(
  deps: LegacyCheckpointDeps,
  sessionId: string,
): Promise<readonly string[]> {
  const file = await readOptionalText(path.join(deps.storageDir, 'records.json'))
  let fileIds: readonly string[] = []
  if (file !== undefined) {
    const raw: unknown = JSON.parse(file)
    const parsed = legacySchema.safeParse(raw)
    if (!parsed.success) {
      throw new Error(UI_TEXT.checkpointFailed)
    }
    fileIds = parsed.data.checkpoints
      .filter((record) => record.sessionId === sessionId)
      .map((record) => record.turnId)
  }
  if ((await lstatOrUndefined(path.join(deps.storageDir, 'shadow.git', 'HEAD'))) === undefined) {
    return fileIds
  }
  const shadow = new ShadowGit(
    {
      storageDir: deps.storageDir,
      top: deps.workspaceRoot,
      platform: deps.platform,
      instance: 'legacy-reader',
    },
    { git: deps.git, env: deps.env, signal: deps.signal },
  )
  const listed = await listRecords(shadow)
  if (listed.some(({ record }) => record === undefined)) {
    throw new Error(UI_TEXT.checkpointFailed)
  }
  return [
    ...new Set([
      ...fileIds,
      ...listed.flatMap(({ record }) =>
        record?.kind === 'checkpoint' && record.sessionId === sessionId ? [record.turnId] : [],
      ),
    ]),
  ]
}
