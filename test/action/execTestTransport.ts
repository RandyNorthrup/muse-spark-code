// M80 W (SPEC §7.5): the scripted Meta API behind the fake-only test package.
// exec-test-launcher.ts installs it as fetch for exactly the Model API's
// origin; every other URL keeps the real transport. The replies are the
// captured wire shapes of test/unit/helpers/fakeModelApi.ts: two responses
// per run, each 10 input and 5 output tokens, the first calling one tool on
// the W fixture, the second the final message. No real key, no network to
// Meta, no spend. The report holds hashes and booleans, never a value.

import { createHash } from 'node:crypto'
import { MODEL_API_BASE_URL, MODEL_API_TOOLS } from '../../src/shared/constants'
import { FAKE_MODEL_API_KEY, fakeModelApi, type ScriptedReply } from '../unit/helpers/fakeModelApi'

/** The fabricated key the W workflow passes as model-api-key; never a credential. */
export const W_FIXTURE_KEY = 'LLM|1|m80-w-fabricated'
/** The fabricated GitHub token sentinel W plants in the Action step's environment. */
export const W_SENTINEL = 'M80W-SENTINEL-fabricated-token'
/** The repository file W-review reads. */
export const W_FIXTURE_FILE = 'test/action/w-fixture.txt'
/**
 * The new text file W-text writes: write_file replaces an existing file only
 * as the model last read it (D27), and W-text makes one call, so it creates.
 */
export const W_TEXT_FILE = 'test/action/w-text-fix.txt'
/** W-image's destination: unignored, so the patch carries a binary file. */
export const W_IMAGE_FILE = 'generated/m80.png'
export const W_TEXT_CONTENT = 'W text fix: one ordinary new line.\n'
const USAGE = { input: 10, output: 5 } as const
const BILLABLE_PATHS = new Set(['/v1/responses', '/v1/images/generations', '/v1/images/edits'])
const COUNT_PATH_SUFFIX = '/input_tokens'

export type WScenario = 'review' | 'text' | 'image'

/** The scenario from exec's own arguments: plan reviews; acceptEdits fixes, with an image when flagged. */
export function scenarioOf(argv: readonly string[]): WScenario {
  const at = argv.indexOf('--permission-mode')
  if (at === -1 || argv[at + 1] !== 'acceptEdits') return 'review'
  return argv.includes('--image-generation') ? 'image' : 'text'
}

/** The two scripted responses of a scenario. */
export function scriptFor(scenario: WScenario): ScriptedReply[] {
  const calls = {
    review: { name: MODEL_API_TOOLS.readFile, arguments: JSON.stringify({ path: W_FIXTURE_FILE }) },
    text: {
      name: MODEL_API_TOOLS.writeFile,
      arguments: JSON.stringify({ path: W_TEXT_FILE, content: W_TEXT_CONTENT }),
    },
    image: {
      name: MODEL_API_TOOLS.generateImage,
      arguments: JSON.stringify({ path: W_IMAGE_FILE, prompt: 'a small blue square on white' }),
    },
  }
  const call = calls[scenario]
  return [
    { calls: [call], usage: USAGE },
    { text: `W ${scenario}: done after one ${call.name} call.`, usage: USAGE },
  ]
}

export interface WRequest {
  readonly method: string
  readonly path: string
}

export interface WTransport {
  readonly fetch: typeof fetch
  readonly requests: readonly WRequest[]
  /** The bearer keys requests carried; held for leak checks, never reported. */
  readonly keys: ReadonlySet<string>
  /** Request bodies, for leak checks only. */
  readonly bodies: readonly string[]
  readonly passedThrough: number
}

function urlOf(input: Parameters<typeof fetch>[0]): URL {
  if (typeof input === 'string') return new URL(input)
  return input instanceof URL ? input : new URL(input.url)
}

