import { existsSync, readFileSync, statSync } from 'node:fs'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('node:fs', () => ({ existsSync: vi.fn(), readFileSync: vi.fn(), statSync: vi.fn() }))

const CONTENT_FILE = 'dist/whatsNew.json'
const CONTENT_BUDGET_BYTES = 40 * 1024

beforeEach(() => {
  vi.resetModules()
  existsSync.mockReturnValue(true)
  readFileSync.mockReturnValue(
    JSON.stringify({ outputs: { 'dist/webview/main.js': { imports: [] } } }),
  )
  statSync.mockImplementation((file) => ({
    size: file === CONTENT_FILE ? CONTENT_BUDGET_BYTES : 0,
  }))
  vi.spyOn(console, 'log').mockImplementation(vi.fn())
  vi.spyOn(console, 'error').mockImplementation(vi.fn())
  vi.spyOn(process, 'exit').mockImplementation((code) => {
    throw new Error(`exit ${code}`)
  })
})

afterEach(() => vi.restoreAllMocks())

describe('bundled What’s New content budget', () => {
  it('counts eager chunks against the unchanged startup cap', async () => {
    readFileSync.mockReturnValue(
      JSON.stringify({
        outputs: {
          'dist/webview/main.js': {
            imports: [{ path: 'dist/webview/chunks/eager.js', kind: 'import-statement' }],
          },
          'dist/webview/chunks/eager.js': { imports: [] },
        },
      }),
    )
    statSync.mockImplementation((file) => ({
      size: file.endsWith('eager.js') ? 900 * 1024 + 1 : 0,
    }))
    await expect(import('../../scripts/check-bundle-size.mjs')).rejects.toThrow('exit 1')
  })

  it.each([
    ['deferred JS', 50, 'src/webview/components/HistoryDialog.tsx'],
    ['question UI', 25, 'src/webview/components/ElicitationCard.tsx'],
    ['workflow details', 25, 'src/webview/components/WorkflowRun.tsx'],
    ['code highlighting', 125, 'src/webview/components/HighlightedCode.tsx'],
    ['action dialogs', 25, 'src/webview/components/ShareView.tsx'],
    ['tasks tab', 25, 'src/webview/TasksApp.tsx'],
    ['resource controls', 50, 'src/webview/resources/ResourceSurface.tsx'],
    ['resource history', 50, 'src/webview/usage/ResourcesSection.tsx'],
    ['HistoryRow', 25, 'src/webview/components/HistoryRow.tsx'],
    ['SetupBanner', 25, 'src/webview/components/SetupBanner.tsx'],
    ['tool cards', 25, 'src/webview/components/ToolBodies.tsx'],
    ['SignIn', 25, 'src/webview/components/SignIn.tsx'],
    ['GoalPanel', 25, 'src/webview/components/GoalPanel.tsx'],
    ['SchedulePanel', 25, 'src/webview/components/SchedulePanel.tsx'],
    ['Palette', 25, 'src/webview/components/Palette.tsx'],
    ['PopoverMenu', 25, 'src/webview/components/PopoverMenu.tsx'],
    ['GooeyMenuContent', 25, 'src/webview/components/GooeyMenuContent.tsx'],
    ['UsageDialogContent', 25, 'src/webview/components/UsageDialogContent.tsx'],
    ['AgentMapContent', 25, 'src/webview/components/AgentMapContent.tsx'],
  ])(
    'enforces the %s cap without widening the original deferred allowance',
    async (name, cap, entryPoint) => {
      const chunk = 'dist/webview/chunks/optional.js'
      readFileSync.mockReturnValue(
        JSON.stringify({
          outputs: {
            'dist/webview/main.js': { imports: [{ path: chunk, kind: 'dynamic-import' }] },
            [chunk]: { imports: [], entryPoint },
          },
        }),
      )
      statSync.mockImplementation((file) => ({ size: file === chunk ? cap * 1024 : 0 }))
      await import('../../scripts/check-bundle-size.mjs')
      expect(console.log).toHaveBeenCalledWith(
        `ok   dist/webview ${name}: ${cap}.0 KiB (budget ${cap} KiB)`,
      )
      vi.resetModules()
      statSync.mockImplementation((file) => ({ size: file === chunk ? cap * 1024 + 1 : 0 }))
      await expect(import('../../scripts/check-bundle-size.mjs')).rejects.toThrow('exit 1')
    },
  )

  it.each([
    ['dist/resourceGovernor.js', 125],
    ['dist/resourceAdmission.js', 25],
    ['dist/webview/resourceSurface.js', 25],
    ['dist/webview/resourceHistory.js', 25],
    ['dist/webview/resourceHistory.css', 25],
    ['docs/schemas/exec-event-v2.schema.json', 50],
  ])('M107 refuses missing or oversized %s without widening existing caps', async (file, cap) => {
    existsSync.mockImplementation((entry) => entry !== file)
    await expect(import('../../scripts/check-bundle-size.mjs')).rejects.toThrow('exit 1')
    vi.resetModules()
    existsSync.mockReturnValue(true)
    statSync.mockImplementation((entry) => ({ size: entry === file ? cap * 1024 + 1 : 0 }))
    await expect(import('../../scripts/check-bundle-size.mjs')).rejects.toThrow('exit 1')
  })

  it.each([
    [25 * 1024, 50 * 1024, true],
    [25 * 1024 + 1, 50 * 1024, false],
    [25 * 1024, 50 * 1024 + 1, false],
  ])(
    'bounds the new preview chunk independently without widening the deferred cap (%s, %s)',
    async (previewBytes, deferredBytes, allowed) => {
      readFileSync.mockReturnValue(
        JSON.stringify({
          outputs: {
            'dist/webview/main.js': { imports: [] },
            'dist/webview/preview.js': {
              entryPoint: String.raw`src\webview\components\ToolArgumentPreview.tsx`,
              imports: [],
            },
            'dist/webview/deferred.js': { imports: [] },
          },
        }),
      )
      statSync.mockImplementation((file) => {
        if (file.endsWith('preview.js')) return { size: previewBytes }
        const size = file.endsWith('deferred.js') ? deferredBytes : 0
        return { size }
      })
      if (allowed) {
        await import('../../scripts/check-bundle-size.mjs')
        expect(process.exit).not.toHaveBeenCalled()
      } else {
        await expect(import('../../scripts/check-bundle-size.mjs')).rejects.toThrow('exit 1')
      }
    },
  )

  it('admits exactly 40 KiB of raw JSON', async () => {
    await import('../../scripts/check-bundle-size.mjs')
    expect(console.log).toHaveBeenCalledWith('ok   dist/whatsNew.json: 40.0 KiB (budget 40 KiB)')
    expect(process.exit).not.toHaveBeenCalled()
  })

  it('rejects one byte over 40 KiB', async () => {
    statSync.mockImplementation((file) => ({
      size: file === CONTENT_FILE ? CONTENT_BUDGET_BYTES + 1 : 0,
    }))
    await expect(import('../../scripts/check-bundle-size.mjs')).rejects.toThrow('exit 1')
    expect(console.log).toHaveBeenCalledWith('OVER dist/whatsNew.json: 40.0 KiB (budget 40 KiB)')
  })

  it('rejects a missing content file', async () => {
    existsSync.mockImplementation((file) => file !== CONTENT_FILE)
    await expect(import('../../scripts/check-bundle-size.mjs')).rejects.toThrow('exit 1')
    expect(console.log).toHaveBeenCalledWith('MISS dist/whatsNew.json: not built (budget 40 KiB)')
  })
})

