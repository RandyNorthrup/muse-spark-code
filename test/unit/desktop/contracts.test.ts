import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import {
  AUTH_FACTORS,
  BAR_POPOVERS,
  COMPACT_PANES,
  DESKTOP_FRAME,
  LAUNCHER_MODES,
  LAUNCHER_RESULT_KINDS,
  LOCK_ACTIONS,
  PREVIEW_DEVICES,
  RTL_LTR_ONLY,
  SYSTEM_PROMPT_KINDS,
  TILING,
  WORKBENCH_REGIONS,
  launcherResultSchema,
  isMirroredInRtl,
  onboardingPackSchema,
  previewViewportSchema,
  type AuthFactor,
  type BarPopover,
  type LauncherMode,
  type LauncherResult,
  type LauncherResultKind,
  type LockAction,
  type OnboardingPack,
  type PreviewDevice,
  type PreviewViewport,
  type SystemPromptKind,
  type WorkbenchRegion,
} from '../../../src/shared/desktopContracts'

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..')
const museCss = readFileSync(path.join(root, 'design/tokens/generated/muse.css'), 'utf8')

describe('M111 lane 0 desktop contracts', () => {
  it('frame sizes match the generated M114 tokens', () => {
    expect(museCss).toContain(`--ms-bar-height: ${String(DESKTOP_FRAME.topBarHeightPx)}px`)
    expect(museCss).toContain(`--ms-status-height: ${String(DESKTOP_FRAME.statusBarHeightPx)}px`)
    expect(museCss).toContain(`--ms-rail-width: ${String(DESKTOP_FRAME.railWidthPx)}px`)
    expect(museCss).toContain(`--ms-rail-button-size: ${String(DESKTOP_FRAME.railButtonPx)}px`)
    expect(museCss).toContain(`--ms-rail-icon-size: ${String(DESKTOP_FRAME.railIconPx)}px`)
    expect(museCss).toContain(`--ms-motion-flip: ${String(DESKTOP_FRAME.railFlipMs)}ms`)
  })

  it('tiling names only real tokens, and the detached terminal floats (D91.13)', () => {
    for (const token of [
      TILING.windowCorner,
      TILING.innerGap,
      TILING.outerGap,
      TILING.focusedBorder,
      TILING.focusedBorderWidth,
    ]) {
      expect(museCss).toContain(`${token}:`)
    }
    expect(TILING.detachedTerminal).toBe('floating')
  })

  it('enumerations are complete and unique', () => {
    for (const list of [
      WORKBENCH_REGIONS,
      BAR_POPOVERS,
      LAUNCHER_RESULT_KINDS,
      LAUNCHER_MODES,
      AUTH_FACTORS,
      LOCK_ACTIONS,
      SYSTEM_PROMPT_KINDS,
      RTL_LTR_ONLY,
    ]) {
      expect(new Set(list).size).toBe(list.length)
      expect(list.length).toBeGreaterThan(1)
    }
    expect(COMPACT_PANES.chatWidthPx).toBeLessThan(COMPACT_PANES.sidebarWidthPx + 200)
    const region: WorkbenchRegion = WORKBENCH_REGIONS[0]
    const popover: BarPopover = BAR_POPOVERS[0]
    const mode: LauncherMode = LAUNCHER_MODES[0]
    const factor: AuthFactor = AUTH_FACTORS[0]
    const action: LockAction = LOCK_ACTIONS[0]
    const prompt: SystemPromptKind = SYSTEM_PROMPT_KINDS[0]
    expect([region, popover, mode, factor, action, prompt].every((v) => v.length > 0)).toBe(true)
  })

  it('schemas accept the mockups shapes and reject unknown fields', () => {
    const result: LauncherResult = launcherResultSchema.parse({
      kind: 'calculation',
      id: 'calc-1',
      title: '7.456 mi',
    })
    const kind: LauncherResultKind = result.kind
    expect(kind).toBe('calculation')
    expect(() =>
      launcherResultSchema.parse({ kind: 'app', id: 'a', title: 'A', extra: 1 }),
    ).toThrow()
    expect(() => launcherResultSchema.parse({ kind: 'nope', id: 'a', title: 'A' })).toThrow()
    const pack: OnboardingPack = {
      id: 'web',
      name: 'Web development',
      version: '1.0.0',
      downloadBytes: 704_000_000,
      diskBytes: 2_100_000_000,
      licences: ['MIT'],
      recommended: true,
    }
    expect(onboardingPackSchema.parse(pack)).toEqual(pack)
    expect(() => onboardingPackSchema.parse({ ...pack, downloadBytes: -1 })).toThrow()
    for (const device of PREVIEW_DEVICES) {
      const preset: PreviewDevice = device
      const viewport: PreviewViewport = previewViewportSchema.parse({
        deviceId: preset.id,
        widthPx: preset.widthPx,
        heightPx: preset.heightPx,
      })
      expect(viewport.deviceId).toBe(preset.id)
    }
  })

  it('pseudo-RTL mirrors UI strings only', () => {
    expect(isMirroredInRtl('ui-string')).toBe(true)
    for (const kind of RTL_LTR_ONLY) expect(isMirroredInRtl(kind)).toBe(false)
  })
})
