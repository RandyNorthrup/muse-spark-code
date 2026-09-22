import { describe, expect, it, vi } from 'vitest'
import {
  type InsertMentionDeps,
  insertMentionReference,
  NO_EDITOR_MESSAGE,
  NO_SURFACE_MESSAGE,
} from '../../src/host/commands/insertMention'
import { fakeSurface } from './helpers/fakes'

const selection = { relativePath: 'src/app.ts', startLine: 5, endLine: 10, isEmpty: false }

function deps(overrides: Partial<InsertMentionDeps> = {}): InsertMentionDeps {
  return {
    activeSelection: () => selection,
    activeSurface: () => undefined,
    openSidebar: vi.fn(() => Promise.resolve()),
    showInformation: vi.fn(),
    ...overrides,
  }
}

describe('insertMentionReference', () => {
  it('inserts the reference followed by a space into the active surface', async () => {
    const surface = fakeSurface('sidebar')
    const d = deps({ activeSurface: () => surface })
    await insertMentionReference(d)
    expect(surface.reveal).toHaveBeenCalledOnce()
    expect(surface.posted).toEqual([{ type: 'insertText', text: '@src/app.ts#5-10 ' }])
    expect(d.showInformation).not.toHaveBeenCalled()
  })

  it('explains when no editor is active', async () => {
    const surface = fakeSurface('sidebar')
    const d = deps({ activeSelection: () => undefined, activeSurface: () => surface })
    await insertMentionReference(d)
    expect(d.showInformation).toHaveBeenCalledWith(NO_EDITOR_MESSAGE)
    expect(surface.posted).toEqual([])
  })

  it('opens the sidebar and explains when no surface exists yet', async () => {
    const d = deps()
    await insertMentionReference(d)
    expect(d.openSidebar).toHaveBeenCalledOnce()
    expect(d.showInformation).toHaveBeenCalledWith(NO_SURFACE_MESSAGE)
  })
})
