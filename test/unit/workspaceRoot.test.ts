import { describe, expect, it } from 'vitest'
import {
  hostSideUri,
  resolveAgainstRoot,
  rootRelativePath,
  type UriParts,
} from '../../src/core/workspaceRoot'
import { fakeFolders } from './helpers/fakeFolders'

const ROOT = 'file:///home/u/ws'
const SECOND = 'file:///home/u/second'
const NESTED = 'file:///home/u/ws/packages/app'
const DEEPER = 'file:///home/u/ws/packages/app/deep'

describe('rootRelativePath (D27: the first folder is the root)', () => {
  const lookup = fakeFolders([ROOT, SECOND, NESTED, DEEPER])

  it('gives a file of the first folder its path there', () => {
    expect(rootRelativePath(`${ROOT}/src/a.ts`, lookup)).toBe('src/a.ts')
    expect(rootRelativePath(`${ROOT}/Straße 1/日本.ts`, lookup)).toBe('Straße 1/日本.ts')
  })

  it('counts a folder added inside the first as part of it, at any depth', () => {
    expect(rootRelativePath(`${NESTED}/x.ts`, lookup)).toBe('packages/app/x.ts')
    expect(rootRelativePath(`${DEEPER}/y.ts`, lookup)).toBe('packages/app/deep/y.ts')
  })

  it('places a folder URI itself where it sits: nested ones in the root, the root nowhere', () => {
    expect(rootRelativePath(NESTED, lookup)).toBe('packages/app')
    expect(rootRelativePath(DEEPER, lookup)).toBe('packages/app/deep')
    expect(rootRelativePath(ROOT, lookup)).toBeUndefined()
    expect(rootRelativePath(SECOND, lookup)).toBeUndefined()
  })

  it('gives nothing for a second folder, a file outside every folder, or a non-file', () => {
    expect(rootRelativePath(`${SECOND}/b.ts`, lookup)).toBeUndefined()
    expect(rootRelativePath('file:///home/u/wsx/c.ts', lookup)).toBeUndefined()
    expect(rootRelativePath('file:///home/u/elsewhere/z.ts', lookup)).toBeUndefined()
    expect(rootRelativePath('untitled:Untitled-1', lookup)).toBeUndefined()
  })

  it('stops where the folder around a folder is the folder itself (a file system root)', () => {
    const atTop = { ...fakeFolders([ROOT, 'file:///top']), parentOf: (uri: string) => uri }
    expect(rootRelativePath('file:///top/x.ts', atTop)).toBeUndefined()
  })
})

/** The parts of `scheme://authority/path`, as `vscode.Uri` carries them. */
function parts(scheme: string, authority: string, path: string): UriParts {
  return { scheme, authority, path, query: '', fragment: '' }
}

function text(uri: UriParts): string {
  return `${uri.scheme}://${uri.authority}${uri.path}`
}

describe('hostSideUri: a dropped URI in a remote window (Claude Code #92403)', () => {
  // The remote side's folders are `file:` URIs (VS Code's URI transformer).
  const lookup = fakeFolders([ROOT, SECOND])
  const dropped = (uri: UriParts, remoteName: string | undefined) =>
    rootRelativePath(text(hostSideUri(uri, remoteName)), lookup)

  it('reads the UI side vscode-remote URI of a first-folder file as that file', () => {
    expect(
      dropped(parts('vscode-remote', 'ssh-remote+host', '/home/u/ws/src/a.ts'), 'ssh-remote'),
    ).toBe('src/a.ts')
  })

  it('keeps a second-folder file, and a file of the local machine, outside', () => {
    expect(
      dropped(parts('vscode-remote', 'ssh-remote+host', '/home/u/second/b.ts'), 'ssh-remote'),
    ).toBeUndefined()
    expect(dropped(parts('file', '', '/home/u/ws/src/a.ts'), 'ssh-remote')).toBeUndefined()
    expect(hostSideUri(parts('file', '', '/home/u/ws/a.ts'), 'ssh-remote').scheme).toBe(
      'vscode-local',
    )
  })

  it('leaves a local window, and other schemes, as they are', () => {
    expect(dropped(parts('file', '', '/home/u/ws/src/a.ts'), undefined)).toBe('src/a.ts')
    const untitled = parts('untitled', '', 'Untitled-1')
    expect(hostSideUri(untitled, 'ssh-remote')).toBe(untitled)
  })
})

describe('resolveAgainstRoot', () => {
  it('keeps an absolute path and resolves a relative one against the root', () => {
    expect(resolveAgainstRoot(String.raw`D:\other\a.ts`, String.raw`C:\ws`, 'win32')).toBe(
      String.raw`D:\other\a.ts`,
    )
    expect(resolveAgainstRoot('src/a.ts', String.raw`C:\ws`, 'win32')).toBe(
      String.raw`C:\ws\src\a.ts`,
    )
    expect(resolveAgainstRoot('src/a.ts', '/ws', 'linux')).toBe('/ws/src/a.ts')
  })

  it('refuses a relative path without a folder rather than using the working directory', () => {
    expect(() => resolveAgainstRoot('src/a.ts', undefined, 'linux')).toThrow(
      'src/a.ts is relative and no folder is open',
    )
  })
})
