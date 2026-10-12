// Hidden means hidden (RVCM963J 1): every team surface stays behind the
// `museSpark.team` switch. With it off (including absent) nothing of teams is
// constructed, shown, or reachable by command; with it on each surface works.
// One test walks the whole surface list in both directions.
import { describe, expect, it, vi } from 'vitest'
import { TeamHostBinding, isTeamSwitchOn } from '../../src/host/teamHostBinding'
import { createTeamPanelHost } from '../../src/host/models/modelsPanelEntry'
import { UI_TEXT } from '../../src/shared/constants'
import { TEAM_WORKSPACE_KEYS } from '../../src/shared/teamConversation'

function noop(): void {
  // A panel callback with nothing to do.
}
function noopUnsubscribe(): void {
  // A tree listener that never fires.
}
function storedTeam(): Map<string, unknown> {
  return new Map<string, unknown>([
    [
      TEAM_WORKSPACE_KEYS.team,
      {
        template: 'Team',
        roles: [
          {
            role: 'engineering',
            pool: [
              {
                id: 'entry-1',
                agent: { kind: 'engine', agentId: 'openai', model: 'other-model', pays: 'key' },
                concurrent: 1,
                caps: [],
              },
            ],
          },
        ],
      },
    ],
  ])
}

function ports(isTeamOn: boolean) {
  const values = storedTeam()
  const log = {
    trace: () => undefined,
    info: () => undefined,
    warn: () => undefined,
    error: () => undefined,
  }
  return {
    ports: {
      hooks: undefined,
      state: {
        get: (key: string) => values.get(key),
        update: (key: string, value: unknown) => {
          values.set(key, value)
          return Promise.resolve()
        },
      },
      settings: {
        isTeamOn: () => isTeamOn,
        isTeamWorkersOn: () => true,
        maxWorkers: () => 2,
        isTrusted: () => true,
      },
      orchestrator: {
        modelId: () => 'muse-spark-1.2',
        backend: () => 'modelApi',
      },
      paid: {
        allowKeyTasks: () => Promise.resolve(false),
      },
      cards: {
        show: () => undefined,
      },
      newId: () => 'id-1',
      now: () => 0,
      log,
      engine: {
        repositoryRoot: () => undefined,
        storageRoot: '/tmp/team-availability',
        platform: 'linux' as const,
        isTrusted: () => true,
        listModels: () => Promise.resolve([] as readonly string[]),
        startWorker: () => Promise.reject(new Error('no worker here')),
        now: () => 0,
        log,
      },
    },
  }
}

function binding(isTeamOn: boolean) {
  const factory = vi.fn()
  const openRoles = vi.fn(() => Promise.resolve())
  const bound = new TeamHostBinding({
    ...ports(isTeamOn),
    canRunKind: (kind) => kind === 'engine',
    loadFactory: () => {
      factory()
      return Promise.resolve(() => undefined as never)
    },
    uiText: () => UI_TEXT,
    uiLocale: () => 'en',
    showTree: () => undefined,
    openRoles,
    showDiff: () => Promise.resolve(),
  })
  return { bound, factory, openRoles }
}

describe('the team availability switch', () => {
  it('counts an absent setting as off: only an explicit true flips it on', () => {
    expect(isTeamSwitchOn(undefined), 'absent setting').toBe(false)
    expect(isTeamSwitchOn(false), 'explicit false').toBe(false)
    expect(isTeamSwitchOn(true), 'explicit true').toBe(true)
    expect(isTeamSwitchOn('true'), 'truthy string').toBe(false)
  })
  it('hides every team surface while off and shows each while on', async () => {
    // The walk-back register: every surface the switch guards. Each
    // direction below names the surface it checks.
    const off = binding(false)
    // Nothing is constructed: a stored runnable team loads no bundle.
    await off.bound.open()
    expect(off.factory, 'service construction while off').not.toHaveBeenCalled()
    // Nothing is shown: no configuration, no Agent map.
    expect(off.bound.canConfigure(), 'first-time configuration while off').toBe(false)
    expect(off.bound.tree(), 'Agent map while off').toBeUndefined()
    // Nothing is reachable by command: Roles and task commands refuse.
    await expect(
      off.bound.handle({ type: 'openTeamRoles', roleId: undefined }),
      'Roles section by command while off',
    ).rejects.toThrow(UI_TEXT.teamTaskUnknown)
    expect(off.openRoles, 'Roles section by command while off').not.toHaveBeenCalled()
    await expect(
      off.bound.handle({ type: 'stopTeamTask', taskId: 'task-1' }),
      'Agents section task command while off',
    ).rejects.toThrow(UI_TEXT.teamTaskUnknown)
    // The Models & Agents panel builds no Roles/Agents content while off.
    const panelOff = createTeamPanelHost({
      team: {
        isEnabled: () => off.bound.canConfigure(),
        state: { get: () => undefined, update: () => Promise.resolve() },
        reload: noop,
        onTreeChange: () => noopUnsubscribe,
        tree: () => undefined,
        handle: () => Promise.resolve(),
      },
      l10n: { table: UI_TEXT, locale: 'en' },
      writeExportFile: () => Promise.resolve(undefined),
      readImportFile: () => Promise.resolve(undefined),
    })
    expect(await panelOff?.load(), 'Roles/Agents panel content while off').toBeUndefined()

    const on = binding(true)
    expect(on.bound.canConfigure(), 'first-time configuration while on').toBe(true)
    await on.bound.handle({ type: 'openTeamRoles', roleId: undefined })
    expect(on.openRoles, 'Roles section by command while on').toHaveBeenCalledOnce()
    await on.bound.dispose()
    await off.bound.dispose()
  })
})
