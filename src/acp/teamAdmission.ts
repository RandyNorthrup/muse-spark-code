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
 * The runner lane (C-M96b-2) will admit Model API team runs with acceptEdits
 * and a hard budget. Until then, refuse a valid request explicitly.
 */
export function teamExecAdmission(input: {
  readonly mode: string
  readonly backend: string
}): { readonly ok: true } | { readonly ok: false; readonly reason: string } {
  const parsed = parseInput(teamExecAdmissionInputSchema, input, 'team exec admission')
  if (parsed.backend !== 'modelApi') return { ok: false, reason: UI_TEXT.execModelApiOnly }
  const isAcceptEdits = parsed.mode === 'acceptEdits'
  return {
    ok: false,
    reason: isAcceptEdits ? UI_TEXT.execTeamNotReady : UI_TEXT.execTeamNeedsEdits,
  }
}
