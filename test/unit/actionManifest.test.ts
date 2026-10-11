// M80 lane C: the composite manifests (SPEC §6.1, §6.6; G17). Startup hooks
// are cleared in every step; the key reaches only the run step and the token
// only the gate, checkout and post steps; Node and Git are resolved and the
// agent installed before any checkout; each run body directly execs the
// trusted Node on an action-root script with no workflow expression and no
// bash -c; the gate conditions every later step; pins match the repository's
// workflows; the apply sub-action's inputs, outputs and steps are as specified.
// The manifests are read with a strict reader for the YAML subset they use,
// which fails on anything outside it.

import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { ACTION_DIR, byText, REPO_ROOT } from './helpers/actionFixtures'

type Yaml = string | Yaml[] | { [key: string]: Yaml }
interface Line {
  indent: number
  text: string
}
interface Step {
  id: string
  uses: string | undefined
  run: string | undefined
  shell: string | undefined
  condition: string | undefined
  env: Record<string, string>
  with: Record<string, string>
}
interface Manifest {
  inputs: Record<string, Record<string, string>>
  outputs: string[]
  steps: Step[]
}

const KEY = /^([A-Za-z0-9_.-]+):(?: (.*))?$/

function scalar(raw: string): string {
  if (raw.startsWith("'")) {
    const quoted = /^'((?:[^']|'')*)'(?:\s+#.*)?$/.exec(raw)
    if (quoted === null) throw new Error(`unterminated quote: ${raw}`)
    return quoted[1]!.replaceAll("''", "'")
  }
  if (raw.startsWith('"')) return String(JSON.parse(raw))
  if (['|', '>', '&', '*'].some((mark) => raw.startsWith(mark))) {
    throw new Error(`unsupported YAML: ${raw}`)
  }
  const comment = raw.indexOf(' #')
  return (comment === -1 ? raw : raw.slice(0, comment)).trim()
}

/**
 * Block mappings, block sequences of mappings and one-line scalars; nothing
 * else. Workflow fragments may also hold `|` literal blocks (an
 * upload-artifact `path` list); Action manifests never may.
 */
function parseYaml(text: string, { literalBlocks = false } = {}): Yaml {
  const lines: Line[] = text
    .split(/\r?\n/)
    .filter((line) => line.trim() !== '' && !line.trimStart().startsWith('#'))
    .map((line) => ({ indent: line.length - line.trimStart().length, text: line.trim() }))
  let index = 0
  const at = () => lines[index]
  const block = (indent: number): Yaml =>
    at()?.text.startsWith('- ') ? sequence(indent) : mapping(indent)
  function mapping(indent: number): Yaml {
    const result: Record<string, Yaml> = {}
    for (let line = at(); line?.indent === indent && !line.text.startsWith('- '); line = at()) {
      const match = KEY.exec(line.text)
      if (match === null) throw new Error(`not a key: ${line.text}`)
      const key = match[1]!
      if (Object.hasOwn(result, key)) throw new Error(`duplicate key: ${key}`)
      index += 1
      const next = at()
      const isNested = next !== undefined && next.indent > indent
      if (literalBlocks && match[2] === '|') {
        if (!isNested) throw new Error(`empty literal block: ${key}`)
        const body: string[] = []
        for (let item = at(); item !== undefined && item.indent > indent; item = at()) {
          if (item.indent < next.indent) throw new Error(`bad indent: ${item.text}`)
          body.push(' '.repeat(item.indent - next.indent) + item.text)
          index += 1
        }
        result[key] = `${body.join('\n')}\n`
        continue
      }
      result[key] = match[2] === undefined ? (isNested ? block(next.indent) : '') : scalar(match[2])
    }
    const stray = at()
    if (stray !== undefined && stray.indent > indent) throw new Error(`bad indent: ${stray.text}`)
    return result
  }
  function sequence(indent: number): Yaml {
    const items: Yaml[] = []
    for (let line = at(); line?.indent === indent && line.text.startsWith('- '); line = at()) {
      lines[index] = { indent: indent + 2, text: line.text.slice(2) }
      items.push(block(indent + 2))
    }
    return items
  }
  const parsed = block(0)
  if (index === lines.length) return parsed
  throw new Error(`unparsed: ${at()?.text ?? ''}`)
}

function record(value: Yaml | undefined): Record<string, Yaml> {
  if (value === undefined) return {}
  if (typeof value !== 'object' || Array.isArray(value)) throw new Error('expected a mapping')
  return value
}

