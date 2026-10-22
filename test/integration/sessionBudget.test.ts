// The wizard's spending-limit write through the real VS Code
// configuration, inside the real Extension Development Host: the adapter
// is the production one (vscodeSessionBudgetSource), and
// createSessionBudgetConfig plus applyWizardSessionBudget are the real
// modules. The budget key is machine-scoped (package.json), so it lives
// only in User settings: every seed and restore writes at Global, the
// setting's effective scope. The budget key is restored to its previous
// value after each case, so no setting leaks into other suites.
import * as assert from 'node:assert/strict'
import * as vscode from 'vscode'
import { SETTINGS_SECTION, UI_TEXT } from '../../src/shared/constants'
import { createLogger } from '../../src/host/logger'
import {
  applyWizardSessionBudget,
  createSessionBudgetConfig,
  SessionBudgetInvalidError,
  type SessionBudgetConfig,
} from '../../src/host/models/sessionBudget'
import { vscodeSessionBudgetSource } from '../../src/host/vscode/models/modelsPanelEntry'
import { canonicalUsd, usdAmountSchema } from '../../src/shared/usdSchema'

const SETTING = 'modelApiSessionBudgetUsd'

async function restoreSetting(): Promise<void> {
  // Global only: the key is machine-scoped, so a Workspace-targeted write
  // is refused by the real store.
  await vscode.workspace
    .getConfiguration(SETTINGS_SECTION)
    .update(SETTING, undefined, vscode.ConfigurationTarget.Global)
}

/** The real config over the production adapter, cleaned up afterwards. */
async function withBudgetConfig(
  seed: { value: number } | undefined,
  work: (config: SessionBudgetConfig) => Promise<void>,
): Promise<void> {
  const channel = vscode.window.createOutputChannel('session budget test', { log: true })
  try {
    if (seed !== undefined)
      await vscode.workspace
        .getConfiguration(SETTINGS_SECTION)
        .update(SETTING, seed.value, vscode.ConfigurationTarget.Global)
    await work(createSessionBudgetConfig(vscodeSessionBudgetSource(), createLogger(channel)))
  } finally {
    await restoreSetting()
    channel.dispose()
  }
}

suite('wizard session budget over the real store', () => {
  test('writes a changed budget at its effective scope through the real chain', async () => {
    await withBudgetConfig({ value: 10 }, async (config) => {
      const outcome = await applyWizardSessionBudget(canonicalUsd(5), config, canonicalUsd(10))
      assert.deepEqual(outcome, { status: 'written', scope: 'global' })
      assert.equal(config.read().effectiveUsd, canonicalUsd(5))
    })
  })

  test('an unchanged budget writes nothing', async () => {
    await withBudgetConfig({ value: 10 }, async (config) => {
      const outcome = await applyWizardSessionBudget(canonicalUsd(10), config, canonicalUsd(10))
      assert.deepEqual(outcome, { status: 'unchanged' })
      assert.equal(config.read().effectiveUsd, canonicalUsd(10))
    })
  })

  test('a concurrent change refuses with the conflict words, never overwriting', async () => {
    await withBudgetConfig({ value: 10 }, async (config) => {
      const outcome = await applyWizardSessionBudget(canonicalUsd(5), config, canonicalUsd(7))
      assert.equal(outcome.status, 'conflict')
      assert.equal(config.read().effectiveUsd, canonicalUsd(10))
    })
  })

  test('fails an invalid value with the fixed words, never the store', async () => {
    await withBudgetConfig({ value: 10 }, async (config) => {
      // '-5' is a well-formed signed amount, so the schema parse below
      // needs no cast; the setting itself takes only non-negative values.
      const outcome = await applyWizardSessionBudget(
        usdAmountSchema.parse('-5'),
        config,
        canonicalUsd(10),
      )
      assert.deepEqual(outcome, { status: 'failed', error: UI_TEXT.wizardSessionBudgetInvalid })
      assert.equal(config.read().effectiveUsd, canonicalUsd(10))
    })
  })

  test('lets the store failure reject with the original error', async () => {
    // A dirty User settings model is a real store failure: the production
    // configuration service refuses the update itself, on every platform,
    // with its own words and no filesystem change, so nothing can leak
    // into the suites after it. (A read-only settings file refuses the
    // same write, but on Windows the read-only attribute outlived this
    // test's restore and poisoned every later User-settings write.)
    await withBudgetConfig({ value: 10 }, async (config) => {
      await vscode.commands.executeCommand('workbench.action.openSettingsJson')
      const editor = vscode.window.activeTextEditor
      assert.ok(editor)
      // Save first: the opened model can hold unsaved changes, and the
      // configuration service refuses a write while it does.
      await vscode.commands.executeCommand('workbench.action.files.saveFiles')
      // An unsaved edit dirties the model; the service refuses the write
      // while it is dirty. Settings files take comments, so the probe
      // keeps the on-disk content valid JSONC.
      await editor.edit((builder) => {
        builder.insert(new vscode.Position(0, 0), '// session budget store-failure probe\n')
      })
      assert.equal(editor.document.isDirty, true)
      try {
        await applyWizardSessionBudget(canonicalUsd(5), config, canonicalUsd(10))
        assert.fail('the dirty settings model must refuse the write')
      } catch (error: unknown) {
        // The store's own refusal, unwrapped: the configuration service
        // reports its refused save in its own words, and it must never
        // read as the wizard's invalid value. A Workspace-targeted write
        // would fail with 'Workspace Settings' instead: this row proves
        // the write went to User settings.
        assert.ok(error instanceof Error)
        assert.ok(!(error instanceof SessionBudgetInvalidError))
        assert.match(String(error), /user settings/i)
        assert.doesNotMatch(String(error), /Workspace Settings/)
      } finally {
        // Revert the model to the on-disk content (the seed's 10), so the
        // cleanup write below is accepted, then close the probe editor.
        // Both are in-memory: no permission can fail them on any platform.
        await vscode.commands.executeCommand('workbench.action.openSettingsJson')
        await vscode.commands.executeCommand('workbench.action.files.revert')
        await vscode.commands.executeCommand('workbench.action.closeActiveEditor')
      }
      assert.equal(config.read().effectiveUsd, canonicalUsd(10))
    })
  })
})
