import type { countSecretMatches as count, redactSecrets as redact } from '../redact'
import { UI_TEXT } from '../../shared/constants'

export interface HardwareSecretReaders {
  readonly countSecretMatches: typeof count
  readonly redactSecrets: typeof redact
}

const state: { readers?: HardwareSecretReaders } = {}

/** The same-build caller supplies the existing shared detector, never a second pattern list. */
export function configureHardwareSecrets(value: HardwareSecretReaders): void {
  state.readers = value
}

export function countSecretMatches(...args: Parameters<typeof count>): ReturnType<typeof count> {
  if (state.readers === undefined) throw new Error(UI_TEXT.hardwareRefused)
  return state.readers.countSecretMatches(...args)
}

export function redactSecrets(...args: Parameters<typeof redact>): ReturnType<typeof redact> {
  if (state.readers === undefined) throw new Error(UI_TEXT.hardwareRefused)
  return state.readers.redactSecrets(...args)
}
