// WINPSMOD (0.19.0): Windows' own OpenSSH (System32\OpenSSH, the ssh PATH
// finds first) reads its configuration under %ProgramData% and exits 255
// without a word when its environment has none (measured on Windows 11:
// `ssh -G` and `ssh-keygen` both). Every reduced environment the product
// starts a process with keeps it: an MCP server started through `ssh`, a
// hook's `ssh` or git over ssh, and the terminal agent's `muse serve`, whose
// commands run git. Each case builds the product's own environment from this
// process's real one and asks the real ssh.exe for its configuration.
import { spawnSync } from 'node:child_process'
import { existsSync, realpathSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { hookEnvironment } from '../../src/core/execGuard'
import { NO_WORKSPACE } from '../../src/core/executables'
import { mcpServerEnvironment } from '../../src/host/backend/mcpProcess'
import { museCodeEnvironment } from '../../src/runtime/credentialVariables'

/** ssh.exe's exit code for `-G`: its resolved configuration, no network. */
function sshConfigExit(env: NodeJS.ProcessEnv): number | null {
  const systemRoot = process.env['SystemRoot']
  if (systemRoot === undefined) throw new Error('SystemRoot is not set')
  const ssh = path.join(systemRoot, 'System32', 'OpenSSH', 'ssh.exe')
  if (!existsSync(ssh)) throw new Error(`Windows OpenSSH is not installed at ${ssh}`)
  return spawnSync(ssh, ['-G', 'example.invalid'], { env, windowsHide: true }).status
}

describe.runIf(process.platform === 'win32')('WINPSMOD Windows OpenSSH environments', () => {
  it('an MCP server started through ssh runs', () => {
    expect(sshConfigExit(mcpServerEnvironment(process.env, {}, 'win32'))).toBe(0)
  })

  it("a hook's ssh runs", () => {
    const scope = { noWorkspace: NO_WORKSPACE, realpath: realpathSync }
    expect(sshConfigExit(hookEnvironment(process.env, 'win32', [], scope))).toBe(0)
  })

  it("the terminal agent's muse serve keeps what its ssh needs", () => {
    expect(sshConfigExit(museCodeEnvironment(process.env))).toBe(0)
  })
})
