// PATHGUARD round 7 (Grok re-review of PR #249): the Windows team payload
// kept the raw PATH. The payload environment is a `string[]` the compiler
// could not see, so the guard name appearing in the file (on the helper
// spawn) stayed green while `CreateProcessW` received the raw block. These
// tests drive the real payload builder: a workspace planting on its PATH
// never reaches the block, and only a guarded environment serializes.
import { describe, expect, it } from 'vitest'
import { guardedEnvironmentBlock, workspaceChildEnvironment } from '../../src/core/executables'
import { windowsTeamPayloadEnvironment } from '../../src/host/team/processLifetime'

const WORKSPACE = String.raw`C:\work\repo`
const SYSTEM_DIR = String.raw`C:\Windows\System32`

function blockOf(pathValue: string | undefined, extra: NodeJS.ProcessEnv = {}): string[] {
  return windowsTeamPayloadEnvironment(
    { PATH: pathValue, SYSTEMROOT: String.raw`C:\Windows`, ...extra },
    WORKSPACE,
  )
}

function pathOf(block: string[]): string | undefined {
  return block.find((entry) => entry.toUpperCase().startsWith('PATH='))?.slice('PATH='.length)
}

describe('round-7 Windows team payload environment (real builder)', () => {
  it('drops a workspace planting, empty and relative entries from the payload PATH', () => {
    // Before the fix the block carried this PATH unchanged, so a bare
    // `request.command` in the workspace ran first, as did any helper the
    // payload starts by bare name.
    const block = blockOf(
      [String.raw`C:\work\repo\bin`, SYSTEM_DIR, '', 'tools', String.raw`c:\WORK\repo\evil`].join(
        ';',
      ),
    )
    expect(pathOf(block)).toBe(SYSTEM_DIR)
  })

  it('sets NoDefaultCurrentDirectoryInExePath on the payload', () => {
    const block = blockOf(SYSTEM_DIR)
    expect(block).toContain('NoDefaultCurrentDirectoryInExePath=1')
  })

  it('keeps non-PATH variables and drops undefined ones', () => {
    const block = blockOf(SYSTEM_DIR, {
      SYSTEMROOT: String.raw`C:\Windows`,
      DROPPED: undefined,
      MUSE_SPARK_LAUNCH_ID: 'abc',
    })
    expect(block).toContain(String.raw`SYSTEMROOT=C:\Windows`)
    expect(block).toContain('MUSE_SPARK_LAUNCH_ID=abc')
    expect(block.some((entry) => entry.startsWith('DROPPED='))).toBe(false)
  })

  it('only a guarded environment serializes to a helper block', () => {
    // The block builder takes the branded type: a raw environment cannot
    // reach a native helper payload without going through the guard. A
    // guarded environment with nothing left still serializes its other
    // variables (PATH deleted, never stored empty).
    const guarded = workspaceChildEnvironment(
      'win32',
      { PATH: String.raw`C:\work\repo\bin`, KEEP: 'yes' },
      { workspaceRoot: WORKSPACE, realpath: (filePath) => filePath },
    )
    expect(guardedEnvironmentBlock(guarded)).toEqual([
      'KEEP=yes',
      'NoDefaultCurrentDirectoryInExePath=1',
    ])
  })
})
