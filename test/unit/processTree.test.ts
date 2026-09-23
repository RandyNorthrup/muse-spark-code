// The tree kill (D25) against real processes: a shell that starts a child
// and waits, killed as a whole; and the no-op on a process already gone.

import { spawn } from 'node:child_process'
import { describe, expect, it } from 'vitest'
import { killTree, treeSpawnOptions } from '../../src/host/processTree'

const deps = {
  platform: process.platform,
  systemRoot: process.env['SystemRoot'],
  log: () => undefined,
}

function shellWithChild(): ReturnType<typeof spawn> {
  // A parent whose own child keeps the output pipe open for 30 s.
  return process.platform === 'win32'
    ? spawn(
        'powershell.exe',
        ['-NoProfile', '-NonInteractive', '-Command', 'ping -n 30 127.0.0.1; Start-Sleep 30'],
        { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'], ...treeSpawnOptions('win32') },
      )
    : spawn('/bin/sh', ['-c', 'sleep 30 & sleep 30'], {
        stdio: ['ignore', 'pipe', 'pipe'],
        ...treeSpawnOptions(process.platform),
      })
}

describe('killTree', () => {
  it('ends the shell and the child holding its output, so the pipes close', async () => {
    const child = shellWithChild()
    child.stdout?.resume()
    child.stderr?.resume()
    const closed = new Promise<void>((resolve) => {
      child.on('close', () => {
        resolve()
      })
    })
    await new Promise((resolve) => {
      setTimeout(resolve, 500)
    })
    const started = Date.now()
    killTree(child, deps)
    await closed
    // Killing only the shell would leave the pipes open for the child's 30 s.
    expect(Date.now() - started).toBeLessThan(15_000)
  }, 60_000)

  it('does nothing to a process that has exited', async () => {
    const child = spawn(process.execPath, ['-e', ''], { stdio: 'ignore' })
    await new Promise((resolve) => {
      child.on('exit', resolve)
    })
    const logged: string[] = []
    killTree(child, {
      ...deps,
      log: (message) => {
        logged.push(message)
      },
    })
    expect(logged).toEqual([])
  })

  it('makes the command a group leader on POSIX only', () => {
    expect(treeSpawnOptions('linux')).toEqual({ detached: true })
    expect(treeSpawnOptions('darwin')).toEqual({ detached: true })
    expect(treeSpawnOptions('win32')).toEqual({ detached: false })
  })
})
