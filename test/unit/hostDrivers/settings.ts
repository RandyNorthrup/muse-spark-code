// The native conformance settings leg (RLF-M104GL): writes the scenario's
// setting through the production runtime settings store and reads it back,
// exactly as the runtime's settings/update and settings/get serve it over
// MHP. Native harnesses spawn this through runDriver.mjs, which bundles it
// with esbuild; the unit suite imports it directly.
import { mkdirSync } from 'node:fs'
import { stderrLogger } from '../../../src/runtime/stderrLog'
import { RuntimeSettingsStore } from '../../../src/runtime/settingsStore'

export interface SettingsDriverArgs {
  readonly workspaceRoot: string
  readonly dataRoot: string
}

export interface SettingsDriverResult {
  readonly settingValue: number
}

// The runtime store canonicalizes USD values (legacyUsdSchema: 5 becomes
// "5.00"), so the scenario value round-trips through a plain integer
// setting; the observation (5) is what the contract validates.
const SCENARIO_KEY = 'museSpark.schedulePauseAfterFailures'
const SCENARIO_VALUE = 5

export async function runSettingsDriver(args: SettingsDriverArgs): Promise<SettingsDriverResult> {
  mkdirSync(args.workspaceRoot, { recursive: true })
  mkdirSync(args.dataRoot, { recursive: true })
  const store = new RuntimeSettingsStore({
    dataFolder: args.dataRoot,
    workspaceRoot: args.workspaceRoot,
    log: stderrLogger(() => undefined, 'warn'),
    sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  })
  await store.updateSetting(SCENARIO_KEY, SCENARIO_VALUE, 'user')
  const value = await store.getSetting(SCENARIO_KEY)
  if (value !== SCENARIO_VALUE) throw new Error('the setting did not read back')
  return { settingValue: value }
}
