// The memory view's failure reads (src/host/commands/memoryCommands.ts):
// the store is the product's own MemoryStore over the standalone
// runtime's headless ToolIo, in a temporary workspace and data home, so a
// vanished folder and a swapped one fail the way they fail for a person.
// A folder that vanished reads as an empty view: the store absorbs a
// missing folder into no notes, so nothing is shown and nothing throws.
// A folder swapped for a link out of the workspace between the scope
// listing and the note listing is refused, and the refusal reaches the
// caller with its cause, shown nowhere. The picks, boxes and modals are
// the injected VS Code surface, unbuildable headless: members a test's
// path never reaches throw loudly if ever reached.
import { mkdir, rm, symlink, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { MODEL_TEXT, UI_TEXT } from '../../src/shared/constants'
import { MemoryStore, type MemoryIo } from '../../src/core/memory/memoryStore'
import { memoryDataRoot } from '../../src/core/memory/memoryLocation'
import { createMemoryIo, systemPath } from '../../src/host/backend/memoryIo'
import { showMemory, type MemoryViewDeps } from '../../src/host/commands/memoryCommands'
import type { PickItem } from '../../src/host/commands/pickItem'
import { headlessToolIo } from './helpers/headlessToolIo'
import { removeFolder, usingTempDir } from './helpers/temporaryFolders'

/** A member the view never reaches on the test's path: loud if it ever does. */
function unreached(name: string): () => never {
  return () => {
    throw new Error(`${name} is not reached on this path`)
  }
}

// The product's own store over the runtime's own headless ToolIo. With
// `swap`, the scope folder's second canonicalization stages a real
// mid-view race: the first (the scope listing) still sees the folder, the
// second (the note listing) runs after `swap` replaced it. Each phase
// canonicalizes the scope root exactly once, by showMemoryView's own
// order, so the trigger is structural, never a call count.
function viewStore(root: string, workspace: string, swap?: () => Promise<void>): MemoryStore {
  const files = headlessToolIo(workspace)
  const io = createMemoryIo(files, { warn: () => undefined })
  const scopeKey = path.join(workspace, '.agents', 'memory').replaceAll('\\', '/')
  let hasSeenScopeDir = false
  const racingIo: MemoryIo =
    swap === undefined
      ? io
      : {
          ...io,
          realPath: async (absolutePath: string) => {
            if (absolutePath.replaceAll('\\', '/') === scopeKey) {
              if (hasSeenScopeDir) {
                await swap()
              }
              hasSeenScopeDir = true
            }
            return await io.realPath(absolutePath)
          },
        }
  return new MemoryStore({
    io: racingIo,
    platform: process.platform,
    dataRoot: () =>
      memoryDataRoot({ platform: process.platform, homeDir: root, xdgDataHome: undefined }),
    workspaceRoot: workspace,
    systemPath,
    warn: () => undefined,
  })
}

function viewDeps(
  store: MemoryStore,
  pick: MemoryViewDeps['pick'],
  shown: string[],
  informed: string[],
): MemoryViewDeps {
  return {
    store,
    pick,
    askName: unreached('askName'),
    askDescription: unreached('askDescription'),
    confirm: unreached('confirm'),
    openFile: unreached('openFile'),
    trash: unreached('trash'),
    edit: unreached('edit'),
    openDocs: unreached('openDocs'),
    showInformation: (message: string) => {
      informed.push(message)
    },
    showError: (message: string) => {
      shown.push(message)
    },
  }
}

describe('showMemory', () => {
  it('reads a vanished folder as an empty view, showing nothing', async () => {
    await usingTempDir('memory-vanished-', async (root) => {
      const workspace = path.join(root, 'ws')
      const scopeDir = path.join(workspace, '.agents', 'memory')
      await mkdir(scopeDir, { recursive: true })
      await writeFile(path.join(scopeDir, 'deploy.md'), 'Deploy on Fridays.\n')
      const store = viewStore(root, workspace)
      // The note lists while the folder exists, so an empty view
      // afterwards proves the vanishing, not a listing that never worked.
      const listed = await store.notes('project')
      expect(listed.map((note) => note.path)).toEqual(['deploy.md'])
      // The whole workspace vanishes mid-view, after the listing above.
      await removeFolder(workspace)
      const seen: PickItem[][] = []
      const shown: string[] = []
      const informed: string[] = []
      await showMemory(
        viewDeps(
          store,
          (items) => {
            seen.push([...items])
            return Promise.resolve(undefined)
          },
          shown,
          informed,
        ),
      )
      expect(seen).toHaveLength(1)
      expect(seen[0]?.filter((item) => item.id.startsWith('note:'))).toEqual([])
      expect(shown).toEqual([])
      expect(informed).toEqual([])
    })
  })

  it('carries a scope that cannot be read to the caller with its cause', async () => {
    await usingTempDir('memory-unreadable-', async (root) => {
      const workspace = path.join(root, 'ws')
      const scopeDir = path.join(workspace, '.agents', 'memory')
      const outside = path.join(root, 'outside')
      await mkdir(scopeDir, { recursive: true })
      await mkdir(outside, { recursive: true })
      await writeFile(path.join(scopeDir, 'deploy.md'), 'Deploy on Fridays.\n')
      // Between the scope listing and the note listing the scope's folder
      // is really swapped for a link out of the workspace, which the store
      // refuses: the view fails the way it fails for a person.
      let hasSwapped = false
      const store = viewStore(root, workspace, async () => {
        if (hasSwapped) {
          return
        }
        hasSwapped = true
        await rm(scopeDir, { recursive: true, force: true })
        await symlink(outside, scopeDir, 'junction')
      })
      const shown: string[] = []
      const informed: string[] = []
      let failure: unknown
      try {
        await showMemory(viewDeps(store, unreached('pick'), shown, informed))
      } catch (error: unknown) {
        failure = error
      }
      // The race really staged: without the swap nothing below would fail.
      expect(hasSwapped).toBe(true)
      expect(failure).toBeInstanceOf(Error)
      expect((failure as Error).message).toBe(UI_TEXT.memoryFailed)
      expect((failure as Error).cause).toBeInstanceOf(Error)
      expect(((failure as Error).cause as Error).message).toBe(MODEL_TEXT.memoryPathLink)
      expect(shown).toEqual([])
      expect(informed).toEqual([])
    })
  })
})
