// M96b: keep CLI/headless admission independent of ACP mapping schemas.
import * as z from 'zod/mini'
import { UI_TEXT } from '../shared/constants'
import { checkTeamAvailability, type TeamAvailabilityCandidate } from '../shared/teamAvailability'

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

const teamSessionAdmissionInputSchema = z.strictObject({
  sessionModelId: z.string().check(z.minLength(1)),
  customEntries: z.array(
    z.strictObject({
      modelId: z.string().check(z.minLength(1)),
      billsKey: z.boolean(),
      isAvailable: z.boolean(),
    }),
  ),
  teamSwitchOff: z.boolean(),
  teamWorkersOn: z.boolean(),
})

/**
D217: the ACP session's team admission, on the one availability rule. The
session's own model leads; the workspace entries (read from the agent's
data folder, as M96b wires them) are the worker candidates. A refusal
names the rule, never a budget or a missing flag. The same-model
comparison rides beside the input, as `TeamDecisionSource` carries it.
*/
export function teamSessionAdmission(
  input: {
    readonly sessionModelId: string
    readonly customEntries: readonly TeamAvailabilityCandidate[]
    readonly teamSwitchOff: boolean
    readonly teamWorkersOn: boolean
  },
  isSameModel: (a: string, b: string) => boolean,
): { readonly ok: true } | { readonly ok: false; readonly reason: string } {
  const parsed = parseInput(teamSessionAdmissionInputSchema, input, 'team session admission')
  const availability = checkTeamAvailability({
    isSwitchedOff: parsed.teamSwitchOff,
    leadModelId: parsed.sessionModelId,
    candidates: parsed.customEntries,
    isSameModel,
    teamWorkersOn: parsed.teamWorkersOn,
  })
  if (availability.isAvailable) return { ok: true }
  return {
    ok: false,
    reason:
      availability.reason === 'switched-off'
        ? UI_TEXT.teamSwitchedOff
        : UI_TEXT.teamNeedsSecondModel,
  }
}
