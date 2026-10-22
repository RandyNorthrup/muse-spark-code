// Hidden means hidden (RVCM963JB P2-1): every team surface stays behind the
// release latch AND the `museSpark.team` switch. With the latch closed
// nothing of teams is constructed, shown, or reachable by command, even with
// a true setting; with both on each surface works.
import { describe, expect, it } from 'vitest'
import { isTeamSwitchOn } from '../../src/host/teamHostBinding'
import { OPTIONAL_RUNTIME_AVAILABILITY, UI_TEXT } from '../../src/shared/constants'
import { isTeamAvailable, teamLatchRefusal } from '../../src/shared/teamConversation'
import { availabilityBinding } from './helpers/teamAvailabilityRig'

function binding(isTeamOn: boolean) {
  const openRolesCalls: unknown[][] = []
  const { bound, factoryCalls } = availabilityBinding(isTeamOn, {
    openRoles: () => {
      openRolesCalls.push([])
      return Promise.resolve()
    },
    showDiff: () => Promise.resolve(),
  })
  return { bound, factoryCalls, openRolesCalls }
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
  // P3-1: a dispatch the latch refuses says the latch, not the budget.
  // Entry points throw this instead of the budget sentence while closed.
  it('names the latch while it is closed, and stays silent once it opens', () => {
    expect(OPTIONAL_RUNTIME_AVAILABILITY.team, 'shipped latch').toBe(false)
    expect(teamLatchRefusal()).toBe(UI_TEXT.teamNotReleased)
    OPTIONAL_RUNTIME_AVAILABILITY.team = true
    try {
      expect(teamLatchRefusal(), 'open latch').toBeUndefined()
    } finally {
      OPTIONAL_RUNTIME_AVAILABILITY.team = false
    }
    expect(teamLatchRefusal(), 'restored latch').toBe(UI_TEXT.teamNotReleased)
  })
  // P2-1: a true setting with a closed latch opens nothing at the binding:
  // no bundle for a saved runnable team, no configuration, no command.
  // The panel half of the claim runs in the extension host (see below).
  it('hides every team surface while the latch is closed, even with a true setting', async () => {
    for (const isOn of [false, true]) {
      const closed = binding(isOn)
      // Nothing is constructed: a stored runnable team loads no bundle.
      await closed.bound.open()
      expect(closed.factoryCalls, `service construction, setting ${String(isOn)}`).toEqual([])
      // Nothing is shown: no configuration, no Agent map.
      expect(closed.bound.canConfigure(), `configuration, setting ${String(isOn)}`).toBe(false)
      expect(closed.bound.tree(), `Agent map, setting ${String(isOn)}`).toBeUndefined()
      // Nothing is reachable by command: Roles and task commands refuse, so a
      // saved team neither loads nor dispatches.
      await expect(
        closed.bound.handle({ type: 'openTeamRoles', roleId: undefined }),
        `Roles section by command, setting ${String(isOn)}`,
      ).rejects.toThrow(UI_TEXT.teamTaskUnknown)
      expect(closed.openRolesCalls, `Roles section, setting ${String(isOn)}`).toEqual([])
      await expect(
        closed.bound.handle({ type: 'stopTeamTask', taskId: 'task-1' }),
        `Agents section task command, setting ${String(isOn)}`,
      ).rejects.toThrow(UI_TEXT.teamTaskUnknown)
      // The Models & Agents panel builds no Roles/Agents content either:
      // that half runs inside the real extension host
      // (test/integration/teamPanelAvailability.test.ts).
      await closed.bound.dispose()
    }
  })
  it('shows each surface while the latch and the setting are both on', async () => {
    OPTIONAL_RUNTIME_AVAILABILITY.team = true
    try {
      const on = binding(true)
      expect(on.bound.canConfigure(), 'first-time configuration while on').toBe(true)
      await on.bound.handle({ type: 'openTeamRoles', roleId: undefined })
      expect(on.openRolesCalls, 'Roles section by command while on').toHaveLength(1)
      await on.bound.dispose()

      const off = binding(false)
      expect(off.bound.canConfigure(), 'configuration with a false setting').toBe(false)
      await off.bound.open()
      expect(off.factoryCalls, 'service construction with a false setting').toEqual([])
      await off.bound.dispose()
    } finally {
      OPTIONAL_RUNTIME_AVAILABILITY.team = false
    }
  })
})
