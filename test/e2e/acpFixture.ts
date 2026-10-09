// Shared real-agent packaging for the ACP stdio and Registry release gates.
// An installed package skips this layout; its own files remain untouched.

import type { ChildProcessWithoutNullStreams } from 'node:child_process'
import { cpSync, mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { build, type BuildOptions, type Plugin } from 'esbuild'
import { JOB_SOURCE_FILES } from '../../src/host/backend/jobSource'
import { removeFolder } from '../unit/helpers/temporaryFolders'
import { buildLinuxHelper } from '../../scripts/build-linux-helper.mjs'

export async function buildAcpFixture(
  root: string,
  packageRoot: string,
  version: string,
  // A test that must not reach the rig's real credential store replaces the
  // native keyring binding of acp.js with a fake (acpStdio.e2e.test.ts).
  agentPlugins: readonly Plugin[] = [],
): Promise<void> {
  const agent = path.join(packageRoot, 'dist', 'acp.js')
  mkdirSync(path.dirname(agent), { recursive: true })
  const options: BuildOptions = {
    bundle: true,
    platform: 'node',
    format: 'cjs',
    target: 'node22',
    external: ['@napi-rs/keyring'],
    logLevel: 'silent',
  }
  await build({
    ...options,
    ...(agentPlugins.length > 0 && { external: [], plugins: [...agentPlugins] }),
    entryPoints: [path.join(root, 'src', 'runtime', 'main.ts')],
    outfile: agent,
  })
  // The runtime requires its resource governor from beside acp.js, as the
  // published package ships it (build.mjs); every governed launch admits
  // through it, so a session that starts any process needs it.
  await build({
    ...options,
    entryPoints: [path.join(root, 'src', 'core', 'resources', 'resourceGovernorEntry.ts')],
    outfile: path.join(packageRoot, 'dist', 'resourceGovernor.js'),
  })
  writeFileSync(path.join(packageRoot, 'package.json'), JSON.stringify({ version }))
  cpSync(path.join(root, 'l10n'), path.join(packageRoot, 'l10n'), { recursive: true })
  buildLinuxHelper(packageRoot)
  // On Windows the governed launch compiles its job helpers from the C# the
  // package ships under native/windows/ (jobSource.ts) before `muse serve`.
  for (const file of Object.values(JOB_SOURCE_FILES))
    cpSync(path.join(root, file), path.join(packageRoot, file))
}

export async function removeAcpFixture(
  children: readonly ChildProcessWithoutNullStreams[],
  folders: readonly string[],
): Promise<void> {
  for (const child of children) {
    child.kill()
  }
  await Promise.all(folders.map((folder) => removeFolder(folder)))
}
