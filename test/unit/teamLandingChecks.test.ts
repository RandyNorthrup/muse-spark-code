// The person's check commands over a team landing (CC-WINLAND): the real landing hands the merged
// copy to the real process ports, whose governed check slots take a snapshot of it under the
// window's real governor and run each command in a real process. Real git, real processes, the
// native lifetime with its Windows job. The runner is the product's own, not a test's.
import { mkdtemp, readdir, readFile, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { ProcessTeamPorts } from '../../src/host/team/teamProcessWorkers'
import type { CheckCommandSetting } from '../../src/shared/constants'
import { EN } from '../../src/shared/l10n/en'
import { setUiText } from '../../src/shared/l10n/text'
import { governorWindow } from './helpers/governorWindow'
import { realCheckPorts, doesSystemProveEnds } from './helpers/teamCheckPorts'
import {
  landingStatuses,
  landingTask,
  makeLandingFixture,
  productLandingPorts,
  type LandingFixture,
} from './helpers/teamLandingFixture'
import { liveSamplerSuite } from './resourceHarness'

setUiText(EN, 'en')
const { memoryReader } = liveSamplerSuite()

/**
A check: logs where it ran and what it read, and exits 3 on reading what it refuses. Trimmed: a
person's `core.autocrlf` checks the copy out with their own line endings.
*/
const VERDICT_SCRIPT = String.raw`const fs = require('node:fs')
const path = require('node:path')
const [name, refused] = process.argv.slice(2)
const read = fs.readFileSync(name, 'utf8').trim()
fs.appendFileSync(path.join(__dirname, 'ran.log'), JSON.stringify({ cwd: process.cwd(), read }) + '\n')
process.exit(read === refused ? 3 : 0)
`
const BATCH = ['a.txt', 'b.txt']

describe("the person's check commands over a team landing", () => {
  const state: {
    root?: string
    script?: string
    fixture?: LandingFixture
    ports?: ProcessTeamPorts
    checks: readonly CheckCommandSetting[]
    dispose?: () => void
  } = { checks: [] }

  const rig = () => {
    const { root, script, fixture, ports } = state
    if (root === undefined || script === undefined || fixture === undefined || ports === undefined)
      throw new Error('the rig did not start')
    return { root, script, fixture, ports }
  }
  /** A check that refuses `refused` in a.txt: passes on a copy that does not hold it. */
  const refusing = (name: string, refused: string): CheckCommandSetting => ({
    name,
    command: `node '${rig().script}' a.txt ${refused}`,
  })

  beforeAll(async () => {
    const governor = await governorWindow({ isLimited: false, memoryReader })
    state.dispose = governor.dispose
    state.root = await realpath(await mkdtemp(path.join(tmpdir(), 'muse-landing-checks-')))
    state.script = path.join(state.root, 'verdict.js')
    await writeFile(state.script, VERDICT_SCRIPT)
    state.fixture = await makeLandingFixture('task-checked', 'asCreated', BATCH)
    const { root: repo } = state.fixture
    state.ports = realCheckPorts({ root: state.root, repo, checks: () => state.checks })
  }, 180_000)

  afterAll(async () => {
    await state.ports?.dispose()
    state.dispose?.()
    await state.fixture?.dispose()
    if (state.root !== undefined)
      await rm(state.root, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 })
  }, 120_000)

  const land = async (fixture: LandingFixture, ports: ProcessTeamPorts) => {
    const task = landingTask(fixture)
    return await productLandingPorts(fixture, {
      checks: () => ({
        commands: state.checks.map(({ name, command }) => ({ name, command, timeoutSeconds: 0 })),
        platform: process.platform,
        setupCommand: '',
        cacheKey: '',
      }),
      runChecks: async (folder, signal) => await ports.runLandingChecks(folder, signal),
    }).merges.merge(
      { ...task, outcome: { ...task.outcome, folder: await realpath(fixture.workerCopy) } },
      new AbortController().signal,
      { allowProtected: false },
    )
  }

  it('a check that fails on the merged copy stops the landing and is named', async () => {
    const { fixture, ports } = rig()
    state.checks = [refusing('passes', 'nothing'), refusing('fails', 'after')]
    expect(await land(fixture, ports)).toMatchObject({
      status: 'rework',
      written: [],
      refusal: { kind: 'checks', check: 'fails' },
    })
    // Each ran, in a copy of the merged result and not in the person's tree.
    const log = await readFile(path.join(rig().root, 'ran.log'), 'utf8')
    const ran = log
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line) as { cwd: string; read: string })
    expect(ran.map((entry) => entry.read)).toEqual(['after', 'after'])
    const person = await realpath(fixture.root)
    for (const entry of ran) expect(entry.cwd).not.toBe(person)
    for (const file of BATCH)
      expect(await readFile(path.join(fixture.root, file), 'utf8')).toBe('before\n')
    expect(await landingStatuses(fixture.storage)).toEqual([])
  }, 180_000)

  it('checks that pass on the merged copy let the landing go on', async () => {
    const { fixture, ports } = rig()
    // Refuses what stands in the person's tree: passes only because it reads the merged copy.
    state.checks = [refusing('merged', 'before')]
    expect(await land(fixture, ports)).toMatchObject({ status: 'merged' })
    for (const file of BATCH)
      expect(await readFile(path.join(fixture.root, file), 'utf8')).toBe('after\n')
    expect(await landingStatuses(fixture.storage)).toEqual(['landed'])
    // Where no container proves an end, a landing's folder was its own and is gone with it.
    const made = await readdir(path.join(rig().root, 'ports'))
    expect(made.includes('check-slots')).toBe(await doesSystemProveEnds())
    expect(
      made.includes('one-use-checks')
        ? await readdir(path.join(rig().root, 'ports', 'one-use-checks'))
        : [],
    ).toEqual([])
  }, 180_000)
})
