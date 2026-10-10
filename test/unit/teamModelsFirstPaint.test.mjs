// RVCM962 finding 8: the hidden team English chunk must not become a
// prerequisite of any loader that paints the ordinary Models panels.
// Builds the real models entry in memory with the production plugins and
// asserts the bootstrap installs only the ordinary fallbacks, while the
// team sections still pull their own English on first open.
import path from 'node:path'
import { build } from 'esbuild'
import { describe, expect, it } from 'vitest'
import { compactBrowserUiText } from '../../scripts/lib/uiTextRegions.mjs'
import { teamPanelBrowserValidation } from '../../scripts/lib/webviewBundles.mjs'

async function modelsOutputs() {
  const result = await build({
    entryPoints: [path.resolve('src/webview/models/models.tsx')],
    bundle: true,
    platform: 'browser',
    format: 'esm',
    target: 'chrome128',
    splitting: true,
    outdir: 'out',
    write: false,
    metafile: true,
    logLevel: 'silent',
    define: { 'process.env.NODE_ENV': '"production"' },
    plugins: [compactBrowserUiText, teamPanelBrowserValidation],
  })
  return result.outputFiles ?? []
}

describe('M96 models first paint', () => {
  it('paints without the hidden team English while team readers keep it', async () => {
    const files = await modelsOutputs()
    const bootstrap = files.find((file) => path.basename(file.path) === 'models.js')
    if (bootstrap === undefined) throw new Error('Missing models bootstrap')
    expect(bootstrap.text).not.toContain('browser-team-english')
    expect(bootstrap.text).toContain('browser-surface-english')
    expect(bootstrap.text).toContain('browser-account-english')
    const teamReaders = files.filter(
      (file) =>
        file.text.includes('browser-team-english') && path.basename(file.path) !== 'models.js',
    )
    expect(teamReaders.length).toBeGreaterThan(0)
  })
})
