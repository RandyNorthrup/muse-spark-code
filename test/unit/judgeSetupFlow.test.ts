// M125 lane W (D107 §8.1): the setup flow. Plans refuse honestly
// (the shipped table fits nothing: no verified timings, no pinned
// archives); the run proves every phase and failure against fake
// ports, and the extractor proves against real tar output.
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { gzipSync } from 'node:zlib'
import { beforeEach, describe, expect, it } from 'vitest'
import { CALIBRATION_FAMILIES } from '../../src/core/judge/calibration/schema'
import {
  JUDGE_SMOKE_QUESTIONS,
  extractTarGzip,
  planJudgeSetup,
  registryBlobUrl,
  registryManifestUrl,
  runJudgeSetupFlow,
  type JudgeSetupFlowPorts,
  type JudgeSetupPlan,
  type JudgeSetupProgress,
} from '../../src/core/judge/setup/flow'
import type { JudgeSetupRecord } from '../../src/core/judge/setup/register'
import { loadJudgeModelsTable } from '../../src/core/judge/setup/table'
import type { JudgeModelRow, JudgeModelsTable } from '../../src/shared/judgeModels/schema'
import { EN } from '../../src/shared/l10n/en'
import { setUiText } from '../../src/shared/l10n/text'
import { descriptorByName } from './helpers/judgeHardware/descriptors'

const GIB = 1024 * 1024 * 1024
const DIGEST = 'ab'.repeat(32)
const BLOB_A = '11'.repeat(32)
const BLOB_B = '22'.repeat(32)
const TODAY = '2026-10-22'
const FIXTURES = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'fixtures')
const SHIPPED = path.join(FIXTURES, '..', '..', 'src', 'shared', 'judgeModels.json')

function row(model: string, overrides: Partial<JudgeModelRow> = {}): JudgeModelRow {
  return {
    model,
    technique: 'systemone',
    quantization: 'Q8_0',
    digest: DIGEST,
    downloadBytes: 4_500_000_000,
    residentBytesCpu: 5 * GIB,
    residentBytesGpu: 5 * GIB,
    accuracy: { correct: 39, total: 40, source: 'test' },
    latency: [
      {
        backend: 'cpu',
        platform: 'linux',
        p50Ms: 200,
        p95Ms: 300,
        path: 'verified',
        source: 'test',
      },
    ],
    profiledFamilies: [],
    source: 'test',
    checkDate: '2026-10-22',
    ...overrides,
  }
}

function table(
  rows: JudgeModelRow[],
  archives: JudgeModelsTable['runtime']['archives'] = [],
): JudgeModelsTable {
  return {
    version: 1,
    checkedDate: TODAY,
    runtime: { version: '0.35.1', minimum: '0.35.1', archives },
    rows,
  }
}

const ARCHIVE = {
  platform: 'linux' as const,
  backend: 'cpu' as const,
  url: 'https://test.invalid/ollama.tgz',
  sha256: '33'.repeat(32),
}

const MANIFEST = JSON.stringify({
  schemaVersion: 2,
  config: { digest: `sha256:${BLOB_A}`, size: 100 },
  layers: [{ digest: `sha256:${BLOB_B}`, size: 200 }],
})

interface FakeWorld {
  readonly ports: JudgeSetupFlowPorts
  readonly files: Map<string, Uint8Array>
  readonly phases: JudgeSetupProgress[]
  readonly fetched: string[]
  stopped: boolean
}

