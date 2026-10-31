// The release's shared visibility poll (PLAN.md D209): every freshly
// published artifact is re-checked until visible under one shared
// deadline, a late registry does not end the poll, one stop ends it for
// every artifact, every round says what is still pending, and an
// integrity mismatch rejects instead of polling on. The clock and the
// waits are real; the tests shorten only the duration values
// (timeoutMs, delayMs), the way requestTimeoutMs shortens the Tab
// backstop. Visibility is a real file landing in a temp folder on a real
// timer (a missing file throws the kernel's own ENOENT, which polls on),
// and the mismatch is the product's own verifyPublished comparing real
// local bytes against a recorded registry answer: the npm
// dist.integrity line below was captured 2026-10-30 with
// `npm view muse-spark-code-acp@0.19.0 dist.integrity`
// (test/fixtures/publish-registry/npm-0.19.0-dist-integrity.txt).
import { readFileSync, statSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  pollAllVisible,
  publishOnce,
  verifyPublished,
  visibilityDelay,
} from '../../scripts/publish-registry.mjs'
import { usingTempDir } from './helpers/temporaryFolders'

const FIXTURES = new URL('../fixtures/publish-registry/', import.meta.url)

/** Visibility as the poll sees it: the file is there, or the kernel says it is not. */
function fileVerify(folder, label, counts) {
  return async () => {
    counts[label] += 1
    statSync(path.join(folder, label))
  }
}

/** The registry slowly showing an artifact: the file lands on a real timer. */
function appearLater(folder, label, atMs) {
  setTimeout(() => {
    writeFileSync(path.join(folder, label), 'visible\n')
  }, atMs)
}

