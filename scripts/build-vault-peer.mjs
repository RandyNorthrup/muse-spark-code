import { execFileSync } from 'node:child_process'
import { mkdirSync } from 'node:fs'
import path from 'node:path'
import process from 'node:process'

/**
Build the shipped peer, process-identity and kernel-lock helper for this
Linux architecture. Sources resolve from the repository root; only the
output directory moves, so the vault broker fixtures build the same
binary into their install root.
@param {string} [directory] the native tree receiving the helper.
*/
export function buildVaultPeer(directory = path.join('native', 'linux', process.arch)) {
  if (process.platform !== 'linux') return
  if (!['x64', 'arm64'].includes(process.arch))
    throw new Error('Unsupported vault helper architecture')
  mkdirSync(directory, { recursive: true })
  execFileSync(
    '/usr/bin/cc',
    [
      '-Os',
      '-s',
      '-Wall',
      '-Wextra',
      '-Werror',
      'native/posix/vaultPeer.c',
      '-o',
      path.join(directory, 'muse-vault-peer'),
    ],
    { stdio: 'inherit', env: { PATH: '/usr/bin:/bin' } },
  )
}
