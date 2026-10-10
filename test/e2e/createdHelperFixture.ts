// Real native created-path protocol shared by ACP stdio and exec fixtures.
import { execFileSync } from 'node:child_process'
import { mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'

// The governor makes every governed launch's private temp root through the
// created-path helper the package ships (native/linux/<arch>/muse-created;
// muse-dictate --created-directory on macOS); without it session/new fails
// with "Internal error". The unit-test job builds no native helpers, so the
// fixture compiles the same reviewed source (build-linux-helper.mjs, build.sh).
export function buildCreatedHelper(root: string, packageRoot: string): void {
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
