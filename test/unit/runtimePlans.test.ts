// Saved plans in the runtime panel (M104 lane B): int's own plan store over
// `.agents/plans/` of a real workspace folder, its Markdown reader from the
// shared production build, and the editor over a real MHP connection. A save
// publishes only while the workspace is still trusted and the conversation
// still held, as VS Code's workspace-action guard holds its plan writes.
import { mkdir, readdir, realpath } from 'node:fs/promises'
import path from 'node:path'
import { beforeAll, describe, expect, inject, it } from 'vitest'
import { createRuntimePlans } from '../../src/runtime/features/plans'
import { stderrLogger } from '../../src/runtime/stderrLog'
import { connectedWire } from './helpers/panelWire'
import { fileRoots } from './helpers/tempDirs'
import { assertCurrentProductionBuild } from './productionBuild'

const ROOT = process.cwd()
const roots = fileRoots()
const folders = { workspace: '' }

beforeAll(async () => {
  assertCurrentProductionBuild(inject('productionBuildGeneration'), ROOT)
  folders.workspace = path.join(await realpath(await roots.fresh('muse-plans-')), 'workspace')
  await mkdir(folders.workspace, { recursive: true })
})

describe('saved plans in the runtime panel', () => {
  it('publishes a save only while the workspace is trusted and the conversation held', async () => {
    const { connection } = await connectedWire(['lifecycle', 'ui'])
    const ending = new AbortController()
    let isTrusted = true
    const plans = createRuntimePlans({
      host: connection,
      workspaceRoot: folders.workspace,
      platform: process.platform,
      distDir: path.join(ROOT, 'dist'),
      confirm: async (title, message, action) =>
        (await connection.request('ui/confirm', {
          title,
          message,
          choices: [{ id: 1, title: action }],
        })) === 1,
      isTrusted: () => isTrusted,
      signal: ending.signal,
      log: stderrLogger(() => undefined, 'warn'),
    })
    const first = await plans.save({
      title: 'First plan',
      savedAt: new Date(0),
      text: '# First plan\n\n1. Begin\n',
    })
    expect(first.isNew).toBe(true)
    expect(await plans.has(first.fileName)).toBe(true)
    // Trust withdrawn after the person's yes (the controller rechecked
    // before the save): the write itself still refuses, and nothing lands.
    isTrusted = false
    await expect(
      plans.save({
        title: 'Second plan',
        savedAt: new Date(1),
        text: '# Second plan\n\n1. Continue\n',
      }),
    ).rejects.toThrow()
    // What landed on disk is the first plan alone (a list through the store
    // would itself refuse while untrusted, as VS Code's guard makes it).
    const savedFiles = async () => {
      const names = await readdir(path.join(folders.workspace, '.agents', 'plans'))
      return names.filter((name) => name.endsWith('.md'))
    }
    expect(await savedFiles()).toEqual([first.fileName])
    // A conversation let go likewise publishes nothing.
    isTrusted = true
    ending.abort()
    await expect(
      plans.save({
        title: 'Third plan',
        savedAt: new Date(2),
        text: '# Third plan\n\n1. Finish\n',
      }),
    ).rejects.toThrow()
    expect(await savedFiles()).toEqual([first.fileName])
  })
})
