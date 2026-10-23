// The panel half of the team availability rule (D217), inside the real
// Extension Development Host: `createTeamPanelHost` is the production
// adapter out of `src/host/models/modelsPanelEntry.ts`, so the `vscode`
// module it reads is the real one, and the team binding wired into it is
// the real `TeamHostBinding`. With the team switched off the panel builds
// no Roles/Agents content: `load()` resolves undefined without touching
// the workspace, and the Roles command refuses in words. While on, a
// stored runnable team loads and the Roles command opens.
import * as assert from 'node:assert/strict'
import { createTeamPanelHost } from '../../src/host/models/modelsPanelEntry'
import { UI_TEXT } from '../../src/shared/constants'
import { availabilityBindingWithOpenRoles } from '../unit/helpers/teamAvailabilityRig'

function silentUnsubscribe(): void {
  // The tree never changes in this proof; the binding requires the port.
}

function silentOnTreeChange(): () => void {
  return silentUnsubscribe
}

function binding(isTeamOn: boolean) {
  return availabilityBindingWithOpenRoles(isTeamOn)
}

suite('team panel availability inside the extension host', () => {
  test('a switched-off team builds no Roles/Agents content and says so', async () => {
    const off = binding(false)
    await off.bound.open()
    assert.deepEqual(off.factoryCalls, [])
    assert.equal(off.bound.canConfigure(), false)
    await assert.rejects(
      off.bound.handle({ type: 'openTeamRoles', roleId: undefined }),
      (error: unknown) => error instanceof Error && error.message === UI_TEXT.teamSwitchedOff,
    )
    assert.deepEqual(off.openRolesCalls, [])
    const panel = createTeamPanelHost({
      team: {
        isEnabled: () => off.bound.canConfigure(),
        state: { get: () => undefined, update: () => Promise.resolve() },
        reload: () => undefined,
        onTreeChange: silentOnTreeChange,
        tree: () => undefined,
        handle: () => Promise.resolve(),
      },
      l10n: { table: UI_TEXT, locale: 'en' },
      writeExportFile: () => Promise.resolve(undefined),
      readImportFile: () => Promise.resolve(undefined),
    })
    assert.equal(await panel?.load(), undefined)
    await off.bound.dispose()
  })

  test('a stored runnable team loads and opens Roles while on', async () => {
    const on = binding(true)
    await on.bound.open()
    assert.equal(on.factoryCalls.length, 1)
    assert.equal(on.bound.canConfigure(), true)
    await on.bound.handle({ type: 'openTeamRoles', roleId: undefined })
    assert.equal(on.openRolesCalls.length, 1)
    await on.bound.dispose()
  })
})
