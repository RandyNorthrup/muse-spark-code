import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import * as fs from 'node:fs'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createHardwareContexts, readHardwareInventory } from '../../src/core/maker/hardwareContext'
import { SessionHardwareGuard } from '../../src/core/maker/sessionGuard'
import type { HardwareContext } from '../../src/core/maker/guard/httpCommands'
import { UI_TEXT } from '../../src/shared/constants'

const roots: string[] = []
vi.mock('node:fs', { spy: true })
afterEach(() => {
  vi.resetAllMocks()
  vi.restoreAllMocks()
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

it.each(['directoryEntry', 'replacementAtOpen'])(
  'Design 5 review P2.5 special marker file cannot block scanning: %s',
  (scenario) => {
    const root = workspace()
    const marker = path.join(root, 'pipe.yaml')
    writeFileSync(marker, '')
    const open = vi.spyOn(fs, 'openSync')
    const read = vi.spyOn(fs, 'readSync')
    if (scenario === 'directoryEntry') {
      const folder = fs.opendirSync(root)
      const entry = folder.readSync()
      if (entry === null) throw new Error('Missing simulated marker')
      vi.spyOn(entry, 'isFile').mockReturnValue(false)
      vi.spyOn(folder, 'readSync').mockReturnValueOnce(entry).mockReturnValue(null)
      vi.spyOn(fs, 'opendirSync').mockReturnValue(folder)
    } else {
      const stat = fs.statSync(marker)
      vi.spyOn(stat, 'isFile').mockReturnValue(false)
      vi.spyOn(fs, 'fstatSync').mockReturnValue(stat)
    }
    const owner = createHardwareContexts(() => ({}))(root)
    expect(owner.current().isHardwareWorkspace).toBe(true)
    expect(read).not.toHaveBeenCalled()
    if (scenario === 'directoryEntry') expect(open).not.toHaveBeenCalled()
    else
      expect(open).toHaveBeenCalledWith(
        marker,
        fs.constants.O_RDONLY | fs.constants.O_NONBLOCK | fs.constants.O_NOFOLLOW,
      )
  },
)
function workspace() {
  const root = mkdtempSync(path.join(tmpdir(), 'muse-owner-'))
  roots.push(root)
  return root
}
function guard(source: () => HardwareContext) {
  return new SessionHardwareGuard(
    source,
    () => undefined,
    () => undefined,
  )
}

describe('single composition-root hardware owner', () => {
  it('all injected sessions see connected/registered inventory and the same irreversible latch', () => {
    let inventory: HardwareContext = {}
    const contexts = createHardwareContexts(() => inventory)
    const owner = contexts(workspace())
    const first = guard(() => owner.current())
    const second = guard(() => owner.current())
    try {
      expect(first.current().isHardwareWorkspace).toBe(false)
      inventory = { targets: [{ address: 'https://simulator.local', usbSerial: 'sim-one' }] }
      expect(second.current().isHardwareWorkspace).toBe(true)
      inventory = {}
      expect(first.current().isHardwareWorkspace).toBe(true)
      const release = second.beginCommand()
      expect(() => {
        first.turnOffFromHostUI()
      }).toThrow(UI_TEXT.hardwareRefused)
      release()
      first.turnOffFromHostUI()
      expect(second.current().isHardwareWorkspace).toBe(false)
    } finally {
      first.dispose()
      second.dispose()
    }
  })
  it('a new session detects markers added after composition-root creation', () => {
    const root = workspace()
    const owner = createHardwareContexts(() => ({}))(root)
    expect(owner.current().isHardwareWorkspace).toBe(false)
    writeFileSync(path.join(root, 'printer.cfg'), '[printer]')
    owner.startSession()
    expect(owner.current().isHardwareWorkspace).toBe(true)
  })
  it('Windows separators share one owner instead of separate latches', () => {
    const contexts = createHardwareContexts(() => ({ hardwareSessionLatched: false }))
    expect(contexts(String.raw`C:\boards\fixture`)).toBe(contexts('C:/boards/fixture'))
  })
})

it('native inventory simulator detects connected ports, replacement generations and mounted boards', () => {
  const devices = workspace()
  const mounts = workspace()
  const port = path.join(devices, 'cu.usbmodem-simulator')
  writeFileSync(port, '')
  mkdirSync(path.join(mounts, 'CIRCUITPY'))
  const before = readHardwareInventory('darwin', devices, [mounts])
  expect(before.hasConnectedBoard).toBe(true)
  expect(before.boardRoots).toEqual([path.join(mounts, 'CIRCUITPY')])
  expect(before.targets?.[0]?.address).toBe(port)
  rmSync(port)
  writeFileSync(port, 'replacement')
  expect(readHardwareInventory('darwin', devices, [mounts]).targets?.[0]?.connectionId).not.toBe(
    before.targets?.[0]?.connectionId,
  )
  expect(readHardwareInventory('linux', path.join(devices, 'missing'), []).hasConnectedBoard).toBe(
    true,
  )
  expect(readHardwareInventory('win32', devices, []).hasConnectedBoard).toBe(true)
})

it('unknown native inventory cannot be cleared by an idle UI reset', () => {
  const owner = createHardwareContexts(() => ({ isInventoryKnown: false }))(workspace())
  expect(owner.current().isHardwareWorkspace).toBe(true)
  expect(() => {
    owner.reset()
  }).toThrow(UI_TEXT.hardwareRefused)
})
