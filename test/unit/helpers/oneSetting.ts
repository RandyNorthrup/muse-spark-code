// One setting read through the real settings reader, every other key
// unset and the log quiet. Shared by the single-setting suites so they
// cannot drift apart.
import { readSettings, type ExtensionSettings } from '../../../src/host/settings'

const quietLog = {
  trace: () => undefined,
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
}

export function readOneSetting<K extends keyof ExtensionSettings>(
  key: K,
  value: unknown,
): ExtensionSettings[K] {
  return readSettings({ get: (name: string) => (name === key ? value : undefined) }, quietLog)[key]
}
