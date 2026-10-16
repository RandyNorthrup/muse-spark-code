// What the MCP tests share (M50): the fake stdio server's path, and the
// actual executable for real Windows fixture processes.

import { fileURLToPath } from 'node:url'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { mcpJobExecutable } from '../../../src/host/backend/mcpJobExecutable'
import { removeFolder } from './temporaryFolders'
import { readJobSource } from './jobSource'
import { runProgram } from '../../../src/host/processTree'

export const FAKE_MCP_SERVER = fileURLToPath(new URL('fakeMcpServer.mjs', import.meta.url))

/** The actual M50 executable for real Windows fixture processes, isolated per test file. */
async function fixtureMcpJobExecutable(): Promise<{
  readonly path: string | undefined
  readonly dispose: () => Promise<void>
}> {
  if (process.platform !== 'win32') {
    return { path: undefined, dispose: () => Promise.resolve() }
  }
  const storageDir = await mkdtemp(path.join(tmpdir(), 'muse-mcp-job-test-'))
  try {
    const executable = await mcpJobExecutable({
      // This fixture tests compiled-job containment; bootstrap admission has its own suite.
      run: runProgram,
      readJobSource,
      storageDir,
      systemRoot: process.env['SystemRoot'] ?? '',
      log: (message) => {
        throw new Error(message)
      },
    })()
    if (executable === undefined) {
      throw new Error('Windows MCP job executable was unavailable in the real fixture')
    }
    return { path: executable, dispose: () => removeFolder(storageDir) }
  } catch (error: unknown) {
    await removeFolder(storageDir)
    throw error
  }
}

/** Each real-process test file owns one executable and its cleanup. */
export function fixtureJobLifecycle() {
  const state: { path: string | undefined; dispose: () => Promise<void> } = {
    path: undefined,
    dispose: () => Promise.resolve(),
  }
  return {
    get path(): string | undefined {
      return state.path
    },
    async setup(): Promise<void> {
      const job = await fixtureMcpJobExecutable()
      state.path = job.path
      state.dispose = job.dispose
    },
    dispose: () => state.dispose(),
  }
}
