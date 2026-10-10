import { beforeAll, describe, expect, it } from 'vitest'
import { build } from 'esbuild'

const built = {}
const normalized = (file) => file.replaceAll('\\', '/')

beforeAll(async () => {
  const result = await build({
    entryPoints: ['src/webview/main.tsx'],
    outdir: 'temp/playbook-bundle-test',
    bundle: true,
    format: 'esm',
    platform: 'browser',
    splitting: true,
    target: 'chrome132',
    minify: true,
    metafile: true,
    write: false,
  })
  built.meta = result.metafile
})

function closure(roots) {
  const meta = built.meta
  const found = new Set()
  const visit = (file) => {
    if (found.has(file)) return
    found.add(file)
    const imports = meta.outputs[file].imports
    for (const imported of imports)
      if (!imported.external && imported.kind !== 'dynamic-import') visit(imported.path)
  }
  for (const root of roots) visit(root)
  return found
}

describe('M116 lazy surface budget', () => {
  it('keeps playbook settings, rows, schemas and formatting out of startup', () => {
    const meta = built.meta
    const eager = closure(
      Object.keys(meta.outputs).filter((file) => normalized(file).endsWith('/main.js')),
    )
    const sources = [...eager].flatMap((file) =>
      Object.keys(meta.outputs[file].inputs).map((input) => normalized(input)),
    )
    for (const source of [
      'src/webview/playbook/PlaybookPanel.tsx',
      'src/webview/playbook/PlaybookRows.tsx',
      'src/webview/playbook/PlaybookMap.tsx',
      'src/runtime/playbook/command.ts',
      'src/runtime/playbook/text.ts',
      'src/shared/playbook.ts',
    ])
      expect(sources).not.toContain(source)
  })

  it('bounds the additional lazy closure to its own 25 KiB budget', () => {
    const meta = built.meta
    const eager = closure(
      Object.keys(meta.outputs).filter((file) => normalized(file).endsWith('/main.js')),
    )
    const roots = Object.entries(meta.outputs)
      .filter(([, output]) =>
        [
          'src/webview/playbook/PlaybookPanel.tsx',
          'src/webview/playbook/PlaybookRows.tsx',
          'src/webview/playbook/PlaybookMap.tsx',
        ].includes(normalized(output.entryPoint ?? '')),
      )
      .map(([file]) => file)
    expect(roots).toHaveLength(3)
    const extra = [...closure(roots)].filter((file) => !eager.has(file))
    const bytes = extra.reduce((sum, file) => sum + meta.outputs[file].bytes, 0)
    // M116 rig brief: measured size + 15%, rounded up to 25 KiB. W binds
    // the same entries in scripts/lib/webviewBundles.mjs at integration.
    expect(bytes).toBeLessThanOrEqual(25 * 1024)
  })
})
