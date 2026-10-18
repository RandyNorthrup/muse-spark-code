// Linux dictation's shipped CommonJS bundle (M9, PLAN.md D6, D140): the
// offline driver's glue, its helper and model acquisition. esbuild builds
// this file into dist/voiceLinux.js, which `voiceLinuxLoader` requires on
// the first Linux recording, so the download machinery stays out of
// dist/voice.js; finding the helper (whether the microphone is offered at
// all) stays at activation. Each driver receives the installed display
// table. Only types come from the drivers' side elsewhere: a value imported
// from there would carry them back into dist/extension.js or
// dist/voice.js, which the bundle-split gate refuses.

import type { DictationHandle } from '../../core/voice/dictation'
import { LinuxDictation, type LinuxDictationDeps } from '../../core/voice/linuxDictation'
import { LinuxDictationHelper } from '../../core/voice/linuxHelper'
import { LinuxDictationModel } from '../../core/voice/linuxModel'
import type { UiText } from '../../shared/l10n/en'
import { setUiText } from '../../shared/l10n/text'
import { spawnHelper } from './voiceProcesses'

const linuxDrivers = new Set<LinuxDictation>()
export function createLinuxDictation(
  deps: Omit<LinuxDictationDeps, 'spawn'>,
  table: UiText,
  locale: string,
): DictationHandle {
  setUiText(table, locale)
  const driver = new LinuxDictation({ ...deps, spawn: spawnHelper })
  linuxDrivers.add(driver)
  return {
    start: () => {
      driver.start()
    },
    stop: () => {
      driver.stop()
    },
    dispose: () => {
      const disposal = driver.dispose()
      linuxDrivers.delete(driver)
      return disposal
    },
  }
}

export async function removeLinuxDictationModel(directory: string): Promise<void> {
  await Promise.all(
    [...linuxDrivers].map(async (driver) => {
      await driver.reset()
    }),
  )
  const never = (): Promise<boolean> => Promise.resolve(false)
  // OFF removes the helper and the model with their partial downloads alike.
  await new LinuxDictationHelper({ directory, fetch, consent: never, arch: process.arch }).remove()
  await new LinuxDictationModel({ directory, fetch, consent: never }).remove()
}
