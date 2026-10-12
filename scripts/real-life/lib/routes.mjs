// The routes a run can take: who is paid, on which wire format, with which
// model. Each is the cheapest model the route offers that the product's own
// catalogue knows; a model the catalogue does not know is hidden by the
// product, so a route cannot run on it (docs/testing/real-life.md).
// `stored` is the name the route's credential is kept under where the run
// gets its credentials from (lib/keys.mjs): a name, never the credential.
//
// A configured provider is added under a name of the run's own
// (`rl-<route>`), so its key sits in the operating system's credential store
// beside the person's own entries and never replaces one: the run adds it,
// and removes it, through the product's own commands.

/** @typedef {{ kind: 'provider', preset: string, model: string, stored: string, wire: string, note?: string } | { kind: 'meta', model: string, stored: string, wire: string, note?: string } | { kind: 'museCode', model: string, wire: string, note?: string }} Route */

/** @type {Readonly<Record<string, Route>>} */
export const ROUTES = Object.freeze({
  anthropic: {
    kind: 'provider',
    preset: 'anthropic',
    model: 'claude-haiku-4-5',
    stored: 'anthropic-fleet-1',
    wire: 'Anthropic Messages',
  },
  openai: {
    kind: 'provider',
    preset: 'openai',
    model: 'gpt-5-nano',
    stored: 'openai',
    wire: 'OpenAI Responses',
  },
  xai: {
    kind: 'provider',
    preset: 'xai',
    model: 'grok-build-0.1',
    stored: 'xai',
    wire: 'OpenAI Responses (xAI)',
  },
  gemini: {
    kind: 'provider',
    preset: 'gemini',
    model: 'gemini-3.8-flash',
    stored: 'gemini',
    wire: 'Gemini',
  },
  zai: {
    kind: 'provider',
    preset: 'zai',
    model: 'glm-5.3-flash',
    stored: 'zai',
    wire: 'chat completions (Z.ai)',
  },
  // An account with no credit: every request is refused by the provider,
  // which costs nothing and must be said in the provider's own words.
  'anthropic-no-credit': {
    kind: 'provider',
    preset: 'anthropic',
    model: 'claude-haiku-4-5',
    stored: 'anthropic-fleet-2',
    wire: 'Anthropic Messages',
    note: 'no credit',
  },
  // Meta's Model API on the contributor model, named: never another Muse
  // model, and never a request whose tier is unknown.
  meta: {
    kind: 'meta',
    model: 'muse-spark-1.3-contributor',
    stored: 'modelapi-key',
    wire: 'Meta Model API',
  },
  // The Muse Code subscription, through the Muse Code CLI the machine has
  // signed in (no key of the run's own).
  musecode: { kind: 'museCode', model: 'muse-spark-1.3-contributor', wire: 'Muse Code' },
})

/** The name a route's provider is added under. */
export const providerIdOf = (routeId) => `rl-${routeId}`

/**
 * The route as the run uses it: its model (an override wins) and how the
 * product is told to use it.
 * @param {string} id
 * @param {ReadonlyMap<string, string>} models `--model <route>=<model>` overrides
 */
export function routeFor(id, models = new Map()) {
  const route = ROUTES[id]
  const model = models.get(id) ?? route?.model
  const provider = route?.kind === 'provider' ? providerIdOf(id) : undefined
  return route === undefined
    ? undefined
    : {
        id,
        ...route,
        model,
        provider,
        /** The model as the product names it in a session. */
        modelId: provider === undefined ? model : `${provider}/${model}`,
      }
}

/** The arguments that choose the route for a terminal command. */
export function routeArguments(route) {
  if (route.kind === 'provider') {
    return ['--backend', 'modelApi', '--provider', route.provider, '--model', route.modelId]
  }
  const backend = route.kind === 'meta' ? 'modelApi' : 'museCode'
  return ['--backend', backend, '--allow-contributor-models', '--model', route.model]
}

/** The arguments an editor starts the agent with for the route. */
export function editorArguments(route) {
  if (route.kind === 'museCode') return ['--allow-contributor-models']
  return route.kind === 'meta'
    ? ['--backend', 'modelApi', '--allow-contributor-models']
    : ['--backend', 'modelApi']
}
