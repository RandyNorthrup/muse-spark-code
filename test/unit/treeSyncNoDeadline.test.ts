// The POSIX tree supervisor behind runTreeSync arms no clock of ours (D121,
// owner 2026-10-16): an effect with no caller timeout runs to its own end,
// and only a timeout the caller names ends it early. The supervisor reads
// its deadline from the spec it is given; with none, `setTimeout(fn,
// undefined)` would fire at once and kill the effect, so this runs the real
// supervisor, the real /bin/sh and the real process table.
import { mkdtemp, realpath } from 'node:fs/promises'
import { realpathSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { workspaceChildEnvironment } from '../../src/core/execGuard'
import { withoutCredentials } from '../../src/core/credentialEnvironment'
import { runTreeSync } from '../../src/host/processTree'
import { removeFolder } from './helpers/temporaryFolders'

const folder = { path: '' }

function effectOptions(timeout?: number) {
  return {
    cwd: folder.path,
    env: workspaceChildEnvironment(process.platform, withoutCredentials(process.env), {
      workspaceRoot: folder.path,
      realpath: realpathSync,
    }),
    ...(timeout !== undefined && { timeout }),
  }
}

describe.skipIf(process.platform === 'win32')('runTreeSync with no deadline of ours', () => {
  beforeAll(async () => {
    folder.path = await realpath(await mkdtemp(path.join(tmpdir(), 'muse-tree-sync-')))
  })
  afterAll(() => removeFolder(folder.path))

  it('runs an effect with no caller timeout to its own end', () => {
    const result = runTreeSync('/bin/sh', ['-c', 'sleep 1.5; echo done'], effectOptions())
    expect({
      status: result.status,
      stdout: result.stdout.toString('utf8'),
      stderr: result.stderr.toString('utf8'),
    }).toEqual({ status: 0, stdout: 'done\n', stderr: '' })
  })

  it("still ends the effect at the caller's own timeout", () => {
    const result = runTreeSync('/bin/sh', ['-c', 'sleep 5; echo done'], effectOptions(300))
    expect({
      status: result.status,
      stdout: result.stdout.toString('utf8'),
      stderr: result.stderr.toString('utf8'),
    }).toEqual({ status: 1, stdout: '', stderr: 'ETIMEDOUT' })
  })
})
