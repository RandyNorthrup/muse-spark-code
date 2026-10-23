import {
  HOOK_FORBIDDEN_ENV_NAMES,
  IDE_MCP_TOKEN_BYTES,
  MHP,
  MHP_PANEL,
  RUNTIME_PANEL,
  XCODE_HOST,
  XCODE_MODEL_TEXT,
} from '../../../src/shared/constants'
import { EN } from '../../../src/shared/l10n/en'
export { escapeHtml } from '../../../src/host/whatsNew/whatsNewHtml'

export const nativeTables = {
  limits: { ...XCODE_HOST, companionCodeBytes: IDE_MCP_TOKEN_BYTES },
  modelText: XCODE_MODEL_TEXT,
  forbidden: [...HOOK_FORBIDDEN_ENV_NAMES],
  english: EN,
  mhp: {
    ...MHP,
    ...MHP_PANEL,
    requestTimeoutMs: RUNTIME_PANEL.requestTimeoutMs,
  },
}
