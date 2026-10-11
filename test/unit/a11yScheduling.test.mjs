import { readFileSync } from 'node:fs'
import { setImmediate } from 'node:timers'
import { runInNewContext } from 'node:vm'
import { expect, it, vi } from 'vitest'

it('scans every page once and gives complete streamed replies an uncontended browser', async () => {
  const source = readFileSync(new URL('../../scripts/a11y.mjs', import.meta.url), 'utf8')
  const start = source.indexOf('const results = []')
  const end = source.indexOf('} finally {\n    server.close()', start)
  expect(start).toBeGreaterThan(0)
  expect(end).toBeGreaterThan(start)
  const pages = [
    { scenario: 'palette', theme: 'light' },
    { scenario: 'long', theme: 'light' },
    { scenario: 'legal', theme: 'dark' },
    { scenario: 'long', theme: 'dark' },
  ]
  const scanned = []
  const overlap = []
  let ordinary = 0
  let streaming = 0
  let finishedOrdinary = 0
  const closed = vi.fn()
  const scan = async (_chrome, _context, _port, page) => {
    const isStreaming = page.scenario === 'long'
    if (isStreaming) {
      if (ordinary !== 0 || streaming !== 0 || finishedOrdinary !== 2) overlap.push(page)
      streaming++
    } else ordinary++
    scanned.push(page)
    await new Promise((resolve) => setImmediate(resolve))
    if (isStreaming) streaming--
    else {
      ordinary--
      finishedOrdinary++
    }
    return { violations: [] }
  }
  const results = await runInNewContext(
    `(async () => { ${source.slice(start, end)} } finally {} return results; })()`,
    {
      pages,
      profiles: ['first', 'second'],
      pagesPerWorker: 2,
      chrome: 'chrome',
      port: 1,
      lang: undefined,
      launchWorker: () => Promise.resolve({ close: closed }),
      scan,
    },
  )
  expect(overlap).toEqual([])
  expect(scanned).toHaveLength(pages.length)
  expect(results).toHaveLength(pages.length)
  for (const page of pages)
    expect(scanned.filter((candidate) => candidate === page)).toHaveLength(1)
  expect(ordinary).toBe(0)
  expect(streaming).toBe(0)
  expect(closed).toHaveBeenCalled()
})
