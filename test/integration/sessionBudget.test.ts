// The wizard's spending-limit write through the real VS Code
// configuration, inside the real Extension Development Host: the adapter
// below forwards get/inspect/update to the live settings exactly as the
// production panel does (modelsPanelEntry.ts), and createSessionBudgetConfig
// plus applyWizardSessionBudget are the real modules. The budget key is
// restored to its previous value after each case, so no setting leaks into
// other suites.
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
  type SessionBudgetConfigSource,
  type SessionBudgetScope,
} from '../../src/host/models/sessionBudget'
import { canonicalUsd, usdAmountSchema } from '../../src/shared/usdSchema'

const SETTING = 'modelApiSessionBudgetUsd'

/** The production adapter: the live settings behind the config port. */
function realBudgetSource(): SessionBudgetConfigSource {
  return {
    get: (section) => vscode.workspace.getConfiguration(SETTINGS_SECTION).get(section),
    inspect: (section) => {
      const inspected = vscode.workspace.getConfiguration(SETTINGS_SECTION).inspect(section)
      return inspected === undefined
        ? undefined
        : {
            workspaceValue: inspected.workspaceValue,
            workspaceFolderValue: inspected.workspaceFolderValue,
          }
    },
    update: async (section, value, scope: SessionBudgetScope): Promise<void> => {
      await vscode.workspace
        .getConfiguration(SETTINGS_SECTION)
        .update(
          section,
          value,
          scope === 'workspace'
            ? vscode.ConfigurationTarget.Workspace
            : vscode.ConfigurationTarget.Global,
        )
    },
  }
}

async function restoreSetting(): Promise<void> {
  const configuration = vscode.workspace.getConfiguration(SETTINGS_SECTION)
  await configuration.update(SETTING, undefined, vscode.ConfigurationTarget.Global)
  await configuration.update(SETTING, undefined, vscode.ConfigurationTarget.Workspace)
}

suite('wizard session budget over the real store', () => {
  test('writes a changed budget at its effective scope through the real chain', async () => {
    const channel = vscode.window.createOutputChannel('session budget test', { log: true })
    const config = createSessionBudgetConfig(realBudgetSource(), createLogger(channel))
    try {
      await vscode.workspace
        .getConfiguration(SETTINGS_SECTION)
        .update(SETTING, 10, vscode.ConfigurationTarget.Global)
      const outcome = await applyWizardSessionBudget(canonicalUsd(5), config, canonicalUsd(10))
      assert.deepEqual(outcome, { status: 'written', scope: 'global' })
      assert.equal(config.read().effectiveUsd, canonicalUsd(5))
    } finally {
      await restoreSetting()
      channel.dispose()
    }
  })

  test('an unchanged budget writes nothing', async () => {
    const channel = vscode.window.createOutputChannel('session budget test', { log: true })
    const config = createSessionBudgetConfig(realBudgetSource(), createLogger(channel))
    try {
      await vscode.workspace
        .getConfiguration(SETTINGS_SECTION)
        .update(SETTING, 10, vscode.ConfigurationTarget.Global)
      const outcome = await applyWizardSessionBudget(canonicalUsd(10), config, canonicalUsd(10))
      assert.deepEqual(outcome, { status: 'unchanged' })
      assert.equal(config.read().effectiveUsd, canonicalUsd(10))
    } finally {
      await restoreSetting()
      channel.dispose()
    }
  })

  test('a concurrent change refuses with the conflict words, never overwriting', async () => {
    const channel = vscode.window.createOutputChannel('session budget test', { log: true })
    const config = createSessionBudgetConfig(realBudgetSource(), createLogger(channel))
    try {
      await vscode.workspace
        .getConfiguration(SETTINGS_SECTION)
        .update(SETTING, 10, vscode.ConfigurationTarget.Global)
      const outcome = await applyWizardSessionBudget(canonicalUsd(5), config, canonicalUsd(7))
      assert.equal(outcome.status, 'conflict')
      assert.equal(config.read().effectiveUsd, canonicalUsd(10))
    } finally {
      await restoreSetting()
      channel.dispose()
    }
  })

  test('fails an invalid value with the fixed words, never the store', async () => {
    const channel = vscode.window.createOutputChannel('session budget test', { log: true })
    const config = createSessionBudgetConfig(realBudgetSource(), createLogger(channel))
    try {
      await vscode.workspace
        .getConfiguration(SETTINGS_SECTION)
        .update(SETTING, 10, vscode.ConfigurationTarget.Global)
      // '-5' is a well-formed signed amount, so the schema parse below
      // needs no cast; the setting itself takes only non-negative values.
      const outcome = await applyWizardSessionBudget(
        usdAmountSchema.parse('-5'),
        config,
        canonicalUsd(10),
      )
      assert.deepEqual(outcome, { status: 'failed', error: UI_TEXT.wizardSessionBudgetInvalid })
      assert.equal(config.read().effectiveUsd, canonicalUsd(10))
    } finally {
      await restoreSetting()
      channel.dispose()
    }
  })

  test('lets the store failure reject with the original error', async () => {
    // A read-only workspace settings file is a real store failure: the
    // update below rejects with the filesystem's own error, never a
    // scripted refusal.
    const folder = vscode.workspace.workspaceFolders?.[0]
    assert.ok(folder)
    const settingsFile = path.join(folder.uri.fsPath, '.vscode', 'settings.json')
    const channel = vscode.window.createOutputChannel('session budget test', { log: true })
    const config = createSessionBudgetConfig(realBudgetSource(), createLogger(channel))
    try {
      await vscode.workspace
        .getConfiguration(SETTINGS_SECTION)
        .update(SETTING, 10, vscode.ConfigurationTarget.Workspace)
      await chmod(settingsFile, 0o444)
      let failure: unknown
      try {
        await applyWizardSessionBudget(canonicalUsd(5), config, canonicalUsd(10))
      } catch (error: unknown) {
        failure = error
      } finally {
        await chmod(settingsFile, 0o644)
      }
      assert.ok(failure instanceof Error)
      assert.ok(!(failure instanceof SessionBudgetInvalidError))
      assert.match(String(failure), /EACCES|EPERM|denied|read-only/i)
      assert.equal(config.read().effectiveUsd, canonicalUsd(10))
    } finally {
      await restoreSetting()
      channel.dispose()
    }
  })
})
