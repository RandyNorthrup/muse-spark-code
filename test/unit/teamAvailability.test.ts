// Hidden means hidden (RVCM963JB P2-1): every team surface stays behind the
// release latch AND the `museSpark.team` switch. With the latch closed
// nothing of teams is constructed, shown, or reachable by command, even with
// a true setting; with both on each surface works.
import { describe, expect, it, vi } from 'vitest'
import { TeamHostBinding, isTeamSwitchOn } from '../../src/host/teamHostBinding'
import { createTeamPanelHost } from '../../src/host/models/modelsPanelEntry'
import { OPTIONAL_RUNTIME_AVAILABILITY, UI_TEXT } from '../../src/shared/constants'
import { isTeamAvailable } from '../../src/shared/teamConversation'
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
  // P2-1: availability is the release latch AND the setting. A true setting
  // with a closed latch opens nothing; the latch ships closed.
  it('keeps everything closed while the latch is closed, even with a true setting', () => {
    expect(OPTIONAL_RUNTIME_AVAILABILITY.team, 'shipped latch').toBe(false)
    expect(isTeamAvailable(true), 'true setting, closed latch').toBe(false)
    expect(isTeamAvailable(false), 'false setting, closed latch').toBe(false)
    expect(isTeamAvailable(undefined), 'absent setting, closed latch').toBe(false)
  })
  it('opens with the latch and the setting together, and closes again after', () => {
    OPTIONAL_RUNTIME_AVAILABILITY.team = true
    try {
      expect(isTeamAvailable(true), 'true setting, open latch').toBe(true)
      expect(isTeamAvailable(false), 'false setting, open latch').toBe(false)
    } finally {
      OPTIONAL_RUNTIME_AVAILABILITY.team = false
    }
    expect(isTeamAvailable(true), 'restored latch').toBe(false)
  })
  // P2-1: a true setting with a closed latch opens nothing: no bundle for a
  // saved runnable team, no configuration, no command, no panel content.
  it('hides every team surface while the latch is closed, even with a true setting', async () => {
    for (const isOn of [false, true]) {
      const closed = binding(isOn)
      // Nothing is constructed: a stored runnable team loads no bundle.
      await closed.bound.open()
      expect(closed.factory, `service construction, setting ${String(isOn)}`).not.toHaveBeenCalled()
      // Nothing is shown: no configuration, no Agent map.
      expect(closed.bound.canConfigure(), `configuration, setting ${String(isOn)}`).toBe(false)
      expect(closed.bound.tree(), `Agent map, setting ${String(isOn)}`).toBeUndefined()
      // Nothing is reachable by command: Roles and task commands refuse, so a
      // saved team neither loads nor dispatches.
      await expect(
        closed.bound.handle({ type: 'openTeamRoles', roleId: undefined }),
        `Roles section by command, setting ${String(isOn)}`,
      ).rejects.toThrow(UI_TEXT.teamTaskUnknown)
      expect(closed.openRoles, `Roles section, setting ${String(isOn)}`).not.toHaveBeenCalled()
      await expect(
        closed.bound.handle({ type: 'stopTeamTask', taskId: 'task-1' }),
        `Agents section task command, setting ${String(isOn)}`,
      ).rejects.toThrow(UI_TEXT.teamTaskUnknown)
      // The Models & Agents panel builds no Roles/Agents content.
      const panel = createTeamPanelHost({
        team: {
          isEnabled: () => closed.bound.canConfigure(),
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
      expect(await panel?.load(), `Roles/Agents panel, setting ${String(isOn)}`).toBeUndefined()
      await closed.bound.dispose()
    }
  })
  it('shows each surface while the latch and the setting are both on', async () => {
    OPTIONAL_RUNTIME_AVAILABILITY.team = true
    try {
      const on = binding(true)
      expect(on.bound.canConfigure(), 'first-time configuration while on').toBe(true)
      await on.bound.handle({ type: 'openTeamRoles', roleId: undefined })
      expect(on.openRoles, 'Roles section by command while on').toHaveBeenCalledOnce()
      await on.bound.dispose()

      const off = binding(false)
      expect(off.bound.canConfigure(), 'configuration with a false setting').toBe(false)
      await off.bound.open()
      expect(off.factory, 'service construction with a false setting').not.toHaveBeenCalled()
      await off.bound.dispose()
    } finally {
      OPTIONAL_RUNTIME_AVAILABILITY.team = false
    }
  })
})
