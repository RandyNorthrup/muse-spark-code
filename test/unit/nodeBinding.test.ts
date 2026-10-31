import { mkdir, rm, stat } from 'node:fs/promises'
import path from 'node:path'
import { afterEach, describe, expect } from 'vitest'
import { parseNodeArgs } from '../../src/runtime/node/args'
import { ownService, productionNodeBinding } from '../../src/runtime/node/binding'
import { runNodeArgs, runNodeCommand, type NodeCommandDeps } from '../../src/runtime/node/main'
import { NodeStateStore } from '../../src/runtime/node/state'
import { EN } from '../../src/shared/l10n/en'
import { UI_TEXT } from '../../src/shared/constants'
import { nodeNativeTest, nodeTempRoot, testPackageVersion } from './helpers/nodeNative'

const directories: string[] = []
async function setup() {
  const parent = await nodeTempRoot('m110-binding-')
  directories.push(parent)
  const root = path.join(parent, 'state')
  const workspace = path.join(parent, 'workspaces')
  await mkdir(workspace, { recursive: true })
  const lines: string[] = []
  const print = (line: string): void => {
    lines.push(line)
  }
  const deps: NodeCommandDeps = {
    root,
    signal: new AbortController().signal,
    binding: productionNodeBinding({ print, version: testPackageVersion }),
    now: () => 0,
    print,
    readSecret: () => Promise.reject(new Error('test forbids stdin use')),
  }
  return { parent, root, workspace, lines, deps }
}
function initCommand(workspaceRoot: string) {
  return parseNodeArgs([
    'init',
    '--label',
    'Home',
    '--name',
    'home.local',
    '--workspace-root',
    workspaceRoot,
  ])
}
afterEach(async () => {
  for (const dir of directories.splice(0)) await rm(dir, { recursive: true, force: true })
})

describe('M110-S0 production node binding', () => {
  nodeNativeTest('wipe removes the state root and the recorded workspace volume', async () => {
    const { root, workspace, deps } = await setup()
    expect(await runNodeCommand(initCommand(workspace), deps)).toBe(0)
    expect(await runNodeCommand(parseNodeArgs(['wipe', '--confirm-wipe']), deps)).toBe(0)
    await expect(stat(root)).rejects.toThrow()
    await expect(stat(workspace)).rejects.toThrow()
  })
  nodeNativeTest('wipe without confirmation refuses and keeps every directory', async () => {
    const { root, workspace, deps } = await setup()
    expect(await runNodeCommand(initCommand(workspace), deps)).toBe(0)
    await expect(runNodeCommand(parseNodeArgs(['wipe']), deps)).rejects.toThrow(
      UI_TEXT.nodeErrors.forbidden,
    )
    await expect(stat(path.join(root, 'state.v1.json'))).resolves.toBeDefined()
    await expect(stat(workspace)).resolves.toBeDefined()
  })
  nodeNativeTest('wipe refuses a running node and keeps every directory', async () => {
    const { root, workspace, deps } = await setup()
    expect(await runNodeCommand(initCommand(workspace), deps)).toBe(0)
    const store = new NodeStateStore(root, () => undefined)
    await store.load()
    const release = await ownService(store)
    try {
      await expect(runNodeCommand(parseNodeArgs(['wipe', '--confirm-wipe']), deps)).rejects.toThrow(
        UI_TEXT.nodeErrors.running,
      )
      await expect(stat(path.join(root, 'state.v1.json'))).resolves.toBeDefined()
      await expect(stat(workspace)).resolves.toBeDefined()
    } finally {
      await release()
    }
  })
  nodeNativeTest('wipe removes a workspace nested inside the state root', async () => {
    const { root, deps } = await setup()
    const nested = path.join(root, 'workspaces')
    expect(await runNodeCommand(initCommand(nested), deps)).toBe(0)
    expect(await runNodeCommand(parseNodeArgs(['wipe', '--confirm-wipe']), deps)).toBe(0)
    await expect(stat(root)).rejects.toThrow()
  })
  nodeNativeTest('lock and unlock say unavailable until the control transport lands', async () => {
    const { workspace, lines, deps } = await setup()
    expect(await runNodeCommand(initCommand(workspace), deps)).toBe(0)
    lines.length = 0
    expect(await runNodeArgs(['lock'], deps, EN, 'en')).toBe(1)
    expect(await runNodeArgs(['unlock'], deps, EN, 'en')).toBe(1)
    expect(lines).toEqual([UI_TEXT.nodeErrors.unavailable, UI_TEXT.nodeErrors.unavailable])
  })
  nodeNativeTest('a missing store names itself instead of a traceback', async () => {
    const { lines, deps } = await setup()
    expect(await runNodeArgs(['status'], deps, EN, 'en')).toBe(1)
    expect(lines).toEqual([UI_TEXT.nodeErrors.notFound])
  })
})