/** fetch for the scenario: the scripted fake for Meta's origin, `inner` for any other. */
export function createWTransport(scenario: WScenario, inner: typeof fetch): WTransport {
  const api = fakeModelApi()
  api.script(...scriptFor(scenario))
  const origin = new URL(MODEL_API_BASE_URL).origin
  const requests: WRequest[] = []
  const keys = new Set<string>()
  const bodies: string[] = []
  const counts = { passedThrough: 0 }
  const scripted: typeof fetch = async (input, init) => {
    const url = urlOf(input)
    if (url.origin !== origin) {
      counts.passedThrough += 1
      return await inner(input, init)
    }
    const headers = new Headers(init?.headers)
    const key = /^Bearer (\S+)$/.exec(headers.get('authorization') ?? '')?.[1]
    if (typeof init?.body === 'string') bodies.push(init.body)
    requests.push({ method: init?.method ?? 'GET', path: url.pathname })
    if (key === undefined) {
      return Response.json(
        { error: { message: 'no key', type: 'authentication_error' } },
        { status: 401 },
      )
    }
    keys.add(key)
    // The shared fake answers its own fixed key; the run's key was recorded above.
    headers.set('authorization', `Bearer ${FAKE_MODEL_API_KEY}`)
    return await api.fetch(url.href, { ...init, headers: Object.fromEntries(headers) })
  }
  return {
    fetch: scripted,
    requests,
    keys,
    bodies,
    get passedThrough() {
      return counts.passedThrough
    },
  }
}

export interface WReport {
  readonly v: 1
  readonly command: string
  readonly scenario: WScenario
  readonly argvSha256: readonly string[]
  readonly envSha256: Readonly<Record<string, string>>
  readonly requests: readonly WRequest[]
  readonly billableRequests: number
  readonly countRequests: number
  readonly passedThrough: number
  readonly sawKey: boolean
  readonly keyInArgv: boolean
  readonly keyInEnv: boolean
  readonly keyInBodies: boolean
  readonly sentinelInArgv: boolean
  readonly sentinelInEnv: boolean
  readonly sentinelInBodies: boolean
  /** This process's initial OS environment (Linux /proc, macOS ps): inspected or not. */
  readonly initialEnviron: 'inspected' | 'unavailable'
  readonly keyInInitialEnviron: boolean | null
  readonly sentinelInInitialEnviron: boolean | null
  /** Whether the parent's initial environment names the key variable (the sanctioned launcher). */
  readonly parentHoldsKeyVariable: boolean | null
}

const sha256 = (value: string) => createHash('sha256').update(value).digest('hex')

function hasText(texts: readonly string[], needle: string): boolean {
  return texts.some((text) => text.includes(needle))
}

/**
 * What one process saw, as hashes and booleans. Key checks use the fabricated
 * W key and every key a request carried; a value is never written.
 */
export function wReport(input: {
  command: string
  scenario: WScenario
  argv: readonly string[]
  env: Readonly<Record<string, string | undefined>>
  transport: WTransport
  initialEnviron: string | undefined
  parentEnviron: string | undefined
}): WReport {
  const { transport } = input
  const literals = [W_FIXTURE_KEY, ...transport.keys]
  const values = Object.values(input.env).filter((value) => typeof value === 'string')
  const hasKey = (texts: readonly string[]) => literals.some((literal) => hasText(texts, literal))
  const environ = input.initialEnviron
  return {
    v: 1,
    command: input.command,
    scenario: input.scenario,
    argvSha256: input.argv.map((arg) => sha256(arg)),
    envSha256: Object.fromEntries(
      Object.entries(input.env)
        .filter((entry): entry is [string, string] => typeof entry[1] === 'string')
        .toSorted(([left], [right]) => left.localeCompare(right))
        .map(([name, value]) => [name, sha256(value)]),
    ),
    requests: transport.requests,
    billableRequests: transport.requests.filter(
      (request) => request.method === 'POST' && BILLABLE_PATHS.has(request.path),
    ).length,
    countRequests: transport.requests.filter((request) => request.path.endsWith(COUNT_PATH_SUFFIX))
      .length,
    passedThrough: transport.passedThrough,
    sawKey: transport.keys.size > 0,
    keyInArgv: hasKey(input.argv),
    keyInEnv: hasKey(values),
    keyInBodies: hasKey(transport.bodies),
    sentinelInArgv: hasText(input.argv, W_SENTINEL),
    sentinelInEnv: hasText(values, W_SENTINEL),
    sentinelInBodies: hasText(transport.bodies, W_SENTINEL),
    initialEnviron: environ === undefined ? 'unavailable' : 'inspected',
    keyInInitialEnviron: environ === undefined ? null : hasKey([environ]),
    sentinelInInitialEnviron: environ === undefined ? null : environ.includes(W_SENTINEL),
    parentHoldsKeyVariable:
      input.parentEnviron === undefined
        ? null
        : input.parentEnviron.includes('MUSE_SPARK_MODEL_API_KEY='),
  }
}
