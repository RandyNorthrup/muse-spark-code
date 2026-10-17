// Render the served revision's schedule component through its standalone mount.
import { build } from 'esbuild'
export async function buildScheduleHarness(root = process.cwd()) {
  await build({
    absWorkingDir: root,
    entryPoints: ['src/webview/schedules/ScheduleSurface.tsx'],
    outdir: 'temp/m115-v/surface',
    bundle: true,
    format: 'esm',
    platform: 'browser',
    target: 'es2024',
    minify: true,
    define: { 'process.env.NODE_ENV': '"production"' },
  })
}
