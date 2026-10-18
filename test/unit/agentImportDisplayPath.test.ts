// The import preview's display path (M83, PLAN.md D49): workspace-relative,
// `~/…` under the home folder, else whole. A folder that only starts with
// two dots (`..foo`) stays inside its root on any drive; a genuine `..`
// segment still fails closed (RVMSWINPATH).

import { describe, expect, it } from 'vitest'
import { importDisplayPath } from '../../src/core/import/agentImport'

const HOME = '/home/u'
const WS = '/ws'

describe('importDisplayPath', () => {
  it('shows workspace paths relative, home paths under ~, and others whole', () => {
    const context = { platform: 'linux', homeDir: HOME, workspaceRoot: WS } as const
    expect(importDisplayPath(`${WS}/a/b.md`, context)).toBe('a/b.md')
    expect(importDisplayPath(`${HOME}/.claude/x`, context)).toBe('~/.claude/x')
    expect(importDisplayPath('/etc/x', context)).toBe('/etc/x')
  })

  it('keeps a folder named ..foo inside the workspace, on any drive', () => {
    const context = {
      platform: 'win32',
      homeDir: String.raw`D:\Users\me`,
      workspaceRoot: String.raw`D:\ws`,
    } as const
    expect(importDisplayPath(String.raw`D:\ws\..foo\b.md`, context)).toBe('..foo/b.md')
    expect(importDisplayPath(String.raw`D:\other\b.md`, context)).toBe(String.raw`D:\other\b.md`)
    expect(importDisplayPath(String.raw`E:\ws\..foo\b.md`, context)).toBe(
      String.raw`E:\ws\..foo\b.md`,
    )
  })
})
