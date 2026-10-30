// The one team availability rule (PLAN.md D227, owner 2026-10-23): every
// surface offers teams only while the person has at least two usable models
// configured — a lead plus a worker the engine can really dispatch to —
// and the person has not switched teams off. With fewer, every team entry
// point refuses in the translated words; an explicit off opens nothing.
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { beforeAll, describe, expect, it } from 'vitest'
import { isTeamSwitchOn } from '../../src/host/teamHostBinding'
import { ACP_SESSIONS_SUBFOLDER, EXEC_TEAM_STATE_FILE, UI_TEXT } from '../../src/shared/constants'
import {
  TEAM_WORKSPACE_KEYS,
  hasRunnableTeamEntry,
  isTeamAvailable,
} from '../../src/shared/teamConversation'
import {
  checkTeamAvailability,
  isSameTeamModelId,
  teamAvailabilityRefusal,
  type TeamAvailabilityCandidate,
} from '../../src/shared/teamAvailability'
import { isSameTeamModel } from '../../src/core/team/sameModel'
import { TeamContractError, teamSessionAdmission } from '../../src/acp/teamAdmission'
import {
  createExecTeam,
  type ExecTeam,
  type ExecTeamDeps,
} from '../../src/runtime/exec/execTeamEntry'
import { workspaceKey } from '../../src/runtime/dataFolder'
import { Usd } from '../../src/shared/usd'
import { availabilityBindingWithOpenRoles } from './helpers/teamAvailabilityRig'
import { panelRig } from './helpers/teamPanelRig'
import { teamOffers } from './helpers/teamPanelOffers'

const LEAD = 'muse-spark-1.3'
const WORKER = 'other-model'

// The offered headless run loads the lazy team chunks; warm them so no
// test's own budget pays the transform cost (production loads the built
// chunks instead). Hooks run under the hook timeout, not the test timeout.
beforeAll(async () => {
  await import('../../src/host/team/teamHostEntry')
  await import('../../src/core/team/workers/workerOpsEntry')
  await import('../../src/host/team/teamEngineEntry')
})

function candidate(
  modelId: string,
  options: Partial<TeamAvailabilityCandidate> = {},
): TeamAvailabilityCandidate {
  return { modelId, billsKey: false, isAvailable: true, ...options }
}

function check(
  candidates: readonly TeamAvailabilityCandidate[],
  options: { isSwitchedOff?: boolean; teamWorkersOn?: boolean } = {},
) {
  return checkTeamAvailability({
    isSwitchedOff: options.isSwitchedOff ?? false,
    leadModelId: LEAD,
    candidates,
    isSameModel: isSameTeamModel,
    teamWorkersOn: options.teamWorkersOn ?? false,
  })
}

function binding(isTeamOn: boolean) {
  return availabilityBindingWithOpenRoles(isTeamOn)
}

function stored(team: unknown) {
  return { get: (key: string) => (key === TEAM_WORKSPACE_KEYS.team ? team : undefined) }
}

function roleWith(agent: unknown) {
  return { roles: [{ role: 'engineering', pool: [{ id: 'e1', agent }] }] }
}

function admit(
  entries: readonly TeamAvailabilityCandidate[],
  options: { teamSwitchOff?: boolean; teamWorkersOn?: boolean } = {},
) {
  return teamSessionAdmission(
    {
      sessionModelId: LEAD,
      customEntries: entries,
      teamSwitchOff: options.teamSwitchOff ?? false,
      teamWorkersOn: options.teamWorkersOn ?? true,
    },
    isSameTeamModel,
  )
}

async function teamRunFolders() {
  const root = await mkdtemp(path.join(tmpdir(), 'rlf-teamgate-'))
  const dataFolder = path.join(root, 'data')
  const cwd = path.join(root, 'work')
  await mkdir(dataFolder, { recursive: true })
  await mkdir(cwd, { recursive: true })
  return { root, dataFolder, cwd }
}

