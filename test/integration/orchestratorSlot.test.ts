// The orchestrator slot against the real settings store, inside the real
// Extension Development Host: readOrchestratorOverride and
// resetOrchestratorSlot run over VS Code's configuration through a
// two-line forwarding adapter (the product's store wiring, which passes
// workspace state structurally, lands with the slot's M95/M96 owner; the
// logic under test only needs a real persistent get/update). Every case
// restores the key afterwards, so no setting leaks into other suites.
import * as assert from 'node:assert/strict'
import * as vscode from 'vscode'
import { SETTINGS_SECTION } from '../../src/shared/constants'
import {
  readOrchestratorOverride,
  resetOrchestratorSlot,
  type OrchestratorSlotState,
} from '../../src/core/team/orchestratorSlot'

function slotKey(key: string): string {
  return key.startsWith(`${SETTINGS_SECTION}.`) ? key.slice(SETTINGS_SECTION.length + 1) : key
}

/** The real configuration behind the slot's narrow structural port. */
function realSlotState(): OrchestratorSlotState {
  return {
    get: (key: string) => vscode.workspace.getConfiguration(SETTINGS_SECTION).get(slotKey(key)),
    update: (key: string, value: unknown) =>
      vscode.workspace
        .getConfiguration(SETTINGS_SECTION)
        .update(slotKey(key), value, vscode.ConfigurationTarget.Global),
  }
}

async function clearSlot(state: OrchestratorSlotState): Promise<void> {
  await resetOrchestratorSlot(state)
}

suite('orchestrator slot over the real store', () => {
  test('reads no override by default: the picker decides', async () => {
    const state = realSlotState()
    try {
      await clearSlot(state)
      assert.equal(readOrchestratorOverride(state), undefined)
    } finally {
      await clearSlot(state)
    }
  })

  test('reads a stored override', async () => {
    const state = realSlotState()
    try {
      await state.update('museSpark.team.orchestrator', {
        modelId: 'opus-5.5',
        backend: 'modelApi',
      })
      assert.deepEqual(readOrchestratorOverride(state), {
        modelId: 'opus-5.5',
        backend: 'modelApi',
      })
    } finally {
      await clearSlot(state)
    }
  })

  test('reads anything else stored as none', async () => {
    const state = realSlotState()
    try {
      await state.update('museSpark.team.orchestrator', { model: 'x' })
      assert.equal(readOrchestratorOverride(state), undefined)
      await state.update('museSpark.team.orchestrator', 'opus')
      assert.equal(readOrchestratorOverride(state), undefined)
    } finally {
      await clearSlot(state)
    }
  })

  test('reset clears the stored override, so the picker decides again', async () => {
    const state = realSlotState()
    try {
      await state.update('museSpark.team.orchestrator', {
        modelId: 'opus-5.5',
        backend: 'modelApi',
      })
      assert.deepEqual(readOrchestratorOverride(state), {
        modelId: 'opus-5.5',
        backend: 'modelApi',
      })
      // The reread below is the proof the reset really wrote: the override
      // above persisted through the real store, and only a real clear
      // makes it read as none again.
      await resetOrchestratorSlot(state)
      assert.equal(readOrchestratorOverride(state), undefined)
    } finally {
      await clearSlot(state)
    }
  })
})
