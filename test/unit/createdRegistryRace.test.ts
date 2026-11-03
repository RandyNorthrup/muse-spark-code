// Two app instances starting at the same moment must share the
// created-resources registry: one failed session/new with `Command failed:
// powershell.exe ... [MuseSparkCreated]::Execute('publish', ...)` when lanes
// RLSCHED and RLFINISH started together (2026-10-22 00:52, published 0.19.0).
// The losing compare-and-swap ended the session, and a winning save dropped
// whatever the other process had written. Two real processes meet at the
// same instant here through the product's own native file commands on every
// platform; every created entry must survive in the live manifest and no
// save may fail. The driver (test/hosts/created-registry-race.mjs) is a
// plain node script, so the lead can also run it by hand on any machine.
import { mkdir, readFile, rename } from 'node:fs/promises'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { lstatIdentity } from '../../src/core/fs/fileIdentity'
import { CreatedRegistry } from '../../src/core/resources/createdRegistry'
import { CREATED_REGISTRY_SAVE_ATTEMPTS } from '../../src/shared/constants'
import { isCreatedRegistrySaveError } from '../../src/shared/createdRegistrySaveError'
import { runDriverScript } from './helpers/spawnDriver'
import {
  createdChildFixture,
  createdChildSession,
  type CreatedChildFixture,
} from './helpers/resources/createdChild'
import { createdRegistryProof } from './helpers/resources/registryProof'

const scratch: { fixture?: CreatedChildFixture | undefined } = {}
const PROCESSES = 2
const ROUNDS = 2
const CREATES = 2

beforeAll(async () => {
  scratch.fixture = await createdChildFixture(
    'created-registry-race-',
    'createdRegistryRace.cjs',
    'test/unit/createdRegistryRaceEntry.ts',
    'created-race-jobs-',
  )
})

afterAll(async () => {
  await scratch.fixture?.dispose()
  scratch.fixture = undefined
})

function fixture(): CreatedChildFixture {
  if (scratch.fixture === undefined) throw new Error('the race fixture was not prepared')
  return scratch.fixture
}

interface Summary {
  readonly processes: number
  readonly rounds: number
  readonly creates: number
  readonly created: number
  readonly failures: readonly string[]
  readonly missing: readonly string[]
  readonly crashed: number
}

describe('the created registry under a race (RLWINFIX2 item 1)', () => {
  it('shares the manifest between two processes started together, losing nothing', async () => {
    const { code, output } = await runDriverScript(
      path.resolve('test/hosts/created-registry-race.mjs'),
      [
        fixture().bundle,
        path.join(fixture().folder, 'work'),
        fixture().storage,
        path.resolve('.'),
        fixture().nativeRoot,
        String(PROCESSES),
        String(ROUNDS),
        String(CREATES),
      ],
    )
    const summary = JSON.parse(output) as Summary
    expect(summary.crashed).toBe(0)
    expect(summary.failures).toEqual([])
    // Every created entry survives in the live manifest: no lost update.
    expect(summary.missing).toEqual([])
    expect(summary.created).toBe(PROCESSES * ROUNDS * CREATES)
    expect(code).toBe(0)
    // Two processes times two rounds of native compare-and-swap publishes
    // takes seconds, not milliseconds: the timeout covers the genuinely
    // long race, nothing else.
  }, 120_000)
})

/**
Two real registries on one manifest, with the real native publish. `between` runs after the
first registry's real sample and before its open, the moment the race above can only hit by
chance (seen on Linux: `unsafe`, caused by `Creation manifest identity changed`).
*/
async function raced(
  name: string,
  between: (other: CreatedRegistry, file: string) => Promise<void>,
) {
  const base = path.join(fixture().folder, name)
  await mkdir(base, { recursive: true, mode: 0o700 })
  const plan = {
    manifest: path.join(base, 'registry.json'),
    base: path.join(base, 'trees'),
    storageDir: fixture().storage,
    packageRoot: path.resolve('.'),
    nativeRoot: fixture().nativeRoot,
  }
  const session = createdChildSession(plan)
  const proof = createdRegistryProof(session.commands, () => plan.storageDir)
  const other = await CreatedRegistry.open(plan.manifest, Date.now, proof, plan.base)
  // The manifest has to be there for a publish to replace it.
  const { id: first } = await other.createTemp('other')
  const state = { samples: 0, isArmed: false }
  const registry = await CreatedRegistry.open(
    plan.manifest,
    Date.now,
    proof,
    plan.base,
    async (file) => {
      const sample = await lstatIdentity(file)
      if (state.isArmed) {
        state.samples += 1
        await between(other, file)
      }
      return sample
    },
  )
  return {
    state,
    first,
    other,
    create: async () => {
      state.isArmed = true
      try {
        return await registry.createTemp('mine')
      } finally {
        state.isArmed = false
      }
    },
    ids: async () =>
      (JSON.parse(await readFile(plan.manifest, 'utf8')) as { readonly id: string }[]).map(
        (entry) => entry.id,
      ),
    dispose: session.dispose,
  }
}

/** The reason a save failed with. */
async function reasonOf(action: () => Promise<unknown>): Promise<string> {
  try {
    await action()
  } catch (error: unknown) {
    if (isCreatedRegistrySaveError(error)) return error.reason
    throw error
  }
  throw new Error('the save should have failed')
}

describe('a publish landing between the sample and the open', () => {
  it('is a lost race: the save merges and publishes, and both entries survive', async () => {
    const landed: string[] = []
    const rig = await raced('lost-once', async (other) => {
      if (landed.length > 0) return
      const { id } = await other.createTemp('other')
      landed.push(id)
    })
    try {
      const { id } = await rig.create()
      expect(rig.state.samples).toBeGreaterThan(1)
      expect(await rig.ids()).toEqual(expect.arrayContaining([rig.first, ...landed, id]))
    } finally {
      rig.dispose()
    }
  }, 60_000)

  it('says contended, not unsafe, after the bound when every read loses', async () => {
    const rig = await raced('lost-always', async (other) => {
      await other.createTemp('other')
    })
    try {
      await expect(reasonOf(rig.create)).resolves.toBe('contended')
      expect(rig.state.samples).toBe(CREATED_REGISTRY_SAVE_ATTEMPTS)
    } finally {
      rig.dispose()
    }
  }, 60_000)

  it('stays unsafe when what landed there is no file, and does not retry', async () => {
    const rig = await raced('not-a-file', async (_other, file) => {
      await rename(file, `${file}.aside`)
      await mkdir(file)
    })
    try {
      await expect(reasonOf(rig.create)).resolves.toBe('unsafe')
      expect(rig.state.samples).toBe(1)
    } finally {
      rig.dispose()
    }
  }, 60_000)
})
