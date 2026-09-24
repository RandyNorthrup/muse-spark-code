import { beforeEach, describe, expect, it, vi } from 'vitest'
import { commands, Uri, window } from 'vscode'
import { createWorktreeFeatures } from '../../src/host/worktreeFeatures'
import { FakeLogOutputChannel } from './helpers/fakes'
import { confirmModal as confirm, inform, pickOne } from './helpers/vscodeViews'

beforeEach(() => {
  vi.mocked(window.showInputBox).mockReset()
  vi.mocked(pickOne).mockReset()
  vi.mocked(inform).mockReset()
  vi.mocked(confirm).mockReset()
  vi.mocked(window.showErrorMessage).mockReset()
  vi.mocked(commands.executeCommand).mockReset()
})

describe('createWorktreeFeatures', () => {
  it('asks for the branch with validation, picks the base, and opens the folder in a new window', async () => {
    const calls: (readonly string[])[] = []
    const features = createWorktreeFeatures({
      workspaceRoot: '/ws',
      runGit: (args) => {
        calls.push(args)
        // show-ref fails: no such branch yet.
        return args[0] === 'show-ref'
          ? Promise.reject(new Error('Command failed: git show-ref'))
          : Promise.resolve(
              args[0] === 'rev-parse' && args[1] === '--show-toplevel' ? '/ws\n' : 'main\n',
            )
      },
      log: new FakeLogOutputChannel(),
    })
    vi.mocked(window.showInputBox).mockImplementation(async (options) => {
      expect(await options?.validateInput?.('topic')).toBeUndefined()
      return 'topic'
    })
    vi.mocked(pickOne).mockImplementation((items) => Promise.resolve(items[0]))
    vi.mocked(inform).mockResolvedValue('Open in New Window')
    await features.newWorktree()
    expect(calls.at(-1)?.slice(0, 4)).toEqual(['worktree', 'add', '-b', 'topic'])
    expect(commands.executeCommand).toHaveBeenCalledWith(
      'vscode.openFolder',
      Uri.file(calls.at(-1)?.[4] ?? ''),
      { forceNewWindow: true },
    )
  })

  it('confirms a removal in a modal and reports git’s errors', async () => {
    const porcelain =
      'worktree /ws\nbranch refs/heads/main\n\nworktree /wt/x\nbranch refs/heads/x\n'
    const features = createWorktreeFeatures({
      workspaceRoot: '/ws',
      runGit: (args) => {
        if (args[0] === 'worktree' && args[1] === 'remove') {
          return Promise.reject(
            new Error("Command failed: git worktree remove\nfatal: '/wt/x' is locked"),
          )
        }
        return Promise.resolve(args[0] === 'worktree' ? porcelain : '/ws\n')
      },
      log: new FakeLogOutputChannel(),
    })
    vi.mocked(pickOne).mockImplementation((items) => Promise.resolve(items[0]))
    vi.mocked(confirm).mockImplementation((_message, _options, action) => Promise.resolve(action))
    await features.removeWorktree()
    expect(vi.mocked(confirm).mock.calls[0]?.[1]).toMatchObject({ modal: true })
    expect(window.showErrorMessage).toHaveBeenCalledWith(
      "git could not remove the worktree: fatal: '/wt/x' is locked",
    )
  })
})
