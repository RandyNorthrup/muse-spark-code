import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { DESKTOP_PLACEMENT_DEFAULT, DESKTOP_THUMBNAIL_FPS } from '../../../src/shared/constants'
import {
  DESKTOP_TOOLS,
  compositorEventSchema,
  desktopBindingSchema,
  desktopInfoSchema,
  desktopKeybindingSchema,
  desktopMergeArgsSchema,
  desktopOpenArgsSchema,
  desktopOwnerSchema,
  desktopSendArgsSchema,
  effectivePlacement,
  fullscreenModeSchema,
  healthSchema,
  inputDeviceSchema,
  judgeDesktopTool,
  keyboardLayoutCommandSchema,
  layoutSchema,
  monitorInfoSchema,
  monitorSpecSchema,
  ownerLabel,
  shouldAskPlacement,
  placementSchema,
  canCaptureThumbnail,
  windowInfoSchema,
  windowSelectorSchema,
  workspaceBindingsSchema,
  type DesktopOwner,
} from '../../../src/shared/desktop/compositor'

const here = path.dirname(fileURLToPath(import.meta.url))
const repoRoot = path.resolve(here, '..', '..', '..')

describe('placement', () => {
  it('opens on a new desktop when the person never chose', () => {
    expect(DESKTOP_PLACEMENT_DEFAULT).toBe('new-desktop')
    expect(effectivePlacement(undefined)).toBe('new-desktop')
    expect(shouldAskPlacement(undefined)).toBe(false)
  })

  it('honours current-desktop and ask', () => {
    expect(effectivePlacement('current-desktop')).toBe('current-desktop')
    expect(shouldAskPlacement('current-desktop')).toBe(false)
    expect(effectivePlacement('ask')).toBe('ask')
    expect(shouldAskPlacement('ask')).toBe(true)
  })

  it('rejects unknown placements', () => {
    expect(placementSchema.safeParse('sideways').success).toBe(false)
  })
})

describe('desktop ownership', () => {
  const agent: DesktopOwner = { type: 'agent', name: 'fix' }
  const other: DesktopOwner = { type: 'agent', name: 'other' }
  const user: DesktopOwner = { type: 'user' }

  it('labels agents and sessions, never the user', () => {
    expect(ownerLabel(agent)).toBe('fix')
    expect(ownerLabel({ type: 'session', name: 's1' })).toBe('s1')
    expect(ownerLabel(user)).toBeUndefined()
  })

  it('lets an agent rearrange its own desktops freely', () => {
    expect(
      judgeDesktopTool(
        [
          { desktop: '2', owner: agent },
          { desktop: '4', owner: { type: 'agent', name: 'fix' } },
        ],
        agent,
      ),
    ).toBe('allow')
  })

  it('asks before touching any other desktop', () => {
    expect(judgeDesktopTool([{ desktop: '1', owner: user }], agent)).toBe('ask')
    expect(judgeDesktopTool([{ desktop: '3', owner: other }], agent)).toBe('ask')
    expect(
      judgeDesktopTool(
        [
          { desktop: '2', owner: agent },
          { desktop: '3', owner: other },
        ],
        agent,
      ),
    ).toBe('ask')
  })

  it('fails closed when ownership is unknown', () => {
    expect(judgeDesktopTool([{ desktop: '5', owner: undefined }], agent)).toBe('ask')
    expect(judgeDesktopTool([], agent)).toBe('allow')
  })

  it('rejects nameless owners', () => {
    expect(desktopOwnerSchema.safeParse({ type: 'agent', name: '' }).success).toBe(false)
    expect(desktopOwnerSchema.safeParse({ type: 'pet' }).success).toBe(false)
  })
})

describe('thumbnail gate', () => {
  it('pauses unless the governor reports normal pressure', () => {
    for (const level of ['throttle', 'relocate', 'pause'] as const) {
      expect(canCaptureThumbnail(level, undefined, 0)).toBe(false)
      expect(canCaptureThumbnail(level, 0, 10_000)).toBe(false)
    }
    expect(canCaptureThumbnail('normal', undefined, 0)).toBe(true)
  })

  it('holds the frame rate and never hurries a backwards clock', () => {
    const frameMs = 1000 / DESKTOP_THUMBNAIL_FPS
    expect(canCaptureThumbnail('normal', 0, frameMs)).toBe(true)
    expect(canCaptureThumbnail('normal', 0, frameMs - 1)).toBe(false)
    expect(canCaptureThumbnail('normal', 500, 100)).toBe(false)
  })

  it('keeps the Rust and TypeScript frame rates identical', () => {
    const port = readFileSync(
      path.join(repoRoot, 'desktop', 'crates', 'compositor', 'src', 'port.rs'),
      'utf8',
    )
    const match = /pub const THUMBNAIL_FPS: u32 = (\d+);/.exec(port)
    expect(match?.[1]).toBe(String(DESKTOP_THUMBNAIL_FPS))
  })
})

