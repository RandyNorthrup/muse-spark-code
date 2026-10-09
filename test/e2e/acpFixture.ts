// Shared real-agent packaging for the ACP stdio and Registry release gates.
// An installed package skips this layout; its own files remain untouched.

import { execFileSync, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { cpSync, mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { build, type BuildOptions } from 'esbuild'
import { JOB_SOURCE_FILES } from '../../src/host/backend/jobSource'
import { removeFolder } from '../unit/helpers/temporaryFolders'

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
  // On Windows the governed launch compiles its job helpers from the C# the
  // package ships under native/windows/ (jobSource.ts) before `muse serve`.
  for (const file of Object.values(JOB_SOURCE_FILES))
    cpSync(path.join(root, file), path.join(packageRoot, file))
  buildCreatedHelper(root, packageRoot)
}

// The governor makes every governed launch's private temp root through the
// created-path helper the package ships (native/linux/<arch>/muse-created;
// muse-dictate --created-directory on macOS); without it session/new fails
// with "Internal error". The unit-test job builds no native helpers, so the
// fixture compiles the same reviewed source (build-linux-helper.mjs, build.sh).
function buildCreatedHelper(root: string, packageRoot: string): void {
  const source = path.join(root, 'native', 'darwin', 'MuseSparkCreated.c')
  if (process.platform === 'linux') {
    const output = path.join(packageRoot, 'native', 'linux', process.arch, 'muse-created')
    mkdirSync(path.dirname(output), { recursive: true })
    execFileSync(
      '/usr/bin/cc',
      [
        '-Os',
        '-DMUSE_CREATED_STANDALONE',
        source,
        '-Wl,-Bstatic',
        '-lcrypto',
        '-Wl,-Bdynamic',
        '-o',
        output,
      ],
      { stdio: 'inherit', env: { PATH: '/usr/bin:/bin' } },
    )
  } else if (process.platform === 'darwin') {
    // muse-dictate hands the helper its arguments after --created-directory.
    const output = path.join(packageRoot, 'native', 'darwin', 'muse-dictate')
    const main = path.join(packageRoot, 'created-main.c')
    mkdirSync(path.dirname(output), { recursive: true })
    writeFileSync(
      main,
      'int muse_created_main(int, char **);\nint main(int argc, char **argv) { return muse_created_main(argc - 1, argv + 1); }\n',
    )
    execFileSync('/usr/bin/cc', ['-Os', source, main, '-o', output], { stdio: 'inherit' })
  }
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
