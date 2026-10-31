// The native conformance drivers (RLF-M104GL): the checkpoint driver
// restores through the production runtime adapter on both backends, the
// hunks driver settles the second hunk through the production edit review,
// and runDriver runs a driver as a bundled child with fixed-word refusals.
// Real store, real git, real files; the child assertions run the real
// bundler and the real node.
import { randomUUID } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, realpathSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { runCheckpointDriver } from './hostDrivers/checkpoint'
import { runHunksDriver } from './hostDrivers/hunks'
import { runSettingsDriver } from './hostDrivers/settings'
import { captureLog } from './helpers/captureLog'
import { removeFolder } from './helpers/temporaryFolders'

const testDirectory = path.dirname(fileURLToPath(import.meta.url))
const runDriver = path.join(testDirectory, 'hostDrivers', 'runDriver.mjs')

function makeScope(prefix: string): { scope: string; workspace: string; data: string } {
  const scope = realpathSync(mkdtempSync(path.join(tmpdir(), prefix)))
  const workspace = path.join(scope, 'workspace')
  const data = path.join(scope, 'data')
  mkdirSync(workspace, { recursive: true })
  mkdirSync(data, { recursive: true })
  return { scope, workspace, data }
}

describe('native conformance drivers', () => {
  it('checkpoint restores the recorded turn on modelApi', async () => {
    const { scope, workspace, data } = makeScope('muse-driver-checkpoint-')
    try {
      const { logger, lines } = captureLog()
      const observed = await runCheckpointDriver(
        { workspaceRoot: workspace, dataRoot: data, sessionId: randomUUID(), backend: 'modelApi' },
        logger,
      )
      expect(observed).toEqual({ text: 'original', checkpoints: 1 })
      expect(lines).toEqual([])
    } finally {
      await removeFolder(scope)
    }
  })

  it('checkpoint reports the product refusal on museCode', async () => {
    const { scope, workspace, data } = makeScope('muse-driver-checkpoint-')
    try {
      const { logger } = captureLog()
      await expect(
        runCheckpointDriver(
          {
            workspaceRoot: workspace,
            dataRoot: data,
            sessionId: randomUUID(),
            backend: 'museCode',
          },
          logger,
        ),
      ).rejects.toThrow('the checkpoint restore reported incomplete')
    } finally {
      await removeFolder(scope)
    }
  })

  it('hunks settles the second hunk through the production edit review', async () => {
    const { scope, workspace } = makeScope('muse-driver-hunks-')
    try {
      // The native side's saved forward edit, as its documents leave it.
      writeFileSync(path.join(workspace, 'lines.txt'), 'l1c\nl2c\nl3\n')
      const { logger, lines } = captureLog()
      const observed = await runHunksDriver({ workspaceRoot: workspace }, logger)
      expect(observed).toEqual({ hunks: { one: 'accept', two: 'reject' }, text: 'l1c\nl2\nl3\n' })
      expect(lines).toEqual(['info Reverted hunk 2 of Muse edit m104gl-diff-hunks on lines.txt'])
    } finally {
      await removeFolder(scope)
    }
  })

  it('settings writes and reads back through the production settings store', async () => {
    const { scope, workspace, data } = makeScope('muse-driver-settings-')
    try {
      const observed = await runSettingsDriver({ workspaceRoot: workspace, dataRoot: data })
      expect(observed).toEqual({ settingValue: 5 })
    } finally {
      await removeFolder(scope)
    }
  })

  it('runDriver runs the checkpoint driver as a bundled child', async () => {
    const { scope, workspace, data } = makeScope('muse-driver-child-')
    try {
      const ran = spawnSync(
        process.execPath,
        [
          runDriver,
          'checkpoint',
          JSON.stringify({
            workspaceRoot: workspace,
            dataRoot: data,
            sessionId: randomUUID(),
            backend: 'modelApi',
          }),
        ],
        { encoding: 'utf8', timeout: 120_000 },
      )
      expect(ran.error).toBeUndefined()
      expect(ran.status).toBe(0)
      expect(JSON.parse(ran.stdout)).toEqual({ text: 'original', checkpoints: 1 })
    } finally {
      await removeFolder(scope)
    }
  })

  it('runDriver refuses a bad driver and malformed arguments with its fixed word', () => {
    const badDriver = spawnSync(process.execPath, [runDriver, 'nope', '{}'], {
      encoding: 'utf8',
      timeout: 120_000,
    })
    expect(badDriver.status).toBe(2)
    expect(badDriver.stdout).toBe('')
    expect(badDriver.stderr.trim()).toBe('MHP_CONFORMANCE_DRIVER_FAILED')
    const badArgs = spawnSync(process.execPath, [runDriver, 'checkpoint', '{oops'], {
      encoding: 'utf8',
      timeout: 120_000,
    })
    expect(badArgs.status).toBe(2)
    expect(badArgs.stdout).toBe('')
    expect(badArgs.stderr.trim()).toBe('MHP_CONFORMANCE_DRIVER_FAILED')
  })
})