function pacingFixture(pacingBytes, deferredBytes = 0) {
  readFileSync.mockReturnValue(
    JSON.stringify({
      outputs: {
        'dist/webview/main.js': {
          imports: [
            { path: 'dist/webview/pacing.js', kind: 'dynamic-import' },
            { path: 'dist/webview/deferred.js', kind: 'dynamic-import' },
          ],
        },
        'dist/webview/pacing.js': {
          entryPoint: String.raw`src\webview\components\ServiceStatusRow.tsx`,
          imports: [],
        },
        'dist/webview/deferred.js': {
          entryPoint: 'src/webview/components/UsageDialog.tsx',
          imports: [],
        },
      },
    }),
  )
  statSync.mockImplementation((file) => {
    if (file.endsWith('pacing.js')) return { size: pacingBytes }
    return { size: file.endsWith('deferred.js') ? deferredBytes : 0 }
  })
}

describe('M106 pacing UI budget', () => {
  it('admits exactly 25 KiB of exclusive pacing UI alongside the unchanged 50 KiB group', async () => {
    pacingFixture(25 * 1024, 50 * 1024)
    await import('../../scripts/check-bundle-size.mjs')
    expect(console.log).toHaveBeenCalledWith(
      'ok   dist/webview pacing JS: 25.0 KiB (budget 25 KiB)',
    )
    expect(process.exit).not.toHaveBeenCalled()
  })

  it('rejects one byte over the independent pacing UI budget', async () => {
    pacingFixture(25 * 1024 + 1)
    await expect(import('../../scripts/check-bundle-size.mjs')).rejects.toThrow('exit 1')
    expect(console.log).toHaveBeenCalledWith(
      'OVER dist/webview pacing JS: 25.0 KiB (budget 25 KiB)',
    )
  })

  it('keeps the original deferred group capped at 50 KiB', async () => {
    pacingFixture(1, 50 * 1024 + 1)
    await expect(import('../../scripts/check-bundle-size.mjs')).rejects.toThrow('exit 1')
    expect(console.log).toHaveBeenCalledWith(
      'OVER dist/webview deferred JS: 50.0 KiB (budget 50 KiB)',
    )
  })

  it('keeps static dependencies shared with another optional surface in the original group', async () => {
    const { webviewPacingOutputs } = await import('../../scripts/lib/webviewBundles.mjs')
    const shared = { path: 'shared.js', kind: 'import-statement' }
    expect(
      webviewPacingOutputs({
        outputs: {
          'dist/webview/main.js': { imports: [] },
          'pacing.js': {
            entryPoint: 'src/webview/components/ServiceStatusRow.tsx',
            imports: [shared],
          },
          'usage.js': { entryPoint: 'src/webview/components/UsageDialog.tsx', imports: [shared] },
          'shared.js': { imports: [] },
        },
      }),
    ).toEqual(['pacing.js'])
  })
})

it.each([
  ['dist/exec.js', 950],
  ['dist/modelApiCodeIntel.js', 100],
  ['dist/mcpPool.js', 75],
  ['dist/structuredSchema.js', 50],
])('bounds the new %s artifact at %s KiB', async (file, cap) => {
  statSync.mockImplementation((path) => ({ size: path === file ? cap * 1024 : 0 }))
  await import('../../scripts/check-bundle-size.mjs')
  expect(console.log).toHaveBeenCalledWith(`ok   ${file}: ${cap}.0 KiB (budget ${cap} KiB)`)
  vi.resetModules()
  statSync.mockImplementation((path) => ({ size: path === file ? cap * 1024 + 1 : 0 }))
  await expect(import('../../scripts/check-bundle-size.mjs')).rejects.toThrow('exit 1')
})
