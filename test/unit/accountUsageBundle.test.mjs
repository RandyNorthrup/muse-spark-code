import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { build } from 'esbuild'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { compactBrowserEnglish } from '../../scripts/lib/uiTextRegions.mjs'

const state = { directory: undefined, result: undefined }
const normalize = (value) => value.replaceAll('\\', '/')
// M102 is absent: a test-only caller supplies its existing React/locale dependencies.
beforeAll(async () => {
  state.directory = await mkdtemp(path.join(tmpdir(), 'm108-j-bundle-'))
  state.result = await build({
    stdin: {
      contents: `export { setUiText } from './src/shared/l10n/text';
        export { createRoot } from 'react-dom/client';
        export { loadAccountsSection } from './src/webview/usage/accountsSectionLoader';`,
      sourcefile: 'usagePage.ts',
      resolveDir: process.cwd(),
      loader: 'ts',
    },
    outdir: state.directory,
    bundle: true,
    splitting: true,
    format: 'esm',
    platform: 'browser',
    jsx: 'automatic',
    target: 'chrome128',
    minify: true,
    metafile: true,
    write: false,
    logLevel: 'silent',
    plugins: [compactBrowserEnglish],
    define: { 'process.env.NODE_ENV': '"production"' },
  })
})
afterAll(async () => {
  if (state.directory !== undefined) await rm(state.directory, { recursive: true, force: true })
})

describe('M108 J lazy section handoff', () => {
  it('keeps the section, formatting and USD arithmetic out of the caller static graph', () => {
    const outputs = state.result.metafile.outputs
    const entry = Object.entries(outputs).find(
      ([, output]) => output.entryPoint === 'usagePage.ts',
    )?.[0]
    expect(entry).toBeDefined()
    const eager = new Set()
    const visit = (file) => {
      if (eager.has(file)) return
      eager.add(file)
      const imports = outputs[file].imports
      for (const imported of imports)
        if (!imported.external && imported.kind !== 'dynamic-import') visit(imported.path)
    }
    visit(entry)
    const inputs = [...eager].flatMap((file) =>
      Object.keys(outputs[file].inputs).map((input) => normalize(input)),
    )
    for (const source of [
      'src/webview/usage/AccountsSection.tsx',
      'src/core/usage/usageText.ts',
      'src/shared/usd.ts',
    ])
      expect(inputs).not.toContain(source)
    const section = Object.entries(outputs).find(([, output]) =>
      normalize(output.entryPoint ?? '').endsWith('/AccountsSection.tsx'),
    )?.[0]
    expect(section).toBeDefined()
    expect(
      [...eager]
        .flatMap((file) => outputs[file].imports)
        .some((imported) => imported.kind === 'dynamic-import' && imported.path === section),
    ).toBe(true)
    const deferred = Object.keys(outputs).filter((file) => file.endsWith('.js') && !eager.has(file))
    const bytes = deferred.reduce((sum, file) => sum + outputs[file].bytes, 0)
    expect(bytes).toBeGreaterThan(0)
    // Independent new surface cap; existing startup/deferred caps are unchanged.
    expect(bytes).toBeLessThanOrEqual(25 * 1024)
    const allInputs = Object.keys(state.result.metafile.inputs).map((input) => normalize(input))
    expect(allInputs).not.toContain('src/core/usage/accountUsage.ts')
    expect(
      allInputs.some(
        (file) => file.startsWith('src/host/') || file.startsWith('src/core/accounts/'),
      ),
    ).toBe(false)
  })
})
