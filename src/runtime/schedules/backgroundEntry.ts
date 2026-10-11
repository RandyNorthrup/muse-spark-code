// Native schedule IO is loaded on the first wake/maintenance, never in ACP's shim.
import type { UiText } from '../../shared/l10n/en'
import { setUiText } from '../../shared/l10n/text'
import { NativeScheduleBackground, type NativeBackgroundDeps } from './nativeBackground'
import {
  beginScheduleWake,
  nodeBackgroundFiles,
  verifyScheduleWake,
  waitForScheduleWake,
} from './nodeBackgroundIo'

export function createRuntimeScheduleBackground(table: UiText, locale: string) {
  setUiText(table, locale)
  return {
    verifyScheduleWake,
    beginScheduleWake,
    waitForScheduleWake,
    files: nodeBackgroundFiles,
    createEntry: (deps: NativeBackgroundDeps) => new NativeScheduleBackground(deps),
  }
}