function teamRunDeps(dataFolder: string, cwd: string): ExecTeamDeps {
  const log = {
    trace: () => undefined,
    info: () => undefined,
    warn: () => undefined,
    error: () => undefined,
  }
  return {
    dataFolder,
    cwd,
    platform: process.platform,
    provider: undefined,
    defaultPays: 'key',
    budgetUsd: Usd.from(1).toAmount(),
    signal: new AbortController().signal,
    now: () => Date.now(),
    log,
    readFile: async (file, maxBytes) => {
      const bytes = await readFile(file)
      return bytes.subarray(0, maxBytes)
    },
    listModels: () => Promise.resolve([LEAD, WORKER]),
    startWorker: () => Promise.reject(new Error('no dispatch in the availability test')),
    onWritten: () => undefined,
    secretLiterals: () => [],
    lowerWorkerCap: () => undefined,
  }
}

async function storedSnapshot(dataFolder: string, cwd: string, snapshot: unknown) {
  const folder = path.join(dataFolder, ACP_SESSIONS_SUBFOLDER, workspaceKey(cwd))
  await mkdir(folder, { recursive: true })
  await writeFile(path.join(folder, EXEC_TEAM_STATE_FILE), JSON.stringify(snapshot), 'utf8')
}

function snapshotWith(agent: unknown) {
  return {
    roles: [
      {
        role: 'engineering',
        workspace: 'own-branch',
        pool: [{ id: 'e1', concurrent: 1, caps: [], agent }],
      },
    ],
    intensity: 'balanced',
  }
}

async function withTeamRun(
  snapshot: unknown,
  run: (team: ExecTeam) => Promise<void>,
): Promise<void> {
  const { root, dataFolder, cwd } = await teamRunFolders()
  try {
    if (snapshot !== undefined) await storedSnapshot(dataFolder, cwd, snapshot)
    const team = await createExecTeam(teamRunDeps(dataFolder, cwd), UI_TEXT, 'en')
    try {
      await run(team)
    } finally {
      await team.close()
    }
  } finally {
    await rm(root, { recursive: true, force: true })
  }
}

describe("the person's switch", () => {
  it('turns teams off only while explicitly set false', () => {
    expect(isTeamSwitchOn(undefined), 'absent setting').toBe(true)
    expect(isTeamSwitchOn(true), 'explicit true').toBe(true)
    expect(isTeamSwitchOn(false), 'explicit false').toBe(false)
    expect(isTeamAvailable(undefined), 'availability, absent setting').toBe(true)
    expect(isTeamAvailable(true), 'availability, true setting').toBe(true)
    expect(isTeamAvailable(false), 'availability, false setting').toBe(false)
  })
})

describe('the two-model rule', () => {
  it('refuses the lead alone: one usable model is not a team', () => {
    const availability = check([])
    expect(availability).toEqual({
      isAvailable: false,
      reason: 'needs-second-model',
      usableModels: 1,
    })
    expect(teamAvailabilityRefusal(availability)).toBe(UI_TEXT.teamNeedsSecondModel)
  })

  it('counts the lead plus one runnable worker as two usable models', () => {
    const availability = check([candidate(WORKER)])
    expect(availability).toEqual({ isAvailable: true, reason: 'ready', usableModels: 2 })
    expect(teamAvailabilityRefusal(availability)).toBeUndefined()
  })

  it('dedupes through sameModel: the lead under another spelling never counts', () => {
    const availability = check([candidate(`  ${LEAD} `)])
    expect(availability.reason).toBe('needs-second-model')
    expect(availability.usableModels).toBe(1)
  })

  it('compares model ids exactly as lane R does', () => {
    const pairs: [string, string][] = [
      ['muse-spark-1.3', '  muse-spark-1.3 '],
      ['muse-spark-1.3', 'muse-spark-1.3-contributor'],
      ['Muse-Spark-1.3', 'muse-spark-1.3'],
      ['other-model', 'other-model'],
    ]
    for (const [a, b] of pairs)
      expect(isSameTeamModelId(a, b), `${a} vs ${b}`).toBe(isSameTeamModel(a, b))
  })

  it('never counts an unavailable entry', () => {
    expect(check([candidate(WORKER, { isAvailable: false })]).reason).toBe('needs-second-model')
  })

  it('counts a key-billed worker only while teamWorkers is on', () => {
    const keyed = candidate(WORKER, { billsKey: true })
    expect(check([keyed], { teamWorkersOn: false }).reason).toBe('needs-second-model')
    const on = check([keyed], { teamWorkersOn: true })
    expect(on).toEqual({ isAvailable: true, reason: 'ready', usableModels: 2 })
  })

  it('stays off while the person switched it off, and says so with the way back', () => {
    const availability = check([candidate(WORKER)], { isSwitchedOff: true })
    expect(availability.isAvailable).toBe(false)
    expect(availability.reason).toBe('switched-off')
    expect(availability.usableModels).toBe(2)
    expect(teamAvailabilityRefusal(availability)).toBe(UI_TEXT.teamSwitchedOff)
  })
})

