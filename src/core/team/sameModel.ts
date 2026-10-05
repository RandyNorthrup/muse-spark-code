// Lane R (M96, PLAN.md D75): model identity for the single-model rule.
//
// Two entries hold the same model when their model ids match after
// trimming — whatever provider or backend serves them. A custom entry of
// the orchestrator's own model, with other caps or through another
// provider, is still one model: with one model after this dedupe, nothing
// team-related loads or changes requests (acceptance 47). Lane T's
// `singleModel.ts` decides the mode; this module only answers "same?".

/** An agent a pool entry can name: one model on one backend. */
export interface TeamModelRef {
  readonly backend: 'museCode' | 'modelApi' | 'external'
  readonly provider?: string | undefined
  readonly model: string
}

/** A model id as identity sees it: surrounding whitespace never distinguishes models. */
export function normalizeTeamModelId(id: string): string {
  return id.trim()
}

/** Whether two model ids name the same model, provider and backend aside. */
export function sameTeamModel(a: string, b: string): boolean {
  return normalizeTeamModelId(a) === normalizeTeamModelId(b)
}

/** Each distinct model id in first-seen order. */
export function distinctTeamModels(ids: readonly string[]): string[] {
  const seen: string[] = []
  for (const id of ids) {
    const normalized = normalizeTeamModelId(id)
    if (!seen.includes(normalized)) {
      seen.push(normalized)
    }
  }
  return seen
}

/**
 * Whether pool entries plus the orchestrator slot hold one model: nothing
 * configured, only Default, duplicate models, or entries that all resolve
 * to the slot's model. Lane A resolves Default to the slot before calling.
 */
export function isSingleTeamModel(ids: readonly string[]): boolean {
  return distinctTeamModels(ids).length <= 1
}
