// M80 W (SPEC §7.5): the fake-only test package, packed for real and run for
// real. A private package tree is built here (the production layout:
// dist/acp.js with dist/uiText.js and dist/modelApi.js beside it, the two
// schemas), scripts/package-acp-test.mjs packs it with the real
// test/action/exec-test-launcher.ts, and the extracted bin then runs as the
// Action's agent: the real run-exec.mjs entry drives exec (key over stdin)
// and the scanner against a gated fixture checkout, and test/action/w-check.mjs
// judges each invocation as the action-check workflow does. Its own tree, so
// it never races the production build of execStdio.e2e.test.ts. No request
// leaves the scripted transport; only fabricated credentials exist here.

import { spawn, spawnSync } from 'node:child_process'
import {
  cpSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs'
import path from 'node:path'
import { build, type Plugin } from 'esbuild'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  createWTransport,
  scenarioOf,
  W_FIXTURE_FILE,
  W_FIXTURE_KEY,
  W_SENTINEL,
  wReport,
} from '../action/execTestTransport'
import { buildModelApiBundle } from '../unit/helpers/modelApiBundle'
import {
  ACTION_DIR,
  originRepo,
  preparedRun,
  readOutputs,
  tempLayout,
  type FixtureRepo,
  type TempLayout,
} from '../unit/helpers/actionFixtures'
import { removeFolder } from '../unit/helpers/temporaryFolders'

const ROOT = path.resolve(import.meta.dirname, '..', '..')
const TEMP = path.join(ROOT, 'temp')
mkdirSync(TEMP, { recursive: true })
const TREE = mkdtempSync(path.join(TEMP, 'm80w-launcher-'))
const STAGE = path.join(TREE, 'dist', 'acp-package')
const VERSION = (
  JSON.parse(readFileSync(path.join(ROOT, 'package.json'), 'utf8')) as {
    version: string
  }
).version
const TARBALL = path.join(TREE, 'dist', `muse-spark-code-acp-test-${VERSION}.tgz`)
const INSTALLED = path.join(TREE, 'installed', 'package')
const LAUNCHER = path.join(INSTALLED, 'dist', 'exec-test-launcher.js')
const TIMEOUT = 120_000
const TAR =
  process.platform === 'win32'
    ? path.join(process.env['SystemRoot'] ?? String.raw`C:\Windows`, 'System32', 'tar.exe')
    : 'tar'
const UI_TEXT_ENTRY = path.join(ROOT, 'src', 'shared', 'l10n', 'en.ts')

/** The production build's shared-ui-text rule: the table stays in dist/uiText.js. */
const sharedUiText: Plugin = {
  name: 'shared-ui-text',
  setup(context) {
    context.onResolve({ filter: /\/en(?:\.[jt]s)?$/ }, (args) =>
      path.resolve(args.resolveDir, args.path.replace(/(?:\.[jt]s)?$/, '.ts')) === UI_TEXT_ENTRY
        ? { path: './uiText.js', external: true }
        : undefined,
    )
  },
}

async function packageTree(): Promise<void> {
  const dist = path.join(STAGE, 'dist')
  mkdirSync(dist, { recursive: true })
  await buildModelApiBundle(dist)
  await build({
    entryPoints: [path.join(ROOT, 'src', 'shared', 'validationEntry.ts')],
    outfile: path.join(dist, 'validation.js'),
    bundle: true,
    platform: 'node',
    format: 'cjs',
    target: 'node22',
    logLevel: 'silent',
  })
  await build({
    entryPoints: [UI_TEXT_ENTRY],
    outfile: path.join(dist, 'uiText.js'),
    bundle: true,
    platform: 'node',
    format: 'cjs',
    target: 'node22',
    logLevel: 'silent',
  })
  await build({
    entryPoints: [path.join(ROOT, 'src', 'runtime', 'main.ts')],
    outfile: path.join(dist, 'acp.js'),
    bundle: true,
    platform: 'node',
    format: 'cjs',
    target: 'node22',
    external: ['@napi-rs/keyring'],
    plugins: [sharedUiText],
    logLevel: 'silent',
  })
  cpSync(path.join(ROOT, 'docs', 'schemas'), path.join(STAGE, 'schemas'), { recursive: true })
  writeFileSync(
    path.join(STAGE, 'package.json'),
    `${JSON.stringify({ name: 'muse-spark-code-acp', version: VERSION, bin: { 'muse-spark-code-acp': 'dist/acp.js' } }, null, 2)}\n`,
  )
  // The packer resolves the launcher (and its imports) at test/action/ in its tree.
  symlinkSync(path.join(ROOT, 'test'), path.join(TREE, 'test'), 'junction')
}

