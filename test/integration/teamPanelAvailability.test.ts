// The panel half of the team availability latch (RVCM963JB P2-1), inside
// the real Extension Development Host: `createTeamPanelHost` is the
// production adapter out of `src/host/models/modelsPanelEntry.ts`, so the
// `vscode` module it reads is the real one, and the team binding wired
// into it is the real `TeamHostBinding`. With the release latch closed the
// panel builds no Roles/Agents content for either setting: `load()`
// resolves undefined without touching the workspace.
import * as assert from 'node:assert/strict'
import { createTeamPanelHost } from '../../src/host/models/modelsPanelEntry'
import { UI_TEXT } from '../../src/shared/constants'
import { availabilityBinding } from '../unit/helpers/teamAvailabilityRig'

function silentUnsubscribe(): void {
  // The latch never reports a tree while closed.
}

function silentOnTreeChange(): () => void {
  return silentUnsubscribe
}

function noopShowDiff(): Promise<void> {
  // Nothing to diff while the latch is closed; the binding requires the port.
  return Promise.resolve()
}

function noopOpenRoles(): Promise<void> {
  // The latch never opens Roles while closed; the binding requires the port.
  return Promise.resolve()
}

function binding(isTeamOn: boolean) {
  const { bound, factoryCalls } = availabilityBinding(isTeamOn, {
    openRoles: noopOpenRoles,
    showDiff: noopShowDiff,
  })
  return { bound, factoryCalls }
}

suite('team panel availability inside the extension host', () => {
  test('a closed latch builds no Roles/Agents content for either setting', async () => {
    for (const isOn of [false, true]) {
      const closed = binding(isOn)
      await closed.bound.open()
      assert.deepEqual(closed.factoryCalls, [])
      const panel = createTeamPanelHost({
        team: {
          isEnabled: () => closed.bound.canConfigure(),
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
      await closed.bound.dispose()
    }
  })
})
