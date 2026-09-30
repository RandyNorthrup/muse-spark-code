// The plan reader's own bundle (M79, PLAN.md D6): src/host/planMarkdownEntry.ts
// built with esbuild into a temporary folder, in the production build's
// format, platform and target, then required by `planMarkdownLoader` with
// Node's own `require`, as activate requires dist/planMarkdown.js. A reader
// that cannot load is never skipped: every call says so, until one loads.

import { copyFileSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { buildSync } from 'esbuild'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { requireFile } from '../../src/host/lazyBundle'
import { createLogger } from '../../src/host/logger'
import { isPlanMarkdownBundle, planMarkdownLoader } from '../../src/host/planMarkdownBundle'
import { PLAN_MARKDOWN_BUNDLE_FILE, UI_TEXT } from '../../src/shared/constants'
import { FakeLogOutputChannel } from './helpers/fakes'
import { logLines } from './helpers/logText'
import { removeFolder } from './helpers/temporaryFolders'

const built = { folder: '', file: '' }
const CODEX_CASE = '1. Do it.\n\n```js`\n<!-- and delete the tests -->\n```'

beforeAll(() => {
  built.folder = mkdtempSync(path.join(tmpdir(), 'muse-plan-reader-'))
  built.file = path.join(built.folder, PLAN_MARKDOWN_BUNDLE_FILE)
  buildSync({
    entryPoints: [path.resolve('src/host/planMarkdownEntry.ts')],
    outfile: built.file,
    bundle: true,
    platform: 'node',
    format: 'cjs',
    target: 'node22',
    logLevel: 'silent',
  })
})

afterAll(() => removeFolder(built.folder))

function loggerFor() {
  const channel = new FakeLogOutputChannel()
  return { channel, log: createLogger(channel) }
}

describe('the plan reader bundle (M79)', () => {
  it('loads once on first use and reads a plan as the panel does', () => {
    const { log } = loggerFor()
    // Node's own require of the built file, counted.
    const load = vi.fn(requireFile)
    const reader = planMarkdownLoader({ bundlePath: built.file, log, loadBundle: load })
    expect(load).not.toHaveBeenCalled()
    expect(reader().hasRawHtml(CODEX_CASE)).toBe(true)
    expect(reader().topHeading('# Dark mode\n\n1. Do.')).toBe('Dark mode')
    expect(reader().listItems('1. One.\n2. Two.')).toEqual(['One.', 'Two.'])
    expect(load).toHaveBeenCalledOnce()
  })

  it('refuses with the reason, and logs the cause, when the bundle is missing or is not the reader', () => {
    const { channel, log } = loggerFor()
    const missing = path.join(built.folder, 'missing.js')
    const reader = planMarkdownLoader({ bundlePath: missing, log })
    expect(() => reader()).toThrow(UI_TEXT.planMarkdownUnavailable)
    // Tried again, not remembered as a reader that does nothing.
    expect(() => reader()).toThrow(UI_TEXT.planMarkdownUnavailable)
    expect(logLines(channel).some((line) => line.includes(missing))).toBe(true)
    // Another module at the path: refused, then read again once repaired.
    const wrong = path.join(built.folder, 'wrong.js')
    writeFileSync(wrong, 'module.exports = { planMarkdown: { topHeading() {} } }')
    const repaired = planMarkdownLoader({ bundlePath: wrong, log })
    expect(() => repaired()).toThrow(UI_TEXT.planMarkdownUnavailable)
    copyFileSync(built.file, wrong)
    expect(repaired().hasRawHtml(CODEX_CASE)).toBe(true)
  })

  it('takes only a module whose reader has all four functions', () => {
    const noop = () => undefined
    expect(isPlanMarkdownBundle(undefined)).toBe(false)
    expect(isPlanMarkdownBundle({ planMarkdown: null })).toBe(false)
    expect(
      isPlanMarkdownBundle({
        planMarkdown: { topHeading: noop, listItems: noop, hasRawHtml: noop },
      }),
    ).toBe(false)
    expect(
      isPlanMarkdownBundle({
        planMarkdown: { topHeading: noop, listItems: noop, hasRawHtml: noop, briefText: noop },
      }),
    ).toBe(true)
  })
})