function strings(value: Yaml | undefined): Record<string, string> {
  return Object.fromEntries(
    Object.entries(record(value)).map(([key, item]) => {
      if (typeof item !== 'string') throw new Error(`expected a scalar at ${key}`)
      return [key, item]
    }),
  )
}

function optional(value: Yaml | undefined): string | undefined {
  if (value !== undefined && typeof value !== 'string') throw new Error('expected a scalar')
  return value
}

function readManifest(...parts: string[]): Manifest {
  const root = record(parseYaml(readFileSync(path.join(...parts), 'utf8')))
  const list = record(root['runs'])['steps']
  if (!Array.isArray(list)) throw new Error('expected steps')
  return {
    inputs: Object.fromEntries(
      Object.entries(record(root['inputs'])).map(([name, spec]) => [name, strings(spec)]),
    ),
    outputs: Object.keys(record(root['outputs'])),
    steps: list.map((item) => {
      const fields = record(item)
      const uses = optional(fields['uses'])
      return {
        id: optional(fields['id']) ?? (uses ?? '').split('@', 1)[0] ?? '',
        uses,
        run: optional(fields['run']),
        shell: optional(fields['shell']),
        condition: optional(fields['if']),
        env: strings(fields['env']),
        with: strings(fields['with']),
      }
    }),
  }
}

const HOOKS = ['BASH_ENV', 'ENV', 'SHELLOPTS', 'BASHOPTS', 'PS4', 'NODE_OPTIONS', 'NODE_PATH']
const ALLOWED = "steps.gate.outputs.allowed == 'true'"
const main = readManifest(ACTION_DIR, 'action.yml')
const apply = readManifest(ACTION_DIR, 'apply', 'action.yml')
const build = readFileSync(path.join(REPO_ROOT, '.github', 'workflows', 'build.yml'), 'utf8')

function step(manifest: Manifest, id: string): Step {
  const found = manifest.steps.find((item) => item.id === id)
  if (found === undefined) throw new Error(`no step ${id}`)
  return found
}

