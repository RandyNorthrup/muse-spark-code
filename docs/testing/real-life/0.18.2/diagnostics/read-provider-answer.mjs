// A DIAGNOSTIC, not part of the real-life run: no scenario loads it.
//
// Reads the provider's own answer to the request the PRODUCT builds and
// sends. The packed agent runs one turn on one model, exactly as the model
// matrix runs it, with fetch-tap.mjs loaded before it: the tap records the
// request the product sent and the answer it got, and lets no retry out.
// It was written for 0.18.2, which tells a person "the response did not
// complete" whatever the provider answered.
//
// The key is held in memory, goes to the product's own `providers add` on
// standard input, and is removed afterwards; the tap writes no credential.
// What is written still carries the provider's ids of the account: zero
// them before the file is kept (the kept files beside this folder are).
//
//   node read-provider-answer.mjs <agent tarball> <route> <model> <host> <keys> <out.json> [tool]
//
// <route> and <keys> are the real-life run's own (scripts/real-life/run.mjs
// --list; docs/testing/real-life.md). `tool` runs the tool turn (a file
// written) and lets its two requests out; without it, the plain turn's one.
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { homedir, hostname, tmpdir, userInfo } from 'node:os'
import path from 'node:path'
import process from 'node:process'
import { pathToFileURL } from 'node:url'
import { productEnvironment } from '../../../../../scripts/real-life/lib/home.mjs'
import { installArtefact } from '../../../../../scripts/real-life/lib/install.mjs'
import { keySource, readKey } from '../../../../../scripts/real-life/lib/keys.mjs'
import { jsonLines, runCommand } from '../../../../../scripts/real-life/lib/product.mjs'
import { scrubber } from '../../../../../scripts/real-life/lib/record.mjs'
import { ROUTES } from '../../../../../scripts/real-life/lib/routes.mjs'

const PLAIN =
  'This is a connection check. Please confirm that you received this message by quoting its reference code back to me. The reference code is RL-PROBE01.'
const TOOL =
  'Create a file named real-life-note.txt in the workspace whose whole content is the single line RL-PROBE01. Then reply with the one word DONE.'
const ADMIT_USD = '20.00'

const [tarball, routeId, model, host, keys, out, turn = 'plain'] = process.argv.slice(2)
const route = ROUTES[routeId]
if (out === undefined || route?.kind !== 'provider') {
  console.error(
    'usage: read-provider-answer.mjs <agent tarball> <route of a provider> <model> <host> <keys> <out.json> [tool]',
  )
  process.exit(2)
}
const isTool = turn === 'tool'
const read = readKey(keySource(keys), route.stored)
if (read.key === undefined) {
  console.error(read.reason)
  process.exit(2)
}
const root = mkdtempSync(path.join(tmpdir(), 'read-provider-answer-'))
const folders = { install: path.join(root, 'install'), home: path.join(root, 'home') }
const workspace = path.join(root, 'workspace')
for (const folder of [folders.install, folders.home, workspace]) mkdirSync(folder)
// The run's own scrub: the key, the run's folder, the home, the user and the
// machine, in every spelling a path takes (the product's request names the
// workspace it runs in).
const scrub = scrubber(
  new Map([
    [read.key, '<key>'],
    [root, '<run>'],
    [homedir(), '<home>'],
    [userInfo().username, '<user>'],
    [hostname(), '<machine>'],
  ]),
)

/** Every text of a value, scrubbed: a request's body is JSON inside the tap's JSON. */
function scrubbed(value) {
  if (typeof value === 'string') return scrub(value)
  if (Array.isArray(value)) return value.map((one) => scrubbed(one))
  return typeof value === 'object' && value !== null
    ? Object.fromEntries(Object.entries(value).map(([name, one]) => [name, scrubbed(one)]))
    : value
}
const tapFile = path.join(root, 'tap.jsonl')
const provider = `rlq-${routeId}`
const state = { isAdded: false }
let plain
try {
  const installed = installArtefact(tarball, folders.install)
  if (!installed.ok) throw new Error(installed.reason)
  plain = { agent: installed.agent, env: productEnvironment(folders.home) }
  const tapped = {
    agent: installed.agent,
    env: {
      ...plain.env,
      NODE_OPTIONS: `--import ${pathToFileURL(path.join(import.meta.dirname, 'fetch-tap.mjs')).href}`,
      RL_TAP_OUT: tapFile,
      RL_TAP_HOST: host,
      RL_TAP_POSTS: isTool ? '2' : '1',
    },
  }
  const added = await runCommand(
    plain,
    [
      'providers',
      'add',
      '--preset',
      route.preset,
      '--as',
      provider,
      '--model',
      model,
      '--key-stdin',
    ],
    { cwd: workspace, stdin: `${read.key}\n` },
  )
  state.isAdded = added.code === 0
  if (!state.isAdded) throw new Error(scrub(`providers add: ${added.stdout} ${added.stderr}`))
  // The tap is proved first on the free model listing: when it records
  // nothing there, no model request is made at all.
  await runCommand(tapped, ['providers', 'test', provider], { cwd: workspace })
  if (!existsSync(tapFile)) throw new Error('the tap recorded nothing on the free listing')
  writeFileSync(tapFile, '')
  const run = await runCommand(
    tapped,
    [
      'exec',
      '--backend',
      'modelApi',
      '--provider',
      provider,
      '--model',
      `${provider}/${model}`,
      '--permission-mode',
      isTool ? 'acceptEdits' : 'plan',
      '--max-requests',
      isTool ? '2' : '1',
      '--max-budget-usd',
      ADMIT_USD,
      '--output',
      'jsonl',
      isTool ? TOOL : PLAIN,
    ],
    { cwd: workspace },
  )
  const result = jsonLines(run.stdout).findLast((event) => event.type === 'result')?.result
  const fetches = readFileSync(tapFile, 'utf8')
    .split('\n')
    .filter((line) => line !== '')
    .map((line) => scrubbed(JSON.parse(line)))
  const record = {
    route: routeId,
    model,
    product: `${installed.name} ${installed.version}`,
    exec: {
      exit: run.code,
      status: result?.status,
      requests: result?.usage?.requests,
      costUsd: result?.usage?.costUsd,
      error: result?.error ?? null,
    },
    fetches,
  }
  writeFileSync(out, `${JSON.stringify(record, null, 1)}\n`)
  for (const fetched of fetches) {
    console.log(
      `${fetched.method} ${fetched.url} -> ${String(fetched.status ?? fetched.failed ?? fetched.notSent)}`,
    )
  }
  console.log(`written ${out} (zero the account's ids in it before it is kept)`)
} catch (error) {
  console.error(scrub(error instanceof Error ? error.message : String(error)))
  process.exitCode = 1
} finally {
  if (state.isAdded) await runCommand(plain, ['providers', 'remove', provider], { cwd: workspace })
  rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 300 })
}
