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
    model: 'claude-haiku-4-5-20251001',
    stored: 'anthropic-fleet-1',
    wire: 'Anthropic Messages',
  },
  openai: {
    kind: 'provider',
    preset: 'openai',
    model: 'gpt-5.6-luna',
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
  deepseek: {
    kind: 'provider',
    preset: 'deepseek',
    model: 'deepseek-flash',
    stored: 'deepseek',
    wire: 'chat completions (DeepSeek)',
  },
  mistral: {
    kind: 'provider',
    preset: 'mistral',
    model: 'ministral-3b-latest',
    stored: 'mistral',
    wire: 'chat completions (Mistral)',
  },
  // The resellers: one key, many makers' models.
  groq: {
    kind: 'provider',
    preset: 'groq',
    model: 'openai/gpt-oss-20b',
    stored: 'groq',
    wire: 'chat completions (Groq)',
  },
  together: {
    kind: 'provider',
    preset: 'together',
    model: 'deepseek-ai/DeepSeek-V4-Flash-0731',
    stored: 'together',
    wire: 'chat completions (Together)',
  },
  fireworks: {
    kind: 'provider',
    preset: 'fireworks',
    model: 'accounts/fireworks/models/nemotron-lightning-3p5-30b-a3b',
    stored: 'fireworks',
    wire: 'chat completions (Fireworks)',
  },
  huggingface: {
    kind: 'provider',
    preset: 'huggingface',
    model: 'google/gemma-3-4b-it',
    stored: 'huggingface',
    wire: 'chat completions (Hugging Face)',
  },
  openrouter: {
    kind: 'provider',
    preset: 'openrouter',
    model: 'mistralai/mistral-nemo',
    stored: 'openrouter',
    wire: 'chat completions (OpenRouter)',
  },
  // An account with no credit: every request is refused by the provider,
  // which costs nothing and must be said in the provider's own words.
  'anthropic-no-credit': {
    kind: 'provider',
    preset: 'anthropic',
    model: 'claude-haiku-4-5-20251001',
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
  // signed in (no key of the run's own). Named here, and not run: see
  // MUSE_CODE_NOT_RUN.
  musecode: { kind: 'museCode', model: 'muse-spark-1.3-contributor', wire: 'Muse Code' },
})

// A request on the Muse Code subscription is allowed only on a Muse Code CLI
// version known to bill the contributor tier. The run would have to read
// which CLI the product is about to start and compare its version with one
// the operator names. The product does not say: its `report` prints "cli:
// found" and nothing of a path or a version (0.18.2). Until it does, the
// route is refused, on every system.
const MUSE_CODE_NOT_RUN =
  'the route musecode is not run: the product does not say which Muse Code CLI version it will start (its report prints only "cli: found"), so the run cannot check it against a version known to bill the contributor tier'

/** The name a route's provider is added under. */
export const providerIdOf = (routeId) => `rl-${routeId}`
// The names a diagnostic adds its provider under (`rlq-<route>`): the run
// looks for both when it starts, since either can be left by a killed process.
export const DIAGNOSTIC_PREFIX = 'rlq-'

// Meta's own model families, under whatever name a reseller lists them.
const META_FAMILY = /muse|wonder/iu

/**
 * Why a route may not run on a model; nothing when it may. This is the one
 * place that decides it, for a model named on the command line and for
 * every model of a matrix.
 *
 * A model of Meta's is asked on a Meta route's contributor model and nowhere
 * else: a Meta route runs on the model it names and on no other (not
 * another Muse model, not another contributor model), and a configured
 * provider's route takes any model but one of Meta's.
 * @param {string} id the route
 * @param {string | undefined} model the model asked for (the route's own when none is)
 * @returns {string | undefined}
 */
export function routeRefusal(id, model) {
  const route = ROUTES[id]
  if (route === undefined) return `not a route: ${id} (--list prints them)`
  if (route.kind === 'museCode') return MUSE_CODE_NOT_RUN
  const asked = model ?? route.model
  if (route.kind !== 'provider') {
    return asked === route.model
      ? undefined
      : `the route ${id} runs on ${route.model} only, and ${asked} is not it`
  }
  return META_FAMILY.test(asked)
    ? `${asked} is a model of Meta's: the run asks those on the route meta only, on its contributor model`
    : undefined
}

/**
 * The route as the run uses it: its model (an override wins) and how the
 * product is told to use it.
 * @param {string} id
 * @param {ReadonlyMap<string, string>} models `--model <route>=<model>` overrides
 */
export function routeFor(id, models = new Map()) {
  const route = ROUTES[id]
  const refusal = route === undefined ? undefined : routeRefusal(id, models.get(id))
  if (refusal !== undefined) throw new Error(refusal)
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
