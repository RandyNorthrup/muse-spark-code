// The POSIX plugin tree kill signals only a live tree. A group signal to
// an exited child's pid could land on an unrelated process that reused the
// id, so the handle reports its exit and the kill refuses a dead child.
// Both proofs run real children in their own groups: one that exits at
// once, and one sleeping until the kill ends it.

import { realpathSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { afterEach, describe, expect, it } from 'vitest'
import {
  posixProcessTree,
  type PluginChildHandle,
} from '../../src/core/backends/modelapi/pluginHost'
import { noWorkspaceChildEnvironment } from '../../src/core/execGuard'
import { expectEnded, isRunning } from './helpers/processes'

function childOptions() {
  return {
    // Fixed runtime outside any workspace: the probe-style environment only
    // resolves absolute entries, never a program planted in a workspace.
    env: noWorkspaceChildEnvironment(process.platform, process.env, realpathSync),
    cwd: tmpdir(),
  }
}

describe.skipIf(process.platform === 'win32')('POSIX plugin tree kill', () => {
  const trees: PluginChildHandle[] = []
  afterEach(async () => {
    for (const child of trees.splice(0)) await posixProcessTree.killTree(child)
  })

  it('reports a real child live until its exit', async () => {
    const child = await posixProcessTree.spawn(process.execPath, ['-e', ''], childOptions())
    trees.push(child)
    expect(child.exited).toBe(false)
    await new Promise<void>((resolve) => {
      child.onClose(() => {
        resolve()
      })
    })
    expect(child.exited).toBe(true)
  })

  it('ends a live tree and refuses the exited handle afterwards', async () => {
    const child = await posixProcessTree.spawn(
      process.execPath,
      ['-e', 'setInterval(() => {}, 1000)'],
      childOptions(),
    )
    trees.push(child)
    const pid = child.pid
    if (pid === undefined) throw new Error('plugin child has no pid')
    expect(isRunning(pid)).toBe(true)
    await posixProcessTree.killTree(child)
    await expectEnded(pid)
    // The exited handle owns no group now: ending it again signals nothing.
    await posixProcessTree.killTree(child)
    expect(isRunning(pid)).toBe(false)
  })
})