describe('the editor binding', () => {
  it('opens setup while on and refuses it in words while off', async () => {
    const on = binding(true)
    expect(on.bound.canConfigure(), 'configuration while on').toBe(true)
    await on.bound.handle({ type: 'openTeamRoles', roleId: undefined })
    expect(on.openRolesCalls, 'Roles section by command while on').toHaveLength(1)
    await on.bound.dispose()

    const off = binding(false)
    expect(off.bound.canConfigure(), 'configuration while off').toBe(false)
    await expect(
      off.bound.handle({ type: 'openTeamRoles', roleId: undefined }),
      'Roles section by command while off',
    ).rejects.toThrow(UI_TEXT.teamSwitchedOff)
    expect(off.openRolesCalls, 'Roles section while off').toEqual([])
    await expect(
      off.bound.handle({ type: 'stopTeamTask', taskId: 'task-1' }),
      'task command with no team loaded',
    ).rejects.toThrow(UI_TEXT.teamTaskUnknown)
    await off.bound.dispose()
  })

  it('loads a stored runnable team while on and nothing while off', async () => {
    const on = binding(true)
    await on.bound.open()
    expect(on.factoryCalls, 'service construction while on').toHaveLength(1)
    await on.bound.dispose()

    const off = binding(false)
    await off.bound.open()
    expect(off.factoryCalls, 'service construction while off').toEqual([])
    expect(off.bound.tree(), 'Agent map while off').toBeUndefined()
    await off.bound.dispose()
  })
})

describe('the stored team', () => {
  const options = {
    orchestratorModelId: LEAD,
    isTeamWorkersOn: true,
    canRunKind: (kind: string) => kind === 'engine',
  }
  it('names no runnable entry without a stored team, or on Solo', () => {
    expect(hasRunnableTeamEntry(stored(undefined), options)).toBe(false)
    expect(hasRunnableTeamEntry(stored({ template: 'Solo', roles: [] }), options)).toBe(false)
  })
  it('ignores the orchestrator model under another spelling', () => {
    expect(
      hasRunnableTeamEntry(
        stored(roleWith({ kind: 'engine', model: `  ${LEAD} `, pays: 'key' })),
        options,
      ),
    ).toBe(false)
  })
  it('needs teamWorkers on for a key entry, but not for a local one', () => {
    const keyed = stored(roleWith({ kind: 'engine', model: WORKER, pays: 'key' }))
    expect(hasRunnableTeamEntry(keyed, { ...options, isTeamWorkersOn: false })).toBe(false)
    expect(hasRunnableTeamEntry(keyed, options)).toBe(true)
    const local = stored(roleWith({ kind: 'engine', model: WORKER, pays: 'local' }))
    expect(hasRunnableTeamEntry(local, { ...options, isTeamWorkersOn: false })).toBe(true)
  })
  it('never counts an agent the surface cannot run', () => {
    const team = stored(roleWith({ kind: 'museCode', model: WORKER, pays: 'subscription' }))
    expect(hasRunnableTeamEntry(team, options)).toBe(false)
  })
  it('lets headless narrow past the kind: subscription workers never count there', () => {
    const team = stored(roleWith({ kind: 'engine', model: WORKER, pays: 'subscription' }))
    expect(hasRunnableTeamEntry(team, options), 'editor counts the kind').toBe(true)
    expect(
      hasRunnableTeamEntry(team, {
        ...options,
        canRunAgent: (agent) => agent.kind === 'engine' && agent.pays !== 'subscription',
      }),
      'headless refuses subscription workers',
    ).toBe(false)
  })
})

