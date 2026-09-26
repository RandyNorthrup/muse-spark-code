import { beforeEach, describe, expect, it, vi } from 'vitest'
import { env, Uri, window, workspace } from 'vscode'
import { createMemoryFeatures } from '../../src/host/memoryFeatures'
import { memoryStoreOver, PERSONAL } from './helpers/fakeMemoryIo'
import { FakeLogOutputChannel } from './helpers/fakes'
import { confirmModal, pickOne } from './helpers/vscodeViews'

const PROJECT = '/ws/.agents/memory'

function setup(initial: Record<string, string> = {}) {
  const files = new Map(Object.entries(initial))
  const log = new FakeLogOutputChannel()
  const features = createMemoryFeatures({ store: memoryStoreOver(files).store, log })
  return { files, log, features }
}

/** Each quick pick answers with the row whose id is next in `ids`. */
function pickIds(...ids: string[]) {
  const queue = [...ids]
  vi.mocked(pickOne).mockImplementation((items) => {
    const id = queue.shift()
    return Promise.resolve(items.find((item) => 'id' in item && item.id === id))
  })
}

beforeEach(() => {
  vi.mocked(window.showQuickPick).mockReset()
  vi.mocked(window.showInputBox).mockReset()
  vi.mocked(window.showWarningMessage).mockReset()
  vi.mocked(window.showTextDocument).mockReset()
  vi.mocked(window.showErrorMessage).mockReset()
  vi.mocked(window.showInformationMessage).mockReset()
  vi.mocked(workspace.fs.delete).mockReset()
  vi.mocked(env.openExternal).mockReset()
})

describe('createMemoryFeatures (M49)', () => {
  it('shows the notes in a quick pick and opens one as a document to edit', async () => {
    const t = setup({ [`${PERSONAL}/prefs.md`]: 'Prefers tabs.' })
    pickIds('note:0', 'open')
    await t.features.showMemory()
    const [items, options] = vi.mocked(pickOne).mock.calls[0]!
    expect(items[0]).toMatchObject({ label: 'prefs.md', detail: 'Prefers tabs.' })
    expect(options).toMatchObject({ title: 'Muse memory', placeHolder: '1 memory note' })
    expect(window.showTextDocument).toHaveBeenCalledWith(Uri.file(`${PERSONAL}/prefs.md`), {
      preview: false,
    })
  })

  it('deletes to the trash after a modal and logs it', async () => {
    const t = setup({
      [`${PROJECT}/a.md`]: 'A',
      [`${PROJECT}/MEMORY.md`]: '- [a](a.md) | A\n',
    })
    pickIds('note:1', 'delete')
    vi.mocked(confirmModal).mockResolvedValue('Delete')
    await t.features.showMemory()
    expect(vi.mocked(confirmModal).mock.calls[0]).toEqual([
      'Delete the memory note a.md?',
      {
        modal: true,
        detail: 'It moves to the trash. Muse no longer sees it from its next session on.',
      },
      'Delete',
    ])
    expect(workspace.fs.delete).toHaveBeenCalledWith(Uri.file(`${PROJECT}/a.md`), {
      useTrash: true,
    })
    expect(t.files.get(`${PROJECT}/MEMORY.md`)).toBe('')
    expect(t.log.info).toHaveBeenCalledWith(`Memory note moved to the trash: ${PROJECT}/a.md`)
  })

  it('asks for the name and the description in input boxes, then opens the new note', async () => {
    const t = setup()
    pickIds('action:new', 'project')
    vi.mocked(window.showInputBox)
      .mockImplementationOnce(async (options) => {
        await expect(options?.validateInput?.('../x')).resolves.toMatch(/does not accept/)
        return 'deploy'
      })
      .mockResolvedValueOnce('')
    await t.features.showMemory()
    expect(vi.mocked(window.showInputBox).mock.calls.map(([options]) => options?.title)).toEqual([
      'Name the note',
      'What is the note about? One line for MEMORY.md (optional)',
    ])
    expect(t.files.get(`${PROJECT}/deploy.md`)).toBe('')
    expect(window.showTextDocument).toHaveBeenCalledWith(Uri.file(`${PROJECT}/deploy.md`), {
      preview: false,
    })
  })

  it('opens the documentation and reports a failure as an error', async () => {
    const t = setup({ [`${PERSONAL}/a.md`]: 'A' })
    pickIds('action:docs')
    await t.features.showMemory()
    expect(env.openExternal).toHaveBeenCalledWith(
      Uri.parse('https://dev.meta.ai/docs/muse-code/configuration#local-memory'),
    )
    pickIds('note:0', 'delete')
    vi.mocked(confirmModal).mockResolvedValue('Delete')
    vi.mocked(workspace.fs.delete).mockRejectedValue(new Error('EPERM'))
    await t.features.showMemory()
    expect(window.showErrorMessage).toHaveBeenCalledWith('The memory could not be changed: EPERM')
  })
})
