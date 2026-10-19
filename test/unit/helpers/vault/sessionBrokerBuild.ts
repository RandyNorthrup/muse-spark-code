import { execFileSync } from 'node:child_process'
import { chmod, copyFile, mkdir } from 'node:fs/promises'
import path from 'node:path'
import { build } from 'esbuild'
import { vaultPeerExecutable } from '../../../../src/runtime/vault/posixNative'
import { buildVaultPeer } from '../../../../scripts/build-vault-peer.mjs'
import { buildLinuxHelper } from '../../../../scripts/build-linux-helper.mjs'

/**
 * Stage the product's own created-directories helper beside the bundled
 * governor, where resourceGovernorEntry resolves it on macOS
 * (installRoot/native/darwin/muse-dictate). The binary is the one
 * native/darwin/build.sh produces for the native job; a source checkout
 * cannot build it, so its absence fails here naming the build instead of
 * deep in a governed launch.
 */
async function stageDarwinCreatedHelper(root: string): Promise<void> {
  const staged = path.join(root, 'native', 'darwin', 'muse-dictate')
  try {
    await copyFile(path.resolve('native/darwin/muse-dictate'), staged)
  } catch (error: unknown) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    throw new Error(
      'the broker fixture needs native/darwin/muse-dictate: run bash native/darwin/build.sh first',
      { cause: error },
    )
  }
  await chmod(staged, 0o755)
}

/**
 * Compile the POSIX peer and bundle broker fixture children: each pair is a
 * helper entry and its dist output. The broker entry's resource admission
 * bundles as the real module, and the fixture children run the installed
 * entry's own governor wiring over their generated paths; no test double
 * is substituted.
 */
export async function buildBrokerChildren(
  root: string,
  pairs: readonly (readonly [entry: string, output: string])[],
): Promise<void> {
  const helper = vaultPeerExecutable(root)
  await mkdir(path.dirname(helper), { recursive: true })
  await mkdir(path.join(root, 'dist'))
  if (process.platform === 'linux') {
    // The installed product ships both native helpers (scripts/build.mjs);
    // the fixture builds the same two binaries into its install root, so
    // governor-contained spawns run the product's own code.
    const native = path.join(root, 'native', 'linux', process.arch)
    buildVaultPeer(native)
    buildLinuxHelper(native)
  } else {
    execFileSync('/usr/bin/cc', [
      '-Os',
      '-Wall',
      '-Wextra',
      '-Werror',
      'native/posix/vaultPeer.c',
      '-o',
      helper,
    ])
    if (process.platform === 'darwin') await stageDarwinCreatedHelper(root)
  }
  for (const [entry, output] of pairs) {
    if (!entry || !output) throw new Error('missing generated build pair')
    await build({
      entryPoints: [`test/unit/helpers/vault/${entry}.ts`],
      outfile: path.join(root, 'dist', output),
      bundle: true,
      external: ['@napi-rs/keyring'],
      define: { 'require.main': 'undefined' },
      platform: 'node',
      format: 'cjs',
    })
  }
}