describe('the release visibility poll (PLAN.md D209)', () => {
  it('re-checks every artifact until each is visible', async () => {
    await usingTempDir('publish-registry-', async (folder) => {
      writeFileSync(path.join(folder, 'alpha'), 'visible\n')
      appearLater(folder, 'beta', 50)
      appearLater(folder, 'gamma', 150)
      const counts = { alpha: 0, beta: 0, gamma: 0 }
      const lines = []
      const result = await pollAllVisible(
        [
          { label: 'alpha', verify: fileVerify(folder, 'alpha', counts) },
          { label: 'beta', verify: fileVerify(folder, 'beta', counts) },
          { label: 'gamma', verify: fileVerify(folder, 'gamma', counts) },
        ],
        {
          timeoutMs: 5000,
          delayMs: 100,
          tell: (line) => {
            lines.push(line)
          },
        },
      )
      expect(result).toEqual({ visible: ['alpha', 'beta', 'gamma'], pending: [] })
      expect(counts).toEqual({ alpha: 1, beta: 2, gamma: 3 })
      expect(lines).toHaveLength(2)
      expect(lines[0]).toContain('beta')
      expect(lines[0]).toContain('gamma')
      expect(lines[0]).not.toContain('alpha')
      expect(lines[1]).toContain('gamma')
      expect(lines[1]).not.toContain('beta')
    })
  })

  it('pends what the shared deadline never shows, and names it', async () => {
    await usingTempDir('publish-registry-', async (folder) => {
      writeFileSync(path.join(folder, 'alpha'), 'visible\n')
      const lines = []
      const started = Date.now()
      const result = await pollAllVisible(
        [
          {
            label: 'alpha',
            verify: fileVerify(folder, 'alpha', { alpha: 0 }),
          },
          {
            label: 'beta',
            verify: fileVerify(folder, 'beta', { beta: 0 }),
          },
        ],
        {
          timeoutMs: 250,
          delayMs: 100,
          tell: (line) => {
            lines.push(line)
          },
        },
      )
      const elapsed = Date.now() - started
      expect(result).toEqual({ visible: ['alpha'], pending: ['beta'] })
      expect(lines.length).toBeGreaterThanOrEqual(1)
      expect(lines[0]).toContain('beta')
      expect(lines.some((line) => line.startsWith('waiting for registry visibility'))).toBe(true)
      // The poll waited between checks instead of pending at once.
      expect(elapsed).toBeGreaterThanOrEqual(150)
    })
  })

  it('keeps polling until a late registry shows the artifact', async () => {
    await usingTempDir('publish-registry-', async (folder) => {
      appearLater(folder, 'npm', 250)
      const lines = []
      const started = Date.now()
      const result = await pollAllVisible(
        [{ label: 'npm', verify: fileVerify(folder, 'npm', { npm: 0 }) }],
        {
          timeoutMs: 500,
          delayMs: 100,
          tell: (line) => {
            lines.push(line)
          },
        },
      )
      const elapsed = Date.now() - started
      expect(result).toEqual({ visible: ['npm'], pending: [] })
      // Several waits passed before the artifact showed: no per-artifact
      // timeout ended the poll early.
      expect(lines.length).toBeGreaterThanOrEqual(2)
      expect(elapsed).toBeGreaterThanOrEqual(200)
    })
  })

  it('shares one stop across artifacts instead of one per artifact', async () => {
    await usingTempDir('publish-registry-', async (folder) => {
      const counts = { a: 0, b: 0 }
      const started = Date.now()
      const result = await pollAllVisible(
        [
          { label: 'a', verify: fileVerify(folder, 'a', counts) },
          { label: 'b', verify: fileVerify(folder, 'b', counts) },
        ],
        { timeoutMs: 5000, delayMs: 100, signal: globalThis.AbortSignal.timeout(150) },
      )
      const elapsed = Date.now() - started
      expect(result).toEqual({ visible: [], pending: ['a', 'b'] })
      expect(counts.a).toBeGreaterThanOrEqual(1)
      expect(counts.b).toBeGreaterThanOrEqual(1)
      // The stop ended the poll at the next round instead of running to
      // the shared deadline.
      expect(elapsed).toBeGreaterThanOrEqual(100)
      expect(elapsed).toBeLessThan(1000)
    })
  })

  it('says what is still pending on every round', async () => {
    await usingTempDir('publish-registry-', async (folder) => {
      writeFileSync(path.join(folder, 'alpha'), 'visible\n')
      appearLater(folder, 'beta', 50)
      const lines = []
      const result = await pollAllVisible(
        [
          {
            label: 'alpha',
            verify: fileVerify(folder, 'alpha', { alpha: 0 }),
          },
          {
            label: 'beta',
            verify: fileVerify(folder, 'beta', { beta: 0 }),
          },
        ],
        {
          timeoutMs: 5000,
          delayMs: 100,
          tell: (line) => {
            lines.push(line)
          },
        },
      )
      expect(result).toEqual({ visible: ['alpha', 'beta'], pending: [] })
      expect(lines).toHaveLength(1)
      expect(lines[0]).toContain('beta')
      expect(lines[0]).not.toContain('alpha')
    })
  })

  it('rejects at once on an integrity mismatch instead of polling on', async () => {
    await usingTempDir('publish-registry-', async (folder) => {
      const recorded = readFileSync(new URL('npm-0.19.0-dist-integrity.txt', FIXTURES), 'utf8')
      const artifact = path.join(folder, 'muse-spark-code-acp-0.19.0.tgz')
      writeFileSync(artifact, readFileSync(new URL('not-the-0.19.0-tarball.txt', FIXTURES), 'utf8'))
      const asked = []
      const lines = []
      await expect(
        pollAllVisible(
          [
            {
              label: 'npm',
              verify: () =>
                verifyPublished(
                  'npm',
                  artifact,
                  { version: '0.19.0' },
                  {
                    run: (file, args) => {
                      asked.push([file, args])
                      return recorded
                    },
                  },
                ),
            },
          ],
          {
            timeoutMs: 300,
            delayMs: 100,
            tell: (line) => {
              lines.push(line)
            },
          },
        ),
      ).rejects.toThrow('npm published integrity differs from the release tarball')
      // The script asked npm for the published integrity, and the mismatch
      // rejected before any round told or waited.
      expect(asked).toEqual([['npm', ['view', 'muse-spark-code-acp@0.19.0', 'dist.integrity']]])
      expect(lines).toHaveLength(0)
    })
  })

  it('refuses an unknown registry before running anything', async () => {
    await expect(
      publishOnce(
        'nope',
        'x.vsix',
        {},
        {
          run: () => {
            throw new Error('must refuse before running anything')
          },
        },
      ),
    ).rejects.toThrow('Unknown registry')
  })

  it('backs visibility polls off 30 s, 60 s, then 120 s', () => {
    expect([
      visibilityDelay(0),
      visibilityDelay(1),
      visibilityDelay(2),
      visibilityDelay(5),
    ]).toEqual([30_000, 60_000, 120_000, 120_000])
  })
})