describe('ACP session admission', () => {
  it('refuses one usable model in words and admits two', () => {
    expect(admit([])).toEqual({ ok: false, reason: UI_TEXT.teamNeedsSecondModel })
    expect(admit([candidate(LEAD)])).toEqual({ ok: false, reason: UI_TEXT.teamNeedsSecondModel })
    expect(admit([candidate(WORKER)])).toEqual({ ok: true })
  })
  it('refuses a switched-off team with the way back', () => {
    expect(admit([candidate(WORKER)], { teamSwitchOff: true })).toEqual({
      ok: false,
      reason: UI_TEXT.teamSwitchedOff,
    })
  })
  it('rejects a caller value no model id can hold instead of guessing', () => {
    expect(() =>
      teamSessionAdmission(
        {
          sessionModelId: '',
          customEntries: [],
          teamSwitchOff: false,
          teamWorkersOn: true,
        },
        isSameTeamModel,
      ),
    ).toThrow(TeamContractError)
  })
})

describe('headless team runs', () => {
  it('refuses --team without a second runnable model, naming the rule', async () => {
    await withTeamRun(undefined, async (team) => {
      await expect(team.prepare(LEAD)).rejects.toThrow(UI_TEXT.teamNeedsSecondModel)
    })
  })

  it('refuses a Solo snapshot and a subscription-only second model', async () => {
    for (const snapshot of [
      { ...snapshotWith(undefined), template: 'Solo' },
      snapshotWith({ kind: 'engine', agentId: 'a1', model: WORKER, pays: 'subscription' }),
    ]) {
      await withTeamRun(snapshot, async (team) => {
        await expect(team.prepare(LEAD)).rejects.toThrow(UI_TEXT.teamNeedsSecondModel)
      })
    }
  })

  it('offers the team endpoint with a second runnable engine model', async () => {
    await withTeamRun(
      snapshotWith({ kind: 'engine', agentId: 'a1', model: WORKER, pays: 'key' }),
      async (team) => {
        await team.prepare(LEAD)
        await team.prepare(LEAD)
        expect(team.teamDecisionSource(LEAD)).toBeDefined()
      },
    )
  })
})

describe('the Roles draft', () => {
  it('says how to enable teams instead of saving an unrunnable team', async () => {
    const rig = panelRig({ offers: () => Promise.resolve(teamOffers().slice(0, 1)) })
    await rig.controller.handle({ type: 'roles/template', template: 'pair' })
    const slice = await rig.read()
    expect(slice.issues).toContain(UI_TEXT.teamNeedsSecondModel)
    expect(slice.issues.length, 'the panel disables Save while issues stand').toBeGreaterThan(0)
  })

  it('asks for no second model on Solo, or once two models are offered', async () => {
    const solo = panelRig({ offers: () => Promise.resolve(teamOffers().slice(0, 1)) })
    await solo.controller.handle({ type: 'roles/template', template: 'solo' })
    const soloSlice = await solo.read()
    expect(soloSlice.issues).not.toContain(UI_TEXT.teamNeedsSecondModel)
    const pair = panelRig()
    await pair.controller.handle({ type: 'roles/template', template: 'pair' })
    const pairSlice = await pair.read()
    expect(pairSlice.issues).not.toContain(UI_TEXT.teamNeedsSecondModel)
  })
})
