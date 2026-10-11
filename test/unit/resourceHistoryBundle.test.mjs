import { beforeAll, expect, it } from 'vitest'
import { build } from 'esbuild'
import { compactBrowserEnglish } from '../../scripts/lib/uiTextRegions.mjs'

const built = { meta: undefined }
const normalize = (file) => file.replaceAll('\\', '/')

// Share the real production split once; individual tests use the repository's default deadline.
beforeAll(async () => {
  const result = await build({
    entryPoints: {
      main: 'src/webview/main.tsx',
      history: 'test/harness/resource-history-entry.mjs',
    },
    outdir: 'temp/m107-j/bundle-test',
    write: false,
    bundle: true,
    splitting: true,
    minify: true,
    format: 'esm',
    platform: 'browser',
    target: 'chrome128',
    charset: 'utf8',
    define: { 'process.env.NODE_ENV': JSON.stringify('production') },
    jsx: 'automatic',
    plugins: [compactBrowserEnglish],
    metafile: true,
  })
  built.meta = result.metafile
})

function closure(file) {
  const found = new Set()
  const visit = (name) => {
    if (found.has(name)) return
    found.add(name)
    const imports = built.meta.outputs[name].imports
    for (const imported of imports) {
      if (!imported.external && imported.kind !== 'dynamic-import') visit(imported.path)
    }
  }
  visit(file)
  return found
}

it('keeps ResourcesSection in its own dynamic chunk, outside both startup closures', () => {
  const entries = Object.entries(built.meta.outputs)
  const section = entries.find(([, output]) =>
    Object.keys(output.inputs).some((input) =>
      normalize(input).endsWith('/usage/ResourcesSection.tsx'),
    ),
  )
  expect(section).toBeDefined()
  expect(section[0]).toMatch(/ResourcesSection-/)
  for (const [file, output] of entries) {
    if (!(
      normalize(output.entryPoint ?? '') === 'src/webview/main.tsx' ||
      normalize(output.entryPoint ?? '') === 'test/harness/resource-history-entry.mjs'
    )) {
      continue
    }

    const eager = closure(file)
    expect(eager.has(section[0])).toBe(false)
    const inputs = [...eager].flatMap((name) =>
      Object.keys(built.meta.outputs[name].inputs).map((input) => normalize(input)),
    )
    expect(inputs.some((input) => input.endsWith('/usage/ResourcesSection.tsx'))).toBe(false)
  }
})

it('holds the section and its CSS below its independent 25 KiB budget without changing existing caps', () => {
  const entries = Object.entries(built.meta.outputs)
  const section = entries.find(([, output]) =>
    Object.keys(output.inputs).some((input) =>
      normalize(input).endsWith('/usage/ResourcesSection.tsx'),
    ),
  )
  const main = entries.find(
    ([, output]) => normalize(output.entryPoint ?? '') === 'src/webview/main.tsx',
  )
  const harness = entries.find(
    ([, output]) =>
      normalize(output.entryPoint ?? '') === 'test/harness/resource-history-entry.mjs',
  )
  expect(section).toBeDefined()
  expect(main).toBeDefined()
  expect(harness).toBeDefined()
  const eager = new Set([...closure(main[0]), ...closure(harness[0])])
  const deferred = [...closure(section[0])].filter((file) => !eager.has(file))
  const cssBytes =
    section[1].cssBundle === undefined ? 0 : built.meta.outputs[section[1].cssBundle].bytes
  const sectionBytes =
    deferred.reduce((sum, file) => sum + built.meta.outputs[file].bytes, 0) + cssBytes
  expect(sectionBytes).toBeGreaterThan(0)
  expect(sectionBytes).toBeLessThanOrEqual(25 * 1024)
  const mainBytes = [...closure(main[0])].reduce(
    (sum, file) => sum + built.meta.outputs[file].bytes,
    0,
  )
  expect(mainBytes).toBeLessThanOrEqual(900 * 1024)
})
