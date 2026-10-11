// M126 F9: the VS Code composer answers /playbook from the journal, never
// with a model turn. The bundle is the journal bundle's real grammar and
// runner through the fixture port; only the file-backed surface is observed.
import { describe, expect, it, vi } from 'vitest'
import { EN } from '../../src/shared/l10n/en'
import { BASE_LOCALE, setUiText, UI_TEXT } from '../../src/shared/l10n/text'
import { parsePlaybookCommand, runPlaybookCommand } from '../../src/runtime/playbook/command'
import { answerPlaybookCommand, type PlaybookSource } from '../../src/host/playbook/playbookAnswer'
import { surfacePort } from './playbookSurfaceFixtures'
import { FakeLogOutputChannel } from './helpers/fakes'

function setup(overrides?: Partial<PlaybookSource>) {
  setUiText(EN, BASE_LOCALE)
  const surfaces: { agentDataFolder: string; workspaceFolder: string }[] = []
  const log = new FakeLogOutputChannel()
  const loadBundle = vi.fn(() => ({
    parsePlaybookCommand,
    createPlaybookSurface: (surfaceDeps: { agentDataFolder: string; workspaceFolder: string }) => {
      surfaces.push({
        agentDataFolder: surfaceDeps.agentDataFolder,
        workspaceFolder: surfaceDeps.workspaceFolder,
      })
      return surfacePort()
    },
    runPlaybookCommand,
    runPlaybookCli: () => Promise.resolve(2),
  }))
  const source: PlaybookSource = {
    loadBundle,
    agentDataFolder: '/data',
    workspaceRoot: '/work/alpha',
    table: EN,
    locale: BASE_LOCALE,
    log,
    ...overrides,
  }
  return { source, loadBundle, surfaces, log }
}

describe('VS Code /playbook local answer', () => {
  it('leaves ordinary text alone and refuses a missing journal without loading the bundle', async () => {
    const { source, loadBundle } = setup()
    for (const text of ['hello', '/playbooks', 'please /playbook', '/report playbook']) {
      expect(await answerPlaybookCommand(source, text), text).toBeUndefined()
    }
    expect(await answerPlaybookCommand(undefined, '/playbook status')).toEqual({
      ok: false,
      text: EN.playbookUnavailable,
    })
    expect(loadBundle).not.toHaveBeenCalled()
  })

  it('renders status, record and settings from the workspace journal', async () => {
    const { source, surfaces } = setup()
    for (const text of [
      '/playbook',
      '/playbook status',
      '/playbook record',
      '/playbook settings',
    ]) {
      const result = await answerPlaybookCommand(source, text)
      expect(result?.ok, text).toBe(true)
      expect(result?.text, text).not.toBe('')
    }
    expect(surfaces).toHaveLength(4)
    for (const surface of surfaces) {
      expect(surface).toEqual({ agentDataFolder: '/data', workspaceFolder: '/work/alpha' })
    }
  })

  it('answers usage for bad syntax without touching the journal', async () => {
    const { source, surfaces } = setup()
    expect(await answerPlaybookCommand(source, '/playbook frobnicate')).toEqual({
      ok: false,
      text: EN.playbookCommandUsage,
    })
    expect(surfaces).toHaveLength(0)
  })

  it('answers unavailable when the journal bundle cannot load', async () => {
    const { source, log } = setup({
      loadBundle: () => {
        throw new Error('private detail')
      },
    })
    expect(await answerPlaybookCommand(source, '/playbook status')).toEqual({
      ok: false,
      text: EN.playbookUnavailable,
    })
    expect(log.warn).toHaveBeenCalledTimes(1)
  })

  it('answers unavailable for a wrong-shaped bundle without its private detail', async () => {
    const { source, log } = setup({ loadBundle: () => ({}) })
    expect(await answerPlaybookCommand(source, '/playbook status')).toEqual({
      ok: false,
      text: EN.playbookUnavailable,
    })
    expect(log.warn).toHaveBeenCalledTimes(1)
  })

  it('answers unavailable with no folder open, creating no surface', async () => {
    const { source, surfaces } = setup({ workspaceRoot: undefined })
    expect(await answerPlaybookCommand(source, '/playbook status')).toEqual({
      ok: false,
      text: UI_TEXT.playbookUnavailable,
    })
    expect(surfaces).toHaveLength(0)
  })

  it('answers unavailable if constructing the journal throws, without logging private details', async () => {
    const { source, log, loadBundle } = setup()
    const base = loadBundle()
    const broken = {
      ...source,
      loadBundle: () => ({
        ...base,
        createPlaybookSurface: () => {
          throw new Error('private workspace path')
        },
      }),
    }
    expect(await answerPlaybookCommand(broken, '/playbook status')).toEqual({
      ok: false,
      text: UI_TEXT.playbookUnavailable,
    })
    expect(log.warn).toHaveBeenCalledWith('The playbook journal is unavailable')
  })
})