/** A gated origin: base commit holds the W fixture and the repository's real ignore rules. */
function wRepo(layout: TempLayout): FixtureRepo {
  return originRepo(
    layout,
    (source) => {
      mkdirSync(path.join(source, path.dirname(W_FIXTURE_FILE)), { recursive: true })
      cpSync(path.join(ROOT, W_FIXTURE_FILE), path.join(source, W_FIXTURE_FILE))
      cpSync(path.join(ROOT, '.gitignore'), path.join(source, '.gitignore'))
    },
    (source) => {
      writeFileSync(path.join(source, 'notes.txt'), 'W head change\n')
    },
  )
}

type Scenario = 'review' | 'text' | 'image' | 'low-budget'

function scenarioInputs(scenario: Scenario): Record<string, string> {
  return {
    MUSE_INPUT_MODEL: 'muse-spark-1.3-contributor',
    MUSE_INPUT_ALLOW_CONTRIBUTOR_MODELS: 'true',
    MUSE_INPUT_MAX_BUDGET_USD: scenario === 'low-budget' ? '0.10' : '1.00',
    ...(scenario === 'image' && { MUSE_INPUT_IMAGE_GENERATION: 'true' }),
  }
}

/** The real run-exec entry, as the run step execs it, with the test package as agent. */
function runStep(env: NodeJS.ProcessEnv): Promise<{ code: number | null; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [path.join(ACTION_DIR, 'lib', 'run-exec.mjs')], {
      env,
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    })
    let stderr = ''
    child.stdout.resume()
    child.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk.toString()
    })
    child.once('error', reject)
    child.once('close', (code) => {
      resolve({ code, stderr })
    })
  })
}

function checker(env: Record<string, string>) {
  return spawnSync(process.execPath, [path.join(ROOT, 'test', 'action', 'w-check.mjs')], {
    env: { PATH: process.env['PATH'], SystemRoot: process.env['SystemRoot'], ...env },
    encoding: 'utf8',
    timeout: TIMEOUT,
  })
}

beforeAll(async () => {
  await packageTree()
  const packed = spawnSync(process.execPath, [path.join(ROOT, 'scripts', 'package-acp-test.mjs')], {
    cwd: TREE,
    encoding: 'utf8',
    timeout: TIMEOUT,
  })
  expect(packed.status, packed.stderr).toBe(0)
  mkdirSync(path.dirname(INSTALLED), { recursive: true })
  const extracted = spawnSync(TAR, ['-xzf', TARBALL, '-C', path.dirname(INSTALLED)], {
    encoding: 'utf8',
    timeout: TIMEOUT,
  })
  expect(extracted.status, extracted.stderr).toBe(0)
}, TIMEOUT)

afterAll(async () => {
  // The junction first, on its own, so no cleanup can walk into the real test/.
  rmSync(path.join(TREE, 'test'), { force: true })
  await removeFolder(TREE)
})

