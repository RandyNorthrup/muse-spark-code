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
  writeFileSync,
} from 'node:fs'
import path from 'node:path'
import { withoutCredentials } from '../../../src/runtime/credentialVariables'

export const PRODUCTION_BUILD_KEY = 'productionBuild'
declare module 'vitest' {
  export interface ProvidedContext {
    [PRODUCTION_BUILD_KEY]: string
  }
}
export const PRODUCTION_BUILD_SUITES = [
  '/runtimeChatGptPackage.test.ts',
  '/webviewBundle.test.mjs',
  '/execStdio.e2e.test.ts',
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
    'test/integration',
    'test/packaging',
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

/** The real badge gate receives scripted public bytes, never a network skip. */
export function packageImagePreload(file: string, root: string, requests: string): void {
  writeFileSync(
    file,
    String.raw`
const { appendFileSync, readFileSync } = require('node:fs');
const path = require('node:path');
const root = ${JSON.stringify(root)};
const requests = ${JSON.stringify(requests)};
globalThis.fetch = async input => {
  const url = new URL(String(input));
  appendFileSync(requests, JSON.stringify(url.href) + '\n');
  if (url.href === 'https://api.github.com/repos/RandyNorthrup/muse-spark-code/git/trees/main?recursive=1') {
    return Response.json({ truncated: false, tree: [{ path: 'media/readme/banner.png', type: 'blob' }] });
  }
  if (url.origin === 'https://raw.githubusercontent.com' &&
      url.pathname.startsWith('/RandyNorthrup/muse-spark-code/main/media/')) {
    return new Response(readFileSync(path.join(root, url.pathname.split('/main/')[1])), {
      headers: { 'content-type': 'image/png' },
    });
  }
  if (!['img.shields.io', 'badgen.net', 'github.com'].includes(url.hostname))
    throw new Error('Unexpected package image: ' + url.href);
  const text = url.pathname.startsWith('/badge/')
    ? decodeURIComponent(url.pathname.slice('/badge/'.length)).replace(/-[^-]+$/, '')
    : 'test-owned badge';
  return new Response('<svg xmlns="http://www.w3.org/2000/svg"><text>' + text + '</text></svg>', {
    headers: { 'content-type': 'image/svg+xml' },
  });
};
`,
  )
}
