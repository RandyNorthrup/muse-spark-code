// The wizard's spending-limit write through the real VS Code
// configuration, inside the real Extension Development Host: the adapter
// is the production one (vscodeSessionBudgetSource), and
// createSessionBudgetConfig plus applyWizardSessionBudget are the real
// modules. The budget key is restored to its previous value after each
// case, so no setting leaks into other suites.
import * as assert from 'node:assert/strict'
import { chmod } from 'node:fs/promises'
import path from 'node:path'
import * as vscode from 'vscode'
import { SETTINGS_SECTION, UI_TEXT } from '../../src/shared/constants'
import { createLogger } from '../../src/host/logger'
import {
  applyWizardSessionBudget,
  createSessionBudgetConfig,
  SessionBudgetInvalidError,
  type SessionBudgetConfig,
} from '../../src/host/models/sessionBudget'
import { vscodeSessionBudgetSource } from '../../src/host/models/modelsPanelEntry'
import { canonicalUsd, usdAmountSchema } from '../../src/shared/usdSchema'

const SETTING = 'modelApiSessionBudgetUsd'

async function restoreSetting(): Promise<void> {
  const configuration = vscode.workspace.getConfiguration(SETTINGS_SECTION)
  await configuration.update(SETTING, undefined, vscode.ConfigurationTarget.Global)
  await configuration.update(SETTING, undefined, vscode.ConfigurationTarget.Workspace)
}

/** The real config over the production adapter, cleaned up afterwards. */
async function withBudgetConfig(
  seed: { value: number; target: vscode.ConfigurationTarget } | undefined,
  work: (config: SessionBudgetConfig) => Promise<void>,
): Promise<void> {
  const channel = vscode.window.createOutputChannel('session budget test', { log: true })
  try {
    if (seed !== undefined)
      await vscode.workspace
        .getConfiguration(SETTINGS_SECTION)
        .update(SETTING, seed.value, seed.target)
    await work(createSessionBudgetConfig(vscodeSessionBudgetSource(), createLogger(channel)))
  } finally {
    await restoreSetting()
    channel.dispose()
  }
}

suite('wizard session budget over the real store', () => {
  test('writes a changed budget at its effective scope through the real chain', async () => {
    await withBudgetConfig(
      { value: 10, target: vscode.ConfigurationTarget.Global },
      async (config) => {
        const outcome = await applyWizardSessionBudget(canonicalUsd(5), config, canonicalUsd(10))
        assert.deepEqual(outcome, { status: 'written', scope: 'global' })
        assert.equal(config.read().effectiveUsd, canonicalUsd(5))
      },
    )
  })

  test('an unchanged budget writes nothing', async () => {
    await withBudgetConfig(
      { value: 10, target: vscode.ConfigurationTarget.Global },
      async (config) => {
        const outcome = await applyWizardSessionBudget(canonicalUsd(10), config, canonicalUsd(10))
        assert.deepEqual(outcome, { status: 'unchanged' })
        assert.equal(config.read().effectiveUsd, canonicalUsd(10))
      },
    )
  })

  test('a concurrent change refuses with the conflict words, never overwriting', async () => {
    await withBudgetConfig(
      { value: 10, target: vscode.ConfigurationTarget.Global },
      async (config) => {
        const outcome = await applyWizardSessionBudget(canonicalUsd(5), config, canonicalUsd(7))
        assert.equal(outcome.status, 'conflict')
        assert.equal(config.read().effectiveUsd, canonicalUsd(10))
      },
    )
  })

  test('fails an invalid value with the fixed words, never the store', async () => {
    await withBudgetConfig(
      { value: 10, target: vscode.ConfigurationTarget.Global },
      async (config) => {
        // '-5' is a well-formed signed amount, so the schema parse below
        // needs no cast; the setting itself takes only non-negative values.
        const outcome = await applyWizardSessionBudget(
          usdAmountSchema.parse('-5'),
          config,
          canonicalUsd(10),
        )
        assert.deepEqual(outcome, { status: 'failed', error: UI_TEXT.wizardSessionBudgetInvalid })
        assert.equal(config.read().effectiveUsd, canonicalUsd(10))
      },
    )
  })

  test('lets the store failure reject with the original error', async () => {
    // A read-only workspace settings file is a real store failure: the
    // update below rejects with the filesystem's own error, never a
    // scripted refusal.
    const folder = vscode.workspace.workspaceFolders?.[0]
    assert.ok(folder)
    const settingsFile = path.join(folder.uri.fsPath, '.vscode', 'settings.json')
    await withBudgetConfig(
      { value: 10, target: vscode.ConfigurationTarget.Workspace },
      async (config) => {
        await chmod(settingsFile, 0o444)
        try {
          await applyWizardSessionBudget(canonicalUsd(5), config, canonicalUsd(10))
          assert.fail('the read-only settings file must refuse the write')
        } catch (error: unknown) {
          assert.ok(error instanceof Error)
          assert.ok(!(error instanceof SessionBudgetInvalidError))
          assert.match(String(error), /EACCES|EPERM|denied|read-only/i)
        } finally {
          await chmod(settingsFile, 0o644)
        }
        assert.equal(config.read().effectiveUsd, canonicalUsd(10))
      },
    )
  })
})