describe('M80 W fake-only test package', { timeout: TIMEOUT }, () => {
  it('packs the real launcher as a private, separately named, unsigned test variant', () => {
    const manifest = JSON.parse(readFileSync(path.join(INSTALLED, 'package.json'), 'utf8')) as {
      private?: boolean
      bin?: Record<string, string>
      description?: string
    }
    expect(manifest.private).toBe(true)
    expect(manifest.bin).toEqual({ 'muse-spark-code-acp': 'dist/exec-test-launcher.js' })
    expect(manifest.description).toContain('UNSIGNED TEST ONLY')
    expect(
      readdirSync(path.join(INSTALLED, 'schemas')).toSorted((left, right) =>
        left.localeCompare(right),
      ),
    ).toEqual(['exec-event-v1.schema.json', 'exec-result-v1.schema.json'])
    expect(readFileSync(path.join(STAGE, 'package.json'), 'utf8')).not.toContain('exec-test')
    expect(readFileSync(LAUNCHER, 'utf8')).toContain('w-report-')
  })

  it('routes only the Model API origin to the script and reports hashes, never values', async () => {
    const argv = ['exec', '--permission-mode', 'acceptEdits', '--image-generation', 'task']
    expect(scenarioOf(argv)).toBe('image')
    expect(scenarioOf(['exec', '--permission-mode', 'acceptEdits'])).toBe('text')
    expect(scenarioOf(['exec', 'task'])).toBe('review')
    const outside: string[] = []
    const transport = createWTransport('review', (input) => {
      outside.push(typeof input === 'string' ? input : 'not a string')
      return Promise.resolve(new Response('elsewhere'))
    })
    const passed = await transport.fetch('https://example.invalid/x')
    expect(await passed.text()).toBe('elsewhere')
    const refused = await transport.fetch('https://api.meta.ai/v1/models')
    expect(refused.status).toBe(401)
    const models = await transport.fetch('https://api.meta.ai/v1/models', {
      headers: { authorization: `Bearer ${W_FIXTURE_KEY}` },
    })
    expect(models.status).toBe(200)
    const report = wReport({
      command: 'exec',
      scenario: 'review',
      argv,
      env: { GITHUB_TOKEN: W_SENTINEL, HOME: '/private/home' },
      transport,
      initialEnviron: undefined,
      parentEnviron: undefined,
    })
    expect(outside).toEqual(['https://example.invalid/x'])
    expect(report).toMatchObject({
      passedThrough: 1,
      sawKey: true,
      keyInArgv: false,
      sentinelInEnv: true,
      billableRequests: 0,
      initialEnviron: 'unavailable',
    })
    const text = JSON.stringify(report)
    for (const value of [W_FIXTURE_KEY, W_SENTINEL, '/private/home', 'acceptEdits']) {
      expect(text).not.toContain(value)
    }
  })

  describe('a local W rehearsal: run-exec with the test package as agent', () => {
    let layout: TempLayout
    beforeAll(() => {
      layout = tempLayout(true)
    })
    afterAll(() => {
      layout.cleanup()
    })

    it.each<Scenario>(['review', 'text', 'image', 'low-budget'])(
      'W-%s passes the action-check checker',
      async (scenario) => {
        const run = await preparedRun(layout, {
          mode: scenario === 'text' || scenario === 'image' ? 'fix' : 'review',
          repo: wRepo(layout),
          inputs: scenarioInputs(scenario),
        })
        const outputs = path.join(run.paths.invocation, 'github-output')
        writeFileSync(outputs, '')
        const step = await runStep({
          PATH: process.env['PATH'],
          SystemRoot: process.env['SystemRoot'],
          LANG: 'C.UTF-8',
          MUSE_SPARK_MODEL_API_KEY: W_FIXTURE_KEY,
          GITHUB_TOKEN: W_SENTINEL,
          GH_TOKEN: W_SENTINEL,
          MUSE_INVOCATION: run.paths.invocation,
          MUSE_CHECKOUT: run.paths.checkout,
          MUSE_NODE: run.input.node,
          MUSE_GIT: run.input.git,
          MUSE_AGENT_JS: LAUNCHER,
          RUNNER_TEMP: layout.runnerTemp,
          GITHUB_WORKSPACE: layout.workspace,
          GITHUB_OUTPUT: outputs,
          GITHUB_RUN_ID: '4242',
          GITHUB_RUN_ATTEMPT: '1',
        })
        expect(step.stderr).not.toContain(W_FIXTURE_KEY)
        const values = readOutputs(outputs)
        const judged = {
          W_SCENARIO: scenario,
          W_OUT_DIR: values['out-dir'] ?? '',
          W_STATUS: values['status'] ?? '',
          W_EXIT_CODE: values['exit-code'] ?? '',
          W_PATCH_PATH: values['patch-path'] ?? '',
          W_PATCH_WITHHELD: values['patch-withheld'] ?? '',
          W_REQUESTS: values['requests'] ?? '',
          W_COST: values['cost-usd'] ?? '',
          W_IMAGES: values['images'] ?? '',
          W_IMAGE_ATTEMPTS: values['image-attempts'] ?? '',
          W_CHECKOUT: run.paths.checkout,
        }
        const verdict = checker(judged)
        expect(verdict.status, `${verdict.stdout}${verdict.stderr}${step.stderr}`).toBe(0)
        expect(step.code).toBe(scenario === 'low-budget' ? 5 : 0)
        // The checker can fail: one doctored output is enough.
        const doctored = checker({ ...judged, W_REQUESTS: '9' })
        expect(doctored.status).toBe(1)
        expect(doctored.stderr).toContain('requests is 9')
      },
    )
  })
})
