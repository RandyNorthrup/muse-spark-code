// M125 lanes H and W (D107 §8.1): the setup suites' one world. A
// verified table row with its pinned runtime archive and the registry
// manifest the flow verifies, and the flow and setup ports over an
// in-memory file map seeded with the committed runtime archive
// (test/fixtures/judgeSetup/runtime.tgz). Every port answers the happy
// path; a suite overrides the one port its case is about.
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import type { JudgeSetupFlowPorts } from '../../../src/core/judge/setup/flow'
import type { JudgeSetupPaths, JudgeSetupPorts } from '../../../src/core/judge/setup/ports'
import type { JudgeSetupRecord } from '../../../src/core/judge/setup/register'
import type { JudgeModelRow, JudgeModelsTable } from '../../../src/shared/judgeModels/schema'
import { descriptorByName } from './judgeHardware/descriptors'

export const GIB = 1024 * 1024 * 1024
export const DIGEST = 'ab'.repeat(32)
export const BLOB_A = '11'.repeat(32)
const BLOB_B = '22'.repeat(32)
export const TODAY = '2026-10-22'
const FIXTURES = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'fixtures')
export const SHIPPED_TABLE = path.join(FIXTURES, '..', '..', 'src', 'shared', 'judgeModels.json')
export const STORAGE_ROOT = path.join(path.sep, 'test', 'root')
export const PATHS: JudgeSetupPaths = {
  storageRoot: STORAGE_ROOT,
  tableFile: path.join(STORAGE_ROOT, 'table.json'),
}

/** The runtime archive pin for linux on the CPU. */
export const ARCHIVE = {
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

/** The committed runtime archive's bytes. */
export const runtimeArchive = (): Buffer =>
  readFileSync(path.join(FIXTURES, 'judgeSetup', 'runtime.tgz'))

/** A digest-pinned row with a verified linux CPU timing (p95 300 ms). */
export function judgeRow(model: string, overrides: Partial<JudgeModelRow> = {}): JudgeModelRow {
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

export function judgeTable(
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

/** The one-row table setup installs from: `tev1:4b` with the archive pin. */
export function installTable(profiledFamilies: readonly string[] = []): JudgeModelsTable {
  return judgeTable([judgeRow('tev1:4b', { profiledFamilies: [...profiledFamilies] })], [ARCHIVE])
}

export interface SetupWorld {
  readonly files: Map<string, Uint8Array>
  /** Every manifest and blob URL the flow fetched, in order. */
  readonly fetched: string[]
  /** The install paths `removeInstall` deleted. */
  readonly removed: string[]
  /** True once the started runtime was stopped. */
  stopped: boolean
  registration: JudgeSetupRecord | undefined
  readonly flow: JudgeSetupFlowPorts
}

/**
The flow ports over an empty file map: every fetch answers, the runtime
starts on 11434 and the smoke answers every question right. The
registration lives on the world.
*/
export function setupWorld(overrides: Partial<JudgeSetupFlowPorts> = {}): SetupWorld {
  const world: SetupWorld = {
    files: new Map(),
    fetched: [],
    removed: [],
    stopped: false,
    registration: undefined,
    flow: {
      fetchText: (url) => {
        world.fetched.push(url)
        return Promise.resolve(MANIFEST)
      },
      fetchBlob: (url) => {
        world.fetched.push(url)
        return Promise.resolve('ok' as const)
      },
      presentSizes: () => Promise.resolve(new Map()),
      mkdir: () => Promise.resolve(),
      writeFile: (file, bytes) => {
        world.files.set(file, bytes)
        return Promise.resolve()
      },
      readFile: (file) => Promise.resolve(world.files.get(file)),
      findFreePort: () => Promise.resolve(11_434),
      runtimeFree: () => Promise.resolve(true),
      startRuntime: () =>
        Promise.resolve({
          pid: 4242,
          port: 11_434,
          stop: () => {
            world.stopped = true
            return Promise.resolve()
          },
        }),
      waitForVersion: () => Promise.resolve(true),
      readRegistration: () => world.registration,
      writeRegistration: (_file, record) => {
        world.registration = record
      },
      askSmoke: (questions) =>
        Promise.resolve(questions.map(() => ({ correct: true, latencyMs: 100 }))),
      ...overrides,
    },
  }
  return world
}

/** The archive the fetch port never writes: every run past fetch needs it. */
export function seedArchive(world: SetupWorld): void {
  world.files.set(
    path.join(STORAGE_ROOT, 'judge', 'runtime', '0.35.1', 'runtime.tgz'),
    runtimeArchive(),
  )
}

/**
The setup ports over a seeded world: the scan reads the 16 GB no-GPU
machine, the table is `installTable()`, and remove deletes the four
install paths and the registration.
*/
export function setupPorts(overrides: Partial<JudgeSetupPorts> = {}): {
  readonly world: SetupWorld
  readonly ports: JudgeSetupPorts
} {
  const world = setupWorld()
  seedArchive(world)
  const ports: JudgeSetupPorts = {
    scan: () => Promise.resolve(descriptorByName('noGpu16GB')),
    loadTable: () => ({ table: installTable(), failures: {} }),
    flow: world.flow,
    readRegistration: () => world.registration,
    removeInstall: (paths) => {
      world.removed.push(paths.runtimeRoot, paths.modelsDir, paths.lock, paths.record)
      world.registration = undefined
      return Promise.resolve({ removed: [...world.removed], missing: [] })
    },
    today: () => '2026-10-22',
    nowIso: () => '2026-10-23T00:00:00.000Z',
    ...overrides,
  }
  return { world, ports }
}
