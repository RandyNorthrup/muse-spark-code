import { describe, expect, it, vi } from 'vitest'
import { type OpenInTerminalDeps, openMuseTerminal } from '../../src/host/commands/openInTerminal'

function harness(cli: ReturnType<OpenInTerminalDeps['resolveCli']>, workspaceRoot?: string) {
  const runInTerminal = vi.fn<OpenInTerminalDeps['runInTerminal']>()
  const showWarning = vi.fn<OpenInTerminalDeps['showWarning']>()
  openMuseTerminal({ resolveCli: () => cli, runInTerminal, workspaceRoot, showWarning })
  return { runInTerminal, showWarning }
}

describe('openMuseTerminal', () => {
  it('runs the CLI with no arguments in the workspace root', () => {
    const t = harness({ ok: true, cliPath: 'C:/muse/muse.cmd' }, 'C:/ws')
    expect(t.runInTerminal).toHaveBeenCalledWith('C:/muse/muse.cmd', [], {
      name: 'Muse Code',
      cwd: 'C:/ws',
    })
    expect(t.showWarning).not.toHaveBeenCalled()
  })

  it('leaves the directory to VS Code without a workspace', () => {
    const t = harness({ ok: true, cliPath: '/usr/local/bin/muse' })
    expect(t.runInTerminal).toHaveBeenCalledWith('/usr/local/bin/muse', [], {
      name: 'Muse Code',
      cwd: undefined,
    })
  })

  it('warns with the reason when the CLI is absent', () => {
    const t = harness({ ok: false, reason: 'not on PATH' }, 'C:/ws')
    expect(t.runInTerminal).not.toHaveBeenCalled()
    expect(t.showWarning).toHaveBeenCalledWith(
      'The Muse Code CLI is not installed, so there is no terminal to open. not on PATH',
    )
  })
})
