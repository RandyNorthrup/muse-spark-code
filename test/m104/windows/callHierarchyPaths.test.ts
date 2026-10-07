import * as vscode from 'vscode'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { vscodeLanguageServices } from '../../../src/host/vscode/codeIntel/languageServices'

const platformDescriptor = Object.getOwnPropertyDescriptor(process, 'platform')
afterEach(() => {
  if (platformDescriptor !== undefined)
    Object.defineProperty(process, 'platform', platformDescriptor)
  vi.mocked(vscode.commands.executeCommand).mockReset()
})

function item(name: string, path: string): vscode.CallHierarchyItem {
  const range = new vscode.Range(new vscode.Position(1, 0), new vscode.Position(1, 2))
  return { name, kind: 11, uri: vscode.Uri.file(path), range, selectionRange: range }
}
async function selected(path: string, candidatePath: string): Promise<string | undefined> {
  vi.mocked(vscode.commands.executeCommand)
    .mockResolvedValueOnce([item('elsewhere', '/elsewhere.ts'), item('declared', candidatePath)])
    .mockResolvedValueOnce([])
  const answer = await vscodeLanguageServices().callHierarchy(
    path,
    { line: 1, character: 1 },
    'incoming',
  )
  expect(answer?.otherItems).toBe(1)
  return answer?.item.name
}

describe('call-hierarchy resource identity on Windows', () => {
  it('skips a virtual provider item without treating it as a disk path', async () => {
    Object.defineProperty(process, 'platform', { value: 'win32' })
    const virtual = item('virtual', 'Untitled-1')
    // The central URI mock is file-only; this provider response is explicitly virtual.
    Object.defineProperty(virtual.uri, 'scheme', { value: 'untitled' })
    vi.mocked(vscode.commands.executeCommand)
      .mockResolvedValueOnce([virtual, item('declared', 'c:/FIXTURE/CALLS.ts')])
      .mockResolvedValueOnce([])
    const answer = await vscodeLanguageServices().callHierarchy(
      'C:/fixture/calls.ts',
      { line: 1, character: 1 },
      'incoming',
    )
    expect(answer?.item.name).toBe('declared')
  })

  it('matches native Windows separators before selecting the declared overload', async () => {
    Object.defineProperty(process, 'platform', { value: 'win32' })
    expect(await selected(String.raw`C:\fixture\calls.ts`, 'C:/fixture/calls.ts')).toBe('declared')
  })

  it.each(['win32', 'linux', 'darwin'])(
    'uses the filesystem case policy on %s without merging distinct POSIX files',
    async (platform) => {
      Object.defineProperty(process, 'platform', { value: platform })
      const path = platform === 'win32' ? 'C:/fixture/calls.ts' : '/fixture/calls.ts'
      const candidate = platform === 'win32' ? 'c:/FIXTURE/CALLS.ts' : '/fixture/CALLS.ts'
      expect(await selected(path, candidate)).toBe(platform === 'win32' ? 'declared' : 'elsewhere')
    },
  )
})
