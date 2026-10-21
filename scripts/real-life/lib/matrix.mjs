// A model matrix: for each route the models a run tries, one plain turn and
// one tool turn each, by the terminal agent. The file is plain JSON:
//
//   { "anthropic": ["claude-haiku-4-5", "claude-sonnet-4-6"],
//     "openrouter": [{ "id": "some/model:free", "free": true }] }
//
// A model is its id as the provider lists it; `free` says its listed price
// is zero, so a turn on it is expected to cost nothing.
import { readFileSync } from 'node:fs'
import { ROUTES, routeRefusal } from './routes.mjs'

/**
@param {unknown} listed the models of one route as the file spells them
@returns {{ id: string, free: boolean }[]} none when the list is empty or one is misspelt
*/
function modelsOf(listed) {
  if (!Array.isArray(listed)) return []
  const models = listed.map((one) =>
    typeof one === 'string' ? { id: one, free: false } : { id: one?.id, free: one?.free === true },
  )
  const isSpelt = models.every((model) => typeof model.id === 'string' && /^\S+$/u.test(model.id))
  return isSpelt && new Set(models.map((model) => model.id)).size === models.length ? models : []
}

/**
@param {string} file
@returns {{ ok: true, groups: { routeId: string, models: { id: string, free: boolean }[] }[] } | { ok: false, reason: string }}
*/
export function readMatrix(file) {
  let parsed
  try {
    parsed = JSON.parse(readFileSync(file, 'utf8'))
  } catch (error) {
    return { ok: false, reason: `--matrix ${file}: ${error instanceof Error ? error.message : ''}` }
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    return { ok: false, reason: `--matrix ${file}: an object of route to models is expected` }
  }
  const groups = []
  for (const [routeId, listed] of Object.entries(parsed)) {
    if (ROUTES[routeId]?.note !== undefined) {
      return { ok: false, reason: `--matrix: ${routeId} is not a route for a matrix` }
    }
    const models = modelsOf(listed)
    if (models.length === 0) {
      return {
        ok: false,
        reason: `--matrix: ${routeId} needs a list of model ids, each once and with no space`,
      }
    }
    const refusal = models
      .map((model) => routeRefusal(routeId, model.id))
      .find((reason) => reason !== undefined)
    if (refusal !== undefined) return { ok: false, reason: `--matrix: ${refusal}` }
    groups.push({ routeId, models })
  }
  return groups.length === 0
    ? { ok: false, reason: `--matrix ${file}: no route is named` }
    : { ok: true, groups }
}
