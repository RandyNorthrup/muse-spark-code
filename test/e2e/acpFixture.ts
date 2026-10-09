// Shared real-agent packaging for the ACP stdio and Registry release gates.
// An installed package skips this layout; its own files remain untouched.

import type { ChildProcessWithoutNullStreams } from 'node:child_process'
import { cpSync, mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { build } from 'esbuild'
import { JOB_SOURCE_FILES } from '../../src/host/backend/jobSource'
import { removeFolder } from '../unit/helpers/temporaryFolders'

export async function buildAcpFixture(
  root: string,
  packageRoot: string,
  version: string,
): Promise<void> {
  const agent = path.join(packageRoot, 'dist', 'acp.js')
  mkdirSync(path.dirname(agent), { recursive: true })
  const options = {
    bundle: true,
    platform: 'node',
    format: 'cjs',
    target: 'node22',
    external: ['@napi-rs/keyring'],
    logLevel: 'silent',
  } as const
  await build({
    ...options,
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
