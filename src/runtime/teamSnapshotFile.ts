// The stored team snapshot the runtime surfaces share (M96b, RLF-ACPTEAM):
// `<data>/acp/<workspaceKey>/team.json` in the agent data folder, lowered by
// the repository's own team.json as headless runs lower it. Headless `exec`
// and the ACP agent read the same file through this one reader, so a team
// the person stored once is the team both surfaces offer.
import path from 'node:path'
import * as z from 'zod/mini'
import { isErrno } from '../core/fs/errno'
import { lowerTeamWithJson, parseTeamJson, teamJsonPath } from '../core/team/teamConfig'
import {
  ACP_SESSIONS_SUBFOLDER,
  EXEC_PROMPT_MAX_BYTES,
  EXEC_TEAM_STATE_FILE,
  UI_TEXT,
} from '../shared/constants'
import { fill } from '../shared/l10n/text'
import { teamSnapshotSchema, type TeamSnapshot } from '../shared/team'
import { Usd, type UsdAmount } from '../shared/usd'
import { workspaceKey } from './dataFolder'

/** What the stored-snapshot reader reads files through (the caller's own bounds). */
export interface StoredTeamSnapshotDeps {
  readonly dataFolder: string
  readonly cwd: string
  readonly platform: NodeJS.Platform
  readonly signal: AbortSignal
  readonly readFile: (file: string, maxBytes: number, signal: AbortSignal) => Promise<Uint8Array>
  /** The caller's own spend ceiling the repository file may only lower. */
  readonly budgetUsd?: UsdAmount | undefined
  /** The repository file lowered that ceiling to this amount. */
  readonly onLoweredBudget?: ((capUsd: UsdAmount) => void) | undefined
  /** The repository file requires a review for these roles before a merge. */
  readonly onRequireReviews?: ((roles: readonly string[]) => void) | undefined
}

/** The stored snapshot's file in the agent data folder, for one workspace. */
export function storedTeamSnapshotFile(dataFolder: string, cwd: string): string {
  return path.join(dataFolder, ACP_SESSIONS_SUBFOLDER, workspaceKey(cwd), EXEC_TEAM_STATE_FILE)
}

async function optionalText(
  deps: StoredTeamSnapshotDeps,
  file: string,
): Promise<string | undefined> {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(
      await deps.readFile(file, EXEC_PROMPT_MAX_BYTES, deps.signal),
    )
  } catch (error: unknown) {
    if (isErrno(error) && error.code === 'ENOENT') return undefined
    throw error
  }
}

function invalid(reason: string): Error {
  return new Error(fill(UI_TEXT.execTeamConfigInvalid, { reason }))
}

/**
RVCM96B2 P3-9: team.json failures reach the user through the translated
table keys, never as raw zod or JSON text. The entry path (a key the user
wrote) is spliced as the technical detail.
*/
function configRefusal(reason: string): Error {
  if (reason === 'team.json is not JSON') return new Error(UI_TEXT.execTeamConfigNotJson)
  if (reason === 'team.json holds an object') return new Error(UI_TEXT.execTeamConfigNotObject)
  if (reason === 'team.json holds an invalid sharedFiles')
    return new Error(fill(UI_TEXT.execTeamConfigBadEntry, { entry: 'sharedFiles' }))
  const separator = reason.indexOf(': ')
  const entry =
    separator === -1
      ? reason.replace(/^team\.json (adds an? |raises |holds an (unknown key|invalid) )/, '')
      : reason.slice(separator + 2).trim()
  if (reason.includes(' adds ') || reason.includes(' raises '))
    return new Error(fill(UI_TEXT.execTeamConfigLowersOnly, { entry }))
  return entry === reason
    ? invalid(reason)
    : new Error(fill(UI_TEXT.execTeamConfigBadEntry, { entry }))
}

