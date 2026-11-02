// The product's own ToolIo construction for integration suites, wired as
// src/extension.ts wires it: real files, real editor dirt, the file
// walker's mention index. Shared so every suite builds the same io.
import * as vscode from 'vscode'
import type { ToolIo } from '../../../src/core/backends/modelapi/tools'
import { createToolIo } from '../../../src/host/backend/toolIo'
import type { Logger } from '../../../src/host/logger'
import { walkFiles } from '../../../src/runtime/fileWalk'
import { MENTION_INDEX_LIMIT } from '../../../src/shared/constants'

export function createIntegrationToolIo(workspaceRoot: string, log: Logger): ToolIo {
  return createToolIo({
    platform: process.platform,
    listFiles: (signal) => walkFiles(workspaceRoot, MENTION_INDEX_LIMIT, log, signal),
    workspaceRoot,
    systemRoot: process.env['SystemRoot'],
    env: () => process.env,
    searchWorkerPath: '',
    log: () => undefined,
    unsavedFiles: () =>
      vscode.workspace.textDocuments
        .filter((document) => document.isDirty && document.uri.scheme === 'file')
        .map((document) => document.uri.fsPath),
  })
}
