import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { transform } from 'esbuild'
import { afterAll, beforeAll, expect, it, vi } from 'vitest'

const fixture = {}

beforeAll(async () => {
  const source = await readFile('scripts/browser-check-restart.mjs', 'utf8')
  const startup = source.slice(source.indexOf('const facts = []'), source.indexOf('// Mid-page:'))
  fixture.folder = await mkdtemp(path.join(tmpdir(), 'muse-browser-readiness-'))
  const file = path.join(fixture.folder, 'startup.mjs')
  const compiled = await transform(
    'export async function observe({ check, runtime, storage, port }) {\n' +
      startup +
      '\nreturn { running };\n}',
    { format: 'esm', target: 'node22' },
  )
  await writeFile(file, compiled.code)
  const module = await import(pathToFileURL(file).href)
  fixture.observe = module.observe
})

afterAll(async () => {
  if (fixture.folder !== undefined) await rm(fixture.folder, { recursive: true, force: true })
})

it('leaves the discovery budget untouched until runtime preparation settles', async () => {
  const preparation = Promise.withResolvers()
  const finished = Promise.withResolvers()
  const prepareRuntime = vi.fn(() => preparation.promise)
  const observed = fixture.observe({
    check: {
      runBrowserCheck: (_request, options) => {
        void options.prepareRuntime({})
        return finished.promise
      },
    },
    runtime: { prepareRuntime },
    storage: 'fixture-storage',
    port: 1,
  })
  const discovery = vi.fn()
  void observed.then(discovery)
  try {
    await Promise.resolve()
    await Promise.resolve()
    expect(prepareRuntime).toHaveBeenCalledOnce()
    expect(discovery).not.toHaveBeenCalled()
    preparation.resolve({ ok: false, reason: 'runtimeMissing' })
    const ready = await observed
    expect(ready.running).toBe(finished.promise)
    expect(discovery).toHaveBeenCalledOnce()
  } finally {
    preparation.resolve({ ok: false, reason: 'runtimeMissing' })
    finished.resolve()
    await observed
  }
})

it('ends the preparation wait when admission refuses before acquiring a runtime', async () => {
  const finished = Promise.withResolvers()
  const prepareRuntime = vi.fn()
  const observed = fixture.observe({
    check: { runBrowserCheck: () => finished.promise },
    runtime: { prepareRuntime },
    storage: 'fixture-storage',
    port: 1,
  })
  const discovery = vi.fn()
  void observed.then(discovery)
  try {
    await Promise.resolve()
    await Promise.resolve()
    expect(discovery).not.toHaveBeenCalled()
    expect(prepareRuntime).not.toHaveBeenCalled()
    finished.resolve()
    const ready = await observed
    expect(ready.running).toBe(finished.promise)
    expect(discovery).toHaveBeenCalledOnce()
  } finally {
    finished.resolve()
    await observed
  }
})
