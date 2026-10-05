// Test-only bundle: injected fakes never enter a shipped entrypoint.
import { mkdir } from 'node:fs/promises'
import { build } from 'esbuild'

export async function buildTrafficHarness() {
  await mkdir('dist/traffic-harness', { recursive: true })
  await build({
    entryPoints: { main: 'test/harness/trafficHarness.tsx' },
    outdir: 'dist/traffic-harness',
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
