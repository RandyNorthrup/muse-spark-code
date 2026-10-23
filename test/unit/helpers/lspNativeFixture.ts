import { copyFile, mkdir, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { build } from 'esbuild'
import { darwinProcessHelper } from './darwinProcessHelper'

const state: { pending?: ReturnType<typeof darwinProcessHelper> } = {}
async function lspNativeFixture() {
  const native =
    process.platform === 'darwin' ? await (state.pending ??= darwinProcessHelper()) : undefined
  return {
    packageRoot: native === undefined ? process.cwd() : path.resolve(native.helperPath, '../../..'),
    remove: async () => {
      await native?.remove()
    },
  }
}
export async function installLspNativeFixture(packageRoot: string) {
  const native = await lspNativeFixture()
  if (process.platform === 'darwin') {
    const destination = path.join(packageRoot, 'native', 'darwin')
    await mkdir(destination, { recursive: true })
    await copyFile(
      path.join(native.packageRoot, 'native', 'darwin', 'muse-dictate'),
      path.join(destination, 'muse-dictate'),
    )
  }
  return native.remove
}

export async function buildLspProcess(entry: string, outfile: string) {
  await build({
    entryPoints: [entry],
    outfile,
    bundle: true,
    platform: 'node',
    format: 'cjs',
    target: 'node22',
    logLevel: 'silent',
    plugins: [
      {
        name: 'fixture-private-root',
        setup(builder) {
          builder.onLoad({ filter: /[/\\]runtime[/\\]privateDirectory\.ts$/ }, async (args) => {
            const source = await readFile(args.path, 'utf8')
            return {
              contents: source.replace(
                /export async function trustedPrivateRoot\([\s\S]*?\n\}/u,
                () =>
                  `export async function trustedPrivateRoot(): Promise<string> { return ${JSON.stringify(tmpdir())} }`,
              ),
              loader: 'ts',
            }
          })
        },
      },
    ],
    define: { __dirname: JSON.stringify(path.join(path.dirname(outfile), 'dist')) },
  })
}
