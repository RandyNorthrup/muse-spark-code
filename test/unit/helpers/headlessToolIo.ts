// The standalone runtime's own ToolIo for headless unit tests (D62).
// Same wiring as src/runtime/backends.ts: the agent cannot see the
// editor's buffers, so unsavedFiles is empty and hasUnsavedChanges
// answers false through the product's own isSamePath comparison —
// never a hand-written `() => false`. Listing walks the real
// workspace, as runtime/fileWalk.ts does where VS Code is absent.
import type { ToolIo } from '../../../src/core/backends/modelapi/tools'
import { createToolIo } from '../../../src/host/backend/toolIo'
import { walkFiles } from '../../../src/runtime/fileWalk'
import type { Logger } from '../../../src/host/logger'
import { MENTION_INDEX_LIMIT } from '../../../src/shared/constants'

const silentLog: Logger = {
  trace: () => undefined,
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
}

export function headlessToolIo(workspaceRoot: string): ToolIo {
  return createToolIo({
    platform: process.platform,
    listFiles: (signal) => walkFiles(workspaceRoot, MENTION_INDEX_LIMIT, silentLog, signal),
    workspaceRoot,
    systemRoot: process.env['SystemRoot'],
    env: () => process.env,
    searchWorkerPath: '',
    log: () => undefined,
    // src/runtime/backends.ts: the agent cannot see the editor's
    // buffers (D62); the client's fs/* will (M63c).
    unsavedFiles: () => [],
  })
}