function fakeWorld(overrides: Partial<JudgeSetupFlowPorts> = {}): FakeWorld {
  const files = new Map<string, Uint8Array>()
  const phases: JudgeSetupProgress[] = []
  const fetched: string[] = []
  const world: FakeWorld = {
    files,
    phases,
    fetched,
    stopped: false,
    ports: {
      fetchText: (url) => {
        fetched.push(url)
        return Promise.resolve(MANIFEST)
      },
      fetchBlob: (url) => {
        fetched.push(url)
        return Promise.resolve('ok' as const)
      },
      presentSizes: () => Promise.resolve(new Map()),
      mkdir: () => Promise.resolve(),
      writeFile: (file, bytes) => {
        files.set(file, bytes)
        return Promise.resolve()
      },
      readFile: (file) => Promise.resolve(files.get(file)),
      findFreePort: () => Promise.resolve(11_434),
      runtimeFree: () => Promise.resolve(true),
      startRuntime: () => ({
        pid: 4242,
        port: 11_434,
        stop: () => {
          world.stopped = true
          return Promise.resolve()
        },
      }),
      waitForVersion: () => Promise.resolve(true),
      readRegistration: (file) => {
        const bytes = files.get(file)
        return bytes === undefined
          ? undefined
          : (JSON.parse(Buffer.from(bytes).toString('utf8')) as JudgeSetupRecord)
      },
      writeRegistration: (file, record) => {
        files.set(file, Buffer.from(JSON.stringify(record), 'utf8'))
      },
      askSmoke: (questions) =>
        Promise.resolve(questions.map(() => ({ correct: true, latencyMs: 100 }))),
      ...overrides,
    },
  }
  return world
}

const summary = () => descriptorByName('noGpu16GB')

function planned(): JudgeSetupPlan {
  const settled = planJudgeSetup(summary(), table([row('tev1:4b')], [ARCHIVE]), {})
  if (!settled.ok) throw new Error(`test plan refused: ${settled.reason}`)
  return settled.plan
}

const STORAGE_ROOT = path.join(path.sep, 'test', 'root')

const runOptions = (world: FakeWorld, plan: JudgeSetupPlan) => ({
  plan,
  paths: { storageRoot: STORAGE_ROOT, tableFile: path.join(STORAGE_ROOT, 'table.json') },
  ports: world.ports,
  join: (...parts: string[]) => path.join(...parts),
  onProgress: (progress: JudgeSetupProgress) => {
    world.phases.push(progress)
  },
  signal: new AbortController().signal,
  nowIso: () => '2026-10-23T00:00:00.000Z',
})

/** The archive the fetch port never wrote: every run past fetch needs it. */
function seedArchive(world: FakeWorld): void {
  const tgz = readFileSync(path.join(FIXTURES, 'judgeSetup', 'runtime.tgz'))
  world.files.set(path.join(STORAGE_ROOT, 'judge', 'runtime', '0.35.1', 'runtime.tgz'), tgz)
}

const hostileTar = (name: string): Uint8Array => {
  const header = Buffer.alloc(512)
  header.write(name, 0, 'utf8')
  header.write('0000003', 124, 'utf8')
  header[156] = '0'.codePointAt(0) ?? 0
  const body = Buffer.concat([Buffer.from('xxx'), Buffer.alloc(509)])
  const zero = Buffer.alloc(512)
  return gzipSync(Buffer.concat([header, body, zero]))
}

