// Shared real-agent packaging for the ACP stdio and Registry release gates.
// An installed package skips this layout; its own files remain untouched.

import type { ChildProcessWithoutNullStreams } from 'node:child_process'
import { cpSync, mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { build } from 'esbuild'
import { removeFolder } from '../unit/helpers/temporaryFolders'

export async function buildAcpFixture(
  root: string,
  packageRoot: string,
  version: string,
): Promise<void> {
  const agent = path.join(packageRoot, 'dist', 'acp.js')
  mkdirSync(path.dirname(agent), { recursive: true })
  await build({
    entryPoints: [path.join(root, 'src', 'runtime', 'main.ts')],
    outfile: agent,
    bundle: true,
    platform: 'node',
    format: 'cjs',
    target: 'node22',
    external: ['@napi-rs/keyring'],
    logLevel: 'silent',
  })
  writeFileSync(path.join(packageRoot, 'package.json'), JSON.stringify({ version }))
  cpSync(path.join(root, 'l10n'), path.join(packageRoot, 'l10n'), { recursive: true })
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