describe('desktop tools', () => {
  it('fixes the three tool names', () => {
    expect(DESKTOP_TOOLS).toEqual({
      open: 'desktop_open',
      send: 'desktop_send',
      merge: 'desktop_merge',
    })
  })

  it('takes a command with an optional desktop and focus', () => {
    expect(desktopOpenArgsSchema.parse({ command: 'foot' })).toEqual({ command: 'foot' })
    expect(desktopOpenArgsSchema.parse({ command: 'foot', desktop: '2', focus: false })).toEqual({
      command: 'foot',
      desktop: '2',
      focus: false,
    })
    expect(desktopOpenArgsSchema.safeParse({ command: '' }).success).toBe(false)
    expect(desktopOpenArgsSchema.safeParse({ command: 'foot', desktop: '' }).success).toBe(false)
  })

  it('sends a neutral window selector, never compositor syntax', () => {
    expect(desktopSendArgsSchema.parse({ window: { kind: 'active' } })).toEqual({
      window: { kind: 'active' },
    })
    expect(
      desktopSendArgsSchema.parse({ window: { kind: 'class', value: 'foot' }, desktop: '2' }),
    ).toEqual({ window: { kind: 'class', value: 'foot' }, desktop: '2' })
    expect(desktopSendArgsSchema.safeParse({ window: { kind: 'class', value: '' } }).success).toBe(
      false,
    )
    expect(desktopSendArgsSchema.safeParse({ window: 'class:foot' }).success).toBe(false)
  })

  it('merges two named desktops', () => {
    expect(desktopMergeArgsSchema.parse({ source: '2', target: '1' })).toEqual({
      source: '2',
      target: '1',
    })
    expect(desktopMergeArgsSchema.safeParse({ source: '', target: '1' }).success).toBe(false)
  })
})

describe('port shapes', () => {
  it('parses a desktop, a window and a monitor', () => {
    expect(
      desktopInfoSchema.parse({
        id: 2,
        name: 'agent:fix',
        monitor: 'HEADLESS-1',
        monitorId: 0,
        windows: 1,
        fullscreen: false,
        lastWindow: '0x1',
      }).name,
    ).toBe('agent:fix')
    expect(
      windowInfoSchema.parse({
        address: '0x1',
        class: 'foot',
        title: 'shell',
        pid: 100,
        desktopId: 2,
        desktopName: 'agent:fix',
        floating: false,
        fullscreen: false,
        pinned: false,
        monitor: 'HEADLESS-1',
      }).class,
    ).toBe('foot')
    expect(
      monitorInfoSchema.parse({
        id: 0,
        name: 'HEADLESS-1',
        description: '',
        width: 1920,
        height: 1080,
        refreshRate: 60,
        x: 0,
        y: 0,
        scale: 1,
        activeDesktop: 1,
      }).name,
    ).toBe('HEADLESS-1')
  })

  it('rejects unknown keys on the port shapes', () => {
    expect(
      desktopInfoSchema.safeParse({
        id: 1,
        name: '1',
        monitor: 'm',
        monitorId: 0,
        windows: 0,
        fullscreen: false,
        lastWindow: '',
        layout: 'dwindle',
      }).success,
    ).toBe(false)
  })

  it('parses layouts, input, fullscreen, bindings and health', () => {
    expect(layoutSchema.parse('dwindle')).toBe('dwindle')
    expect(layoutSchema.parse({ custom: 'tiling' })).toEqual({ custom: 'tiling' })
    expect(layoutSchema.safeParse('spiral').success).toBe(false)
    expect(
      inputDeviceSchema.parse({ name: 'kb', kind: 'keyboard', layout: 'English (US)' }).layout,
    ).toBe('English (US)')
    expect(fullscreenModeSchema.parse('maximize')).toBe('maximize')
    expect(keyboardLayoutCommandSchema.parse({ command: 'next' })).toEqual({ command: 'next' })
    expect(keyboardLayoutCommandSchema.parse({ command: 'index', index: 2 })).toEqual({
      command: 'index',
      index: 2,
    })
    expect(desktopBindingSchema.parse({ desktop: '2', project: '/home/person/proj' }).project).toBe(
      '/home/person/proj',
    )
    expect(healthSchema.parse({ version: 'Hyprland 0.57.0', pingMs: 1 }).pingMs).toBe(1)
    expect(
      monitorSpecSchema.parse({ output: 'DP-1', mode: 'preferred', position: 'auto', scale: 1 })
        .output,
    ).toBe('DP-1')
    expect(windowSelectorSchema.parse({ kind: 'address', value: '0x1' })).toEqual({
      kind: 'address',
      value: '0x1',
    })
  })

  it('keeps project bindings on absolute paths', () => {
    expect(workspaceBindingsSchema.parse({ 2: '/home/person/proj' })).toEqual({
      2: '/home/person/proj',
    })
    expect(workspaceBindingsSchema.safeParse({ 2: 'relative/path' }).success).toBe(false)
  })

  it('parses a key table row for the desktop only', () => {
    expect(
      desktopKeybindingSchema.parse({
        binding: 'SUPER + 1',
        action: 'desktop.switch',
        command: 'hl.dsp.focus({ workspace = "1" })',
        applies: 'desktop',
      }).action,
    ).toBe('desktop.switch')
    expect(
      desktopKeybindingSchema.safeParse({
        binding: 'SUPER + 1',
        action: 'desktop.switch',
        command: 'hl.dsp.focus({ workspace = "1" })',
        applies: 'editor',
      }).success,
    ).toBe(false)
  })

  it('carries unknown events as they came', () => {
    expect(
      compositorEventSchema.parse({ type: 'unknown', name: 'tomorrow', data: 'x>>y' }),
    ).toEqual({ type: 'unknown', name: 'tomorrow', data: 'x>>y' })
    expect(compositorEventSchema.parse({ type: 'window-closed', address: '0x1' })).toEqual({
      type: 'window-closed',
      address: '0x1',
    })
  })
})