describe('setup flow', () => {
  beforeEach(() => {
    setUiText(EN, 'en')
  })

  it('fits nothing from the shipped table: no verified timings, no archives', () => {
    const loaded = loadJudgeModelsTable(SHIPPED, TODAY)
    expect(loaded.table?.runtime.archives).toEqual([])
    const settled = planJudgeSetup(summary(), loaded.table, {})
    expect(settled).toEqual({ ok: false, reason: 'fits-nothing' })
  })

  it('plans the verified pick with its pin, digest and row', () => {
    const settled = planJudgeSetup(summary(), table([row('tev1:4b')], [ARCHIVE]), {})
    if (!settled.ok) throw new Error(`refused: ${settled.reason}`)
    expect(settled.plan.row.model).toBe('tev1:4b')
    expect(settled.plan.row.digest).toBe(DIGEST)
    expect(settled.plan.archive).toEqual({ url: ARCHIVE.url, sha256: ARCHIVE.sha256 })
    expect(settled.plan.runtimeVersion).toBe('0.35.1')
  })

  it('refuses an Advanced model that fits nothing, and an unlisted one', () => {
    const tables = table([row('tev1:4b')], [ARCHIVE])
    expect(planJudgeSetup(summary(), tables, { model: 'tev1:4b' }).ok).toBe(true)
    expect(planJudgeSetup(summary(), tables, { model: 'qwen3:8b' })).toEqual({
      ok: false,
      reason: 'model-unlisted',
    })
    const listed = table(
      [row('tev1:4b'), row('big:70b', { latency: [], residentBytesCpu: 80 * GIB })],
      [ARCHIVE],
    )
    expect(planJudgeSetup(summary(), listed, { model: 'big:70b' })).toEqual({
      ok: false,
      reason: 'unknown-model',
    })
  })

  it('refuses a digest-less row instead of registering it', () => {
    // The loader drops duplicate names, but the plan guards its seam:
    // the first row under the pick's name carries no digest.
    const tables = table(
      [row('tev1:4b', { digest: undefined, latency: [] }), row('tev1:4b')],
      [ARCHIVE],
    )
    expect(planJudgeSetup(summary(), tables, {})).toEqual({ ok: false, reason: 'no-digest' })
  })

  it('runs the full install: fetch, place, register, start, smoke, stop', async () => {
    const world = fakeWorld()
    seedArchive(world)
    const result = await runJudgeSetupFlow(runOptions(world, planned()))
    if (!result.ok) throw new Error(`failed: ${result.phase}/${result.reason}`)
    expect(result.record).toMatchObject({
      version: 1,
      endpoint: 'http://127.0.0.1:11434',
      model: 'tev1:4b',
      digest: DIGEST,
      contextWindow: 4096,
    })
    expect(result.verdict).toMatchObject({ correct: 10, total: 10, passed: true })
    expect(world.stopped).toBe(true)
    const phases = world.phases.map((progress) => progress.phase)
    expect(phases).toEqual([
      'fetch',
      'verify',
      'fetch',
      'fetch',
      'fetch',
      'install',
      'register',
      'preload',
      'health',
      'smoke',
    ])
    // The model's manifest lands in the server's layout beside its blobs.
    let manifest: string | undefined
    for (const file of world.files.keys()) {
      if (file.replaceAll('\\', '/').endsWith('/manifests/registry.ollama.ai/library/tev1/4b')) {
        manifest = file
        break
      }
    }
    expect(manifest).toBeDefined()
    expect(world.fetched).toContain(registryManifestUrl('tev1:4b'))
    expect(world.fetched).toContain(registryBlobUrl('tev1:4b', BLOB_A))
  })

  it('names every failure with its phase and reason', async () => {
    const fails: {
      readonly ports: Partial<JudgeSetupFlowPorts>
      readonly phase: string
      readonly reason: string
    }[] = [
      {
        ports: { fetchBlob: () => Promise.resolve('hash-mismatch' as const) },
        phase: 'fetch',
        reason: 'hash-mismatch',
      },
      {
        ports: { fetchBlob: () => Promise.resolve('failed' as const) },
        phase: 'fetch',
        reason: 'fetch-failed',
      },
      {
        ports: { fetchText: () => Promise.resolve('not json') },
        phase: 'verify',
        reason: 'manifest-invalid',
      },
      {
        ports: { fetchText: () => Promise.resolve(undefined) },
        phase: 'verify',
        reason: 'fetch-failed',
      },
      {
        ports: { readFile: () => Promise.resolve(new TextEncoder().encode('not a gzip')) },
        phase: 'install',
        reason: 'extract-failed',
      },
      {
        ports: {
          startRuntime: () => {
            throw new Error('spawn failed')
          },
        },
        phase: 'preload',
        reason: 'start-failed',
      },
      {
        ports: { waitForVersion: () => Promise.resolve(false) },
        phase: 'preload',
        reason: 'version-timeout',
      },
      {
        ports: { readRegistration: () => undefined },
        phase: 'health',
        reason: 'unhealthy',
      },
      {
        ports: {
          askSmoke: () => Promise.reject(new Error('wire uncaptured')),
        },
        phase: 'smoke',
        reason: 'ask-unavailable',
      },
      {
        ports: {
          askSmoke: (questions) =>
            Promise.resolve(questions.map(() => ({ correct: false, latencyMs: 1 }))),
        },
        phase: 'smoke',
        reason: 'smoke-failed',
      },
      {
        ports: { runtimeFree: () => Promise.resolve(false) },
        phase: 'fetch',
        reason: 'runtime-busy',
      },
    ]
    for (const [index, failure] of fails.entries()) {
      const world = fakeWorld(failure.ports)
      seedArchive(world)
      const result = await runJudgeSetupFlow(runOptions(world, planned()))
      // The port-thrown failures carry the port's refusal; the rest do not.
      const cause = index === 5 || index === 8 ? { cause: expect.any(Error) } : {}
      expect(result).toEqual({ ok: false, phase: failure.phase, reason: failure.reason, ...cause })
      // Only the runs that started the runtime stop it again.
      expect(world.stopped).toBe(index >= 6 && index <= 9)
    }
  })

  it('stops the runtime even when the smoke fails', async () => {
    const world = fakeWorld({
      askSmoke: (questions) =>
        Promise.resolve(questions.map(() => ({ correct: false, latencyMs: 1 }))),
    })
    seedArchive(world)
    const result = await runJudgeSetupFlow(runOptions(world, planned()))
    expect(result).toEqual({ ok: false, phase: 'smoke', reason: 'smoke-failed' })
    expect(world.stopped).toBe(true)
  })

  it('aborts between blobs and refuses a pre-aborted run', async () => {
    const world = fakeWorld()
    const controller = new AbortController()
    controller.abort()
    const aborted = await runJudgeSetupFlow({
      ...runOptions(world, planned()),
      signal: controller.signal,
    })
    expect(aborted).toEqual({ ok: false, phase: 'fetch', reason: 'aborted' })
  })

  it('extracts real tar output and refuses hostile paths', async () => {
    const files = new Map<string, Uint8Array>()
    const ports = {
      mkdir: () => Promise.resolve(),
      writeFile: (file: string, bytes: Uint8Array) => {
        files.set(file, bytes)
        return Promise.resolve()
      },
    }
    const out = path.join(STORAGE_ROOT, 'out')
    const tgz = readFileSync(path.join(FIXTURES, 'judgeSetup', 'runtime.tgz'))
    const result = await extractTarGzip(tgz, out, 1024 * 1024, ports, (...parts: string[]) =>
      path.join(...parts),
    )
    expect(result).toBe('ok')
    const textOf = (file: string): string =>
      Buffer.from(files.get(path.join(out, file)) ?? new Uint8Array()).toString('utf8')
    expect(textOf(path.join('bin', 'ollama'))).toBe('fake-ollama-binary-bytes')
    expect(textOf(path.join('lib', 'libtest.so'))).toBe('fake-lib-bytes')
  })

  it('refuses hostile, corrupt and oversized archives', async () => {
    const ports = { mkdir: () => Promise.resolve(), writeFile: () => Promise.resolve() }
    const join = (...parts: string[]) => path.join(...parts)
    const out = path.join(STORAGE_ROOT, 'out')
    expect(await extractTarGzip(hostileTar('../evil'), out, 1024 * 1024, ports, join)).toBe(
      'unsafe-path',
    )
    expect(await extractTarGzip(hostileTar('/abs'), out, 1024 * 1024, ports, join)).toBe(
      'unsafe-path',
    )
    expect(
      await extractTarGzip(new TextEncoder().encode('plain text'), out, 1024 * 1024, ports, join),
    ).toBe('invalid')
    const tgz = readFileSync(path.join(FIXTURES, 'judgeSetup', 'runtime.tgz'))
    expect(await extractTarGzip(tgz, out, 8, ports, join)).toBe('too-large')
  })

  it('keeps ten smoke questions, five yes, five no, on known families', () => {
    expect(JUDGE_SMOKE_QUESTIONS).toHaveLength(10)
    expect(new Set(JUDGE_SMOKE_QUESTIONS.map((question) => question.id)).size).toBe(10)
    expect(JUDGE_SMOKE_QUESTIONS.filter((question) => question.expectedYes)).toHaveLength(5)
    for (const question of JUDGE_SMOKE_QUESTIONS) {
      expect(CALIBRATION_FAMILIES).toContain(question.family)
      expect(question.prompt.length).toBeGreaterThan(20)
    }
  })

  it('names registry URLs per model without namespaces', () => {
    expect(registryManifestUrl('tev1:4b')).toBe(
      'https://registry.ollama.ai/v2/library/tev1/manifests/4b',
    )
    expect(registryBlobUrl('tev1:4b', BLOB_A)).toBe(
      `https://registry.ollama.ai/v2/library/tev1/blobs/sha256:${BLOB_A}`,
    )
    expect(registryManifestUrl('someone/tev1:4b')).toBe(
      'https://registry.ollama.ai/v2/library/tev1/manifests/4b',
    )
  })
})
