// Lane V's separate-page preview. W binds this entry in the shipping build
// after integrating S/U/T; the existing conversation budget is unchanged.
import { build } from 'esbuild'
await build({
  entryPoints: ['src/webview/schedules/ScheduleSurface.tsx'],
  outdir: 'temp/m115-v/surface',
  bundle: true,
  format: 'esm',
  platform: 'browser',
  target: 'es2024',
  minify: true,
  define: { 'process.env.NODE_ENV': '"production"' },
})