describe('the main manifest (G17)', () => {
  it('declares the specified inputs, defaults and outputs', () => {
    const defaults: Record<string, string> = {
      mode: 'review',
      'image-generation': 'false',
      'max-requests': '30',
      'timeout-minutes': '20',
      model: '',
      effort: '',
      'allow-contributor-models': 'false',
      'max-diff-bytes': '262144',
      'trigger-phrase': '@muse-spark',
      'pr-number': '',
      'extra-instructions': '',
      path: '.',
      'post-comment': 'true',
      'upload-artifacts': 'true',
      'github-token': '${{ github.token }}',
      'https-proxy': '',
      'no-proxy': '',
      'extra-ca-certs': '',
      'agent-package': '',
      'agent-package-sha256': '',
    }
    expect(Object.keys(main.inputs).toSorted(byText)).toEqual(
      [...Object.keys(defaults), 'model-api-key', 'max-budget-usd'].toSorted(byText),
    )
    for (const [name, value] of Object.entries(defaults)) {
      expect(main.inputs[name]?.['default'], name).toBe(value)
    }
    for (const name of ['model-api-key', 'max-budget-usd']) {
      expect(main.inputs[name]?.['required'], name).toBe('true')
    }
    expect(main.outputs.toSorted(byText)).toEqual(
      [
        'status',
        'exit-code',
        'out-dir',
        'result-path',
        'events-path',
        'patch-path',
        'patch-withheld',
        'artifact-name',
        'requests',
        'cost-usd',
        'cost-is-upper-bound',
        'images',
        'image-attempts',
        'images-uncertain',
        'paid-uncertain-usd',
        'diff-truncated',
      ].toSorted(byText),
    )
  })

  it('orders the steps: tools before the gate, install before checkout, upload/post/tidy last', () => {
    expect(main.steps.map((item) => item.id)).toEqual([
      'actions/setup-node',
      'tools',
      'gate',
      'install',
      'checkout',
      'inputs',
      'run',
      'upload',
      'post',
      'tidy',
    ])
    expect(main.steps[0]?.with).toEqual({ 'node-version': '22', 'package-manager-cache': 'false' })
  })

  it('clears every startup hook in every step of both manifests', () => {
    for (const item of [...main.steps, ...apply.steps]) {
      for (const hook of HOOKS) expect(item.env[hook], `${item.id} ${hook}`).toBe('')
    }
  })

  it('gives the key only to the run step and the token only to gate, checkout and post', () => {
    for (const item of main.steps) {
      const values = Object.values(item.env)
      expect(
        values.some((value) => value.includes('inputs.model-api-key')),
        item.id,
      ).toBe(item.id === 'run')
      expect(
        values.some((value) => value.includes('inputs.github-token')),
        item.id,
      ).toBe(['gate', 'checkout', 'post'].includes(item.id))
      expect(JSON.stringify(item.with), item.id).not.toMatch(/model-api-key|github-token/)
    }
    expect(step(main, 'run').env['MUSE_SPARK_MODEL_API_KEY']).toBe('${{ inputs.model-api-key }}')
  })

  it('runs each script by direct exec of the trusted Node, with no expression and no bash -c', () => {
    const bodies: Record<string, string> = {
      tools: 'exec node "$GITHUB_ACTION_PATH/lib/tools.mjs"',
      gate: 'exec "$MUSE_NODE" "$GITHUB_ACTION_PATH/lib/gate-cli.mjs"',
      install: 'exec "$MUSE_NODE" "$GITHUB_ACTION_PATH/lib/install.mjs"',
      checkout: 'exec "$MUSE_NODE" "$GITHUB_ACTION_PATH/lib/checkout.mjs"',
      inputs: 'exec "$MUSE_NODE" "$GITHUB_ACTION_PATH/lib/inputs.mjs"',
      run: 'exec "$MUSE_NODE" "$GITHUB_ACTION_PATH/lib/run-exec.mjs"',
      post: 'exec "$MUSE_NODE" "$GITHUB_ACTION_PATH/lib/post.mjs"',
      tidy: 'exec "$MUSE_NODE" "$GITHUB_ACTION_PATH/lib/tools.mjs" tidy',
    }
    const scripted = main.steps.filter((item) => item.run !== undefined)
    expect(scripted.map((item) => item.id)).toEqual(Object.keys(bodies))
    for (const item of scripted) {
      expect(item.run, item.id).toBe(bodies[item.id])
      expect(item.shell, item.id).toBe('bash')
      if (item.id !== 'tools') {
        expect(item.env['MUSE_NODE'], item.id).toBe('${{ steps.tools.outputs.node }}')
      }
    }
    for (const body of Object.values(bodies)) {
      const script = /lib\/([\w-]+\.mjs)/.exec(body)?.[1] ?? ''
      expect(existsSync(path.join(ACTION_DIR, 'lib', script)), script).toBe(true)
    }
  })

  it('conditions every later step on the gate', () => {
    for (const id of ['install', 'checkout', 'inputs', 'run']) {
      expect(step(main, id).condition, id).toBe(ALLOWED)
    }
    expect(step(main, 'gate').condition).toBeUndefined()
    expect(step(main, 'upload').condition).toBe(
      `always() && ${ALLOWED} && inputs.upload-artifacts == 'true' && steps.run.outputs.status != '' && steps.run.outputs.status != 'unknown' && steps.run.outputs.status != 'cancelled'`,
    )
    expect(step(main, 'post').condition).toBe(
      `${ALLOWED} && steps.run.outputs.status == 'completed' && inputs.post-comment == 'true'`,
    )
    expect(step(main, 'tidy').condition).toBe("always() && steps.tools.outputs.invocation != ''")
  })

  it('pins every action to the commit the repository workflows use', () => {
    const pinned = [...main.steps, ...apply.steps].filter((entry) => entry.uses !== undefined)
    for (const item of pinned) {
      const uses = item.uses ?? ''
      expect(uses).toMatch(/^actions\/(setup-node|upload-artifact|download-artifact)@[0-9a-f]{40}$/)
      expect(build, uses).toContain(`uses: ${uses}`)
    }
  })
})

