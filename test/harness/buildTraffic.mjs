// Test-only bundle: injected fakes never enter a shipped entrypoint.
import { mkdir } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { build } from 'esbuild'

/**
 * Builds the running gate's traffic harness into `root`'s dist/traffic-harness,
 * the folder the harness server for `root` serves. A visual baseline replays a
 * historical revision from its own snapshot root, so the output must land
 * there, not in the working folder.
 */
export async function buildTrafficHarness(root = process.cwd()) {
  const outdir = path.join(root, 'dist', 'traffic-harness')
  await mkdir(outdir, { recursive: true })
  await build({
    entryPoints: { main: fileURLToPath(new URL('trafficHarness.tsx', import.meta.url)) },
    outdir,
    bundle: true,
    splitting: true,
    format: 'esm',
    platform: 'browser',
    target: 'chrome128',
    jsx: 'automatic',
    minify: true,
    define: { 'process.env.NODE_ENV': '"production"' },
    logLevel: 'silent',
  })
}