/** Lower only the snapshot's existing caps; repository text cannot add agents. */
async function lowerSnapshot(
  deps: StoredTeamSnapshotDeps,
  snapshot: TeamSnapshot,
): Promise<TeamSnapshot> {
  const raw = await optionalText(deps, teamJsonPath(deps.cwd, deps.platform))
  if (raw === undefined) return snapshot
  const parsed = parseTeamJson(raw)
  if (!parsed.ok) throw configRefusal(parsed.reason)
  const roles = Object.fromEntries(
    snapshot.roles.map((role) => {
      const measures = new Set(role.pool.flatMap((entry) => entry.caps.map((cap) => cap.measure)))
      const caps: Record<string, number> = {
        concurrent: Math.min(...role.pool.map((entry) => entry.concurrent)),
      }
      for (const measure of measures) {
        const values = role.pool.map((entry) => entry.caps.filter((cap) => cap.measure === measure))
        if (values.every((value) => value.length > 0))
          caps[measure] = Math.min(...values.flat().map((cap) => cap.amount))
      }
      return [role.role, { caps }]
    }),
  )
  const lowering = lowerTeamWithJson(
    { roles, budgets: deps.budgetUsd === undefined ? {} : { spendUsd: deps.budgetUsd } },
    parsed.file,
  )
  if (!lowering.ok) throw configRefusal(lowering.reason)
  const budget = lowering.lowered.budgets['spendUsd']
  if (budget !== undefined && deps.onLoweredBudget !== undefined) {
    // The file's number enters the exact decimal type directly; more than
    // six decimals is refused in the translated table key, not in English.
    try {
      deps.onLoweredBudget(Usd.from(budget).toAmount())
    } catch (error: unknown) {
      throw new Error(fill(UI_TEXT.execTeamConfigBadEntry, { entry: 'budgets.spendUsd' }), {
        cause: error,
      })
    }
  }
  // This host's review role is code-review. Refuse a different requirement rather than ignore it.
  const unsupportedReviewer = Object.entries(lowering.lowered.reviewers).find(
    ([, reviewer]) => reviewer !== 'code-review',
  )
  if (
    unsupportedReviewer !== undefined ||
    (Object.keys(lowering.lowered.reviewers).length > 0 &&
      snapshot.roles.every((role) => !(role.role === 'code-review' && role.pool.length > 0)))
  )
    throw new Error(
      fill(UI_TEXT.execTeamReviewerUnsupported, {
        entry:
          unsupportedReviewer === undefined
            ? 'code-review'
            : `roles.${unsupportedReviewer[0]}.reviewer`,
      }),
    )
  deps.onRequireReviews?.(Object.keys(lowering.lowered.reviewers))
  return {
    ...snapshot,
    roles: snapshot.roles
      .filter((role) => !lowering.lowered.offRoles.includes(role.role))
      .map((role) => ({
        ...role,
        pool: role.pool.map((entry) => ({
          ...entry,
          concurrent: Math.min(
            entry.concurrent,
            lowering.lowered.caps[role.role]?.['concurrent'] ?? entry.concurrent,
          ),
          caps: entry.caps.map((cap) => ({
            ...cap,
            amount: Math.min(
              cap.amount,
              lowering.lowered.caps[role.role]?.[cap.measure] ?? cap.amount,
            ),
          })),
        })),
      })),
  }
}

/**
The person's stored team for this workspace, lowered by the repository's
team.json, or undefined when none is stored. A stored file that cannot be
read as a snapshot refuses in the translated words, never a raw dump.
*/
export async function readStoredTeamSnapshot(
  deps: StoredTeamSnapshotDeps,
): Promise<{ readonly snapshot: TeamSnapshot; readonly template?: string } | undefined> {
  const raw = await optionalText(deps, storedTeamSnapshotFile(deps.dataFolder, deps.cwd))
  if (raw === undefined) return undefined
  // RVCM96B2 P3-9: the stored file is user data; a malformed one is
  // refused in the translated key, never as a raw JSON or zod dump.
  let document: unknown
  try {
    document = JSON.parse(raw) as unknown
  } catch (error: unknown) {
    // JSON.parse on text throws only for malformed content.
    if (error instanceof SyntaxError)
      throw new Error(UI_TEXT.execTeamStateUnreadable, { cause: error })
    throw error
  }
  const parsed = teamSnapshotSchema.safeParse(document)
  if (!parsed.success) throw new Error(UI_TEXT.execTeamStateUnreadable)
  const metadata = z.object({ template: z.optional(z.string()) }).safeParse(document)
  if (!metadata.success) throw new Error(UI_TEXT.execTeamStateUnreadable)
  const snapshot = teamSnapshotSchema.parse(await lowerSnapshot(deps, parsed.data))
  return {
    snapshot,
    ...(metadata.data.template !== undefined && { template: metadata.data.template }),
  }
}
