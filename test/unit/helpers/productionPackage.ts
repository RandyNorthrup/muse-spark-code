// Global setup builds once; each suite owns a complete copy, including image
// inputs and mutable dist/metafiles. No suite mutates the shared build.
import { execFileSync } from 'node:child_process'
import {
  closeSync,
  cpSync,
  existsSync,
  mkdirSync,
  openSync,
  readdirSync,
  rmSync,
  symlinkSync,
} from 'node:fs'
import path from 'node:path'
import { withoutCredentials } from '../../../src/runtime/credentialVariables'

export const PRODUCTION_BUILD_KEY = 'productionBuild'
export const VISUAL_BUILD_KEY = 'visualBuild'
declare module 'vitest' {
  export interface ProvidedContext {
    [PRODUCTION_BUILD_KEY]: string
    [VISUAL_BUILD_KEY]: string
  }
}
export const PRODUCTION_BUILD_SUITES = [
  '/packagedBundles.test.mjs',
  '/webviewBundleRoot.test.ts',
  '/devicesPhase2Harness.test.mjs',
]

export function buildProductionPackage(root: string, folder: string, shared?: unknown): void {
  mkdirSync(folder, { recursive: true })
  for (const source of [
    'src',
    'scripts',
    'vendor',
    'design',
    'first-party-skills',
    'native',
    'l10n',
    'docs',
    'media',
    'test',
  ])
    cpSync(path.join(root, source), path.join(folder, source), { recursive: true })
  for (const file of [
    'package.json',
    'tsconfig.json',
    'tsconfig.base.json',
    'LICENSE',
    'CHANGELOG.md',
    'README.md',
  ])
    cpSync(path.join(root, file), path.join(folder, file))
  for (const file of readdirSync(root)) {
    if (/^package\.nls.*\.json$/.test(file)) cpSync(path.join(root, file), path.join(folder, file))
  }
  symlinkSync(path.join(root, 'node_modules'), path.join(folder, 'node_modules'), 'junction')
  if (typeof shared === 'string') {
    // Replace stale outputs as a fresh build does. Only this suite's own dist
    // is removed; the shared output and dependency junction stay read-only.
    const output = path.resolve(folder, 'dist')
    if (path.dirname(output) !== path.resolve(folder)) throw new Error('Invalid fixture output')
    rmSync(output, { recursive: true, force: true })
    cpSync(path.join(shared, 'dist'), output, { recursive: true })
    // build.mjs also compiles the current Linux architecture's created-path
    // helper beside dist (build-linux-helper.mjs); the packager requires it.
    const linuxHelpers = path.join(shared, 'native', 'linux')
    if (existsSync(linuxHelpers))
      cpSync(linuxHelpers, path.join(folder, 'native', 'linux'), { recursive: true })
    return
  }
  // A failed build's data-URL stack can exceed execFileSync's default buffer
  // and hide its real error behind ENOBUFS. Preserve diagnostics on disk.
  const logPath = path.join(folder, 'build.log')
  const log = openSync(logPath, 'w')
  try {
    execFileSync(process.execPath, [path.join(folder, 'scripts/build.mjs'), '--production'], {
      cwd: folder,
      env: withoutCredentials(process.env),
      stdio: ['ignore', log, log],
    })
  } catch (error: unknown) {
    throw new Error(`Production package build failed; diagnostics: ${logPath}`, { cause: error })
  } finally {
    closeSync(log)
  }
}
