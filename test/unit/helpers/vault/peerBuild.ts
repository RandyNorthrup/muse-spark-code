import { execFileSync } from 'node:child_process'
import { mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

/**
Compile the shipped POSIX peer helper from its source into a fresh
temporary folder, with the same compiler and flags the broker fixtures
use (sessionBrokerBuild). Returns the binary path and its cleanup; the
caller owns both.
*/
export async function compileVaultPeerHelper(prefix: string): Promise<{
  readonly helper: string
  readonly dispose: () => Promise<void>
}> {
  const root = await mkdtemp(path.join(os.tmpdir(), prefix))
  const helper = path.join(root, 'muse-vault-peer')
  execFileSync(
    '/usr/bin/cc',
    ['-Os', '-Wall', '-Wextra', '-Werror', 'native/posix/vaultPeer.c', '-o', helper],
    {
      stdio: 'pipe',
    },
  )
  return {
    helper,
    dispose: async () => {
      await rm(root, { recursive: true, force: true })
    },
  }
}
