import { copyFile, mkdir } from 'node:fs/promises'
import path from 'node:path'
import type * as privateDirectories from '../../../src/runtime/privateDirectory'
import { build } from 'esbuild'
import { afterAll } from 'vitest'
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

export async function privateDirectoryFixture(actual: typeof privateDirectories) {
  const native = await lspNativeFixture()
  afterAll(native.remove)
  return {
    privateDirectory: (directory: string, shouldCreate = false) =>
      actual.privateDirectory(directory, shouldCreate, native.packageRoot),
  }
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
    define: { __dirname: JSON.stringify(path.join(path.dirname(outfile), 'dist')) },
  })
}
