// Shared real-agent packaging for the ACP stdio and Registry release gates.
// An installed package skips this layout; its own files remain untouched.

import type { ChildProcessWithoutNullStreams } from 'node:child_process'
import { execFileSync } from 'node:child_process'
import { cpSync, existsSync, mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { build, type BuildOptions } from 'esbuild'
import { JOB_SOURCE_FILES } from '../../src/host/backend/jobSource'
import { removeFolder } from '../unit/helpers/temporaryFolders'
import { buildCreatedHelper } from './createdHelperFixture'

export async function buildAcpFixture(
  root: string,
  packageRoot: string,
  version: string,
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
  // What's New's release notes beside acp.js, as the published package ships
  // them (scripts/package-acp.mjs through ACP_BUNDLES): ACP's /whatsnew (M99)
  // reads this file, answered locally with no model turn. Generated with the
  // build's own writer when no build has laid it out yet.
  const contentFile = path.join(root, 'dist', 'whatsNew.json')
  if (!existsSync(contentFile)) {
    const generator = path.join(root, 'scripts', 'lib', 'whatsNewContent.mjs')
    execFileSync(
      process.execPath,
      [
        '--input-type=module',
        '--eval',
        [
          `import { writeWhatsNewContent } from ${JSON.stringify(pathToFileURL(generator).href)};`,
          `writeWhatsNewContent(${JSON.stringify(root)});`,
        ].join('\n'),
      ],
      { cwd: root, stdio: 'pipe' },
    )
  }
  cpSync(contentFile, path.join(packageRoot, 'dist', 'whatsNew.json'))
  // On Windows the governed launch compiles its job helpers from the C# the
  // package ships under native/windows/ (jobSource.ts) before `muse serve`.
  for (const file of Object.values(JOB_SOURCE_FILES))
    cpSync(path.join(root, file), path.join(packageRoot, file))
  buildCreatedHelper(root, packageRoot)
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
