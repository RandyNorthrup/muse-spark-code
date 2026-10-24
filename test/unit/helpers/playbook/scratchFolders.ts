// A scratch workspace/data pair for the playbook suites that run the real
// policy over a real file journal, removed when the test finishes. Shared
// so the suites cannot drift apart.
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { onTestFinished } from 'vitest'

export function scratchFolders(prefix: string): {
  readonly workspaceFolder: string
  readonly agentDataFolder: string
} {
  const directory = mkdtempSync(path.join(tmpdir(), prefix))
  onTestFinished(() => {
    rmSync(directory, { recursive: true, force: true })
  })
  const workspaceFolder = path.join(directory, 'workspace')
  mkdirSync(workspaceFolder, { recursive: true })
  return { workspaceFolder, agentDataFolder: path.join(directory, 'data') }
}
