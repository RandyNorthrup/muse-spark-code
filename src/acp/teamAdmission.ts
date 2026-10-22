// M96b: keep CLI/headless admission independent of ACP mapping schemas.
import * as z from 'zod/mini'
import { UI_TEXT } from '../shared/constants'

/** A caller value cannot be represented by the frozen team contract. */
export class TeamContractError extends Error {
  override readonly name = 'TeamContractError'
}

/** Parse shape once; never inspect arbitrary values thrown by the parser. */
export function parseInput<Schema extends z.ZodMiniType>(
  schema: Schema,
  input: unknown,
  what: string,
): z.infer<Schema> {
  let result
  try {
    result = schema.safeParse(input)
  } catch (error) {
    throw new TeamContractError(`M96b: a team builder cannot read its ${what}`, { cause: error })
  }
  if (!result.success) {
    const paths = result.error.issues.map((issue) => issue.path.join('.') || '(input)').join(', ')
    throw new TeamContractError(`M96b: a team builder rejected its ${what} at ${paths}`, {
      cause: result.error,
    })
  }
  return result.data
}

const teamExecAdmissionInputSchema = z.strictObject({ mode: z.string(), backend: z.string() })

/**
Headless engine teams sit behind the agent-teams availability switch
(`museSpark.team` for the editor surfaces) like every other team surface.
The headless side is this in-memory certification flag, off until the
runner lane is certified: with it off `exec` has no `--team` flag, and no
run reaches the team money path. Tests flip it with
`setHeadlessTeamsAvailable`; production leaves it off.
*/
// Holder object (the `setUiText` shape in shared/l10n/text.ts): the setter
// mutates the holder, never a top-level binding.
const headlessTeamsState: { isAvailable: boolean } = { isAvailable: false }

export function areHeadlessTeamsAvailable(): boolean {
  return headlessTeamsState.isAvailable
}

export function setHeadlessTeamsAvailable(isAvailable: boolean): void {
  headlessTeamsState.isAvailable = isAvailable
}

/**
Exec validates its hard budget first. Team dispatch additionally requires
the Model API engine and acceptEdits; every other mode refuses explicitly.
*/
export function teamExecAdmission(input: {
  readonly mode: string
  readonly backend: string
}): { readonly ok: true } | { readonly ok: false; readonly reason: string } {
  const parsed = parseInput(teamExecAdmissionInputSchema, input, 'team exec admission')
  if (parsed.backend !== 'modelApi') return { ok: false, reason: UI_TEXT.execModelApiOnly }
  return parsed.mode === 'acceptEdits'
    ? { ok: true }
    : { ok: false, reason: UI_TEXT.execTeamNeedsEdits }
}