describe('the apply manifest (G17)', () => {
  it('declares its inputs, outputs and steps, with no key and no proposal script', () => {
    expect(Object.keys(apply.inputs).toSorted(byText)).toEqual([
      'artifact-name',
      'github-token',
      'mode',
      'path',
    ])
    expect(apply.inputs['mode']?.['required']).toBe('true')
    expect(apply.inputs['artifact-name']?.['required']).toBe('true')
    expect(apply.inputs['github-token']?.['default']).toBe('${{ github.token }}')
    expect(apply.inputs['path']?.['default']).toBe('.')
    expect(apply.outputs.toSorted(byText)).toEqual(['commit-sha', 'ready'])
    expect(apply.steps.map((item) => item.id)).toEqual([
      'actions/setup-node',
      'tools',
      'download',
      'apply',
      'tidy',
    ])
    expect(step(apply, 'tools').env['MUSE_TOOLS_ROLE']).toBe('apply')
    expect(step(apply, 'tools').run).toBe('exec node "$GITHUB_ACTION_PATH/../lib/tools.mjs"')
    expect(step(apply, 'apply').run).toBe('exec "$MUSE_NODE" "$GITHUB_ACTION_PATH/lib/apply.mjs"')
    expect(step(apply, 'tidy').run).toBe(
      'exec "$MUSE_NODE" "$GITHUB_ACTION_PATH/../lib/tools.mjs" tidy',
    )
    expect(step(apply, 'download').with).toEqual({
      name: '${{ inputs.artifact-name }}',
      path: '${{ steps.tools.outputs.download }}',
    })
    expect(JSON.stringify(apply)).not.toMatch(
      /model-api-key|MODEL_API_KEY|run-exec|install\.mjs|npm/,
    )
    expect(existsSync(path.join(ACTION_DIR, 'apply', 'lib', 'apply.mjs'))).toBe(true)
  })

  it('reads the YAML subset strictly', () => {
    expect(() => parseYaml('a: |\n  b\n')).toThrow(/unsupported/)
    expect(() => parseYaml('a: >\n  b\n', { literalBlocks: true })).toThrow(/unsupported/)
    expect(() => parseYaml('a: |\nb: c\n', { literalBlocks: true })).toThrow(/empty literal/)
    expect(() => parseYaml('a: |\n    b\n  c\n', { literalBlocks: true })).toThrow(/bad indent/)
    expect(parseYaml('a: |\n  b\n    c\nd: e\n', { literalBlocks: true })).toEqual({
      a: 'b\n  c\n',
      d: 'e',
    })
    expect(() => parseYaml('a: 1\na: 2\n')).toThrow(/duplicate/)
    expect(() => parseYaml("a: 'b\n")).toThrow(/unterminated/)
    expect(() => parseYaml('a: 1\n    b: 2\n')).toThrow(/bad indent/)
    expect(parseYaml("a:\n  - b: 'it''s' # note\n    c: x # y\n")).toEqual({
      a: [{ b: "it's", c: 'x' }],
    })
  })
})

it('builds and downloads every real native helper before packaging the fake-only Action candidate', () => {
  const workflow = readFileSync(path.join(REPO_ROOT, '.github/workflows/action-check.yml'), 'utf8')
  const helper = workflow.split('\n  native-helpers:\n', 2)[1]?.split('\n  package:\n', 1)[0]
  if (helper === undefined) throw new Error('Missing native helper job')
  const matrix = helper.split('        include:\n', 2)[1]?.split('    steps:\n', 1)[0]
  if (matrix === undefined) throw new Error('Missing native helper matrix')
  const entries = record(parseYaml(`include:\n${matrix}`, { literalBlocks: true }))['include']
  if (!Array.isArray(entries)) throw new Error('Missing native helper entries')
  expect(entries.map((entry) => strings(entry))).toEqual([
    {
      platform: 'darwin',
      os: 'macos-latest',
      artifact: 'muse-dictate-darwin',
      // M105: the screen-capture app travels archived, keeping its modes.
      path: 'native/darwin/muse-dictate\nnative/darwin/muse-dictate-screen.tgz\n',
    },
    {
      platform: 'linux-x64',
      os: 'ubuntu-24.04',
      artifact: 'muse-created-linux-x64',
      path: 'native/linux/x64/muse-created',
    },
    {
      platform: 'linux-arm64',
      os: 'ubuntu-24.04-arm',
      artifact: 'muse-created-linux-arm64',
      path: 'native/linux/arm64/muse-created',
    },
  ])
  expect(helper).toContain('bash native/darwin/build.sh')
  expect(helper).toContain('buildLinuxHelper()')
  expect(helper).toContain('if-no-files-found: error')
  const packageJob = workflow.split('\n  package:\n', 2)[1]?.split('\n  w:\n', 1)[0]
  if (packageJob === undefined) throw new Error('Missing candidate package job')
  expect(packageJob).toContain('needs: native-helpers')
  const beforePack = packageJob.split('      - run: npm run package:acp', 1)[0]
  for (const entry of entries) {
    const spec = strings(entry)
    expect(beforePack).toContain(`name: ${spec['artifact'] ?? ''}`)
    const uploaded = (spec['path'] ?? '').trimEnd().split('\n')
    for (const file of uploaded) expect(beforePack).toContain(`path: ${path.posix.dirname(file)}`)
  }
  // M109: the vault helper the packagers require beside the dictation helper.
  expect(helper).toContain('name: muse-vault-darwin')
  expect(beforePack).toContain('name: muse-vault-darwin')
  expect(beforePack).toContain('tar -xzf native/darwin/muse-dictate-screen.tgz -C native/darwin')
  expect(packageJob).toContain('node scripts/package-acp-test.mjs')
})
