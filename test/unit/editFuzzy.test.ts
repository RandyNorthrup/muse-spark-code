import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import {
  executeTool,
  type ToolContext,
  type ToolOutcome,
} from '../../src/core/backends/modelapi/tools'
import { headlessToolIo } from './helpers/headlessToolIo'

// Fuzzy edit_file matching (M101 item 12, Pi's edit-diff): real files in a
// real temp folder through the real IO and tool layers — exact first, one
// normalised retry requiring a unique match, untouched bytes preserved.
const root = mkdtempSync(path.join(tmpdir(), 'editfuzz-'))
const files = { count: 0 }

async function edit(
  name: string,
  content: string,
  find: string,
  replace: string,
): Promise<{ outcome: ToolOutcome; bytes: string }> {
  files.count += 1
  const file = `${String(files.count)}-${name}`
  writeFileSync(path.join(root, file), content)
  const seen = new Map<string, string>()
  const provisionalSeen = new Map<string, string>()
  const context: ToolContext = {
    workspaceRoot: root,
    platform: process.platform,
    io: headlessToolIo(root),
    seen,
    provisionalSeen,
  }
  const outcome = await executeTool(
    'edit_file',
    JSON.stringify({ path: file, find, replace }),
    context,
  )
  for (const [absolute, hash] of provisionalSeen) seen.set(absolute, hash)
  return { outcome, bytes: readFileSync(path.join(root, file), 'utf8') }
}

afterAll(() => {
  rmSync(root, { recursive: true, force: true })
})

describe('edit_file fuzzy fallback', () => {
  it.each([
    ['quotes and dash', '\u{201C}a\u{201D}\u{2014}\n', '"a"-', '"b"-'],
    ['non-breaking hyphen', 'a\u{2011}b\n', 'a-b', 'a+b'],
    ['no-break space', 'a\u{00A0}b\n', 'a b', 'a+b'],
    ['trailing space', 'code \nmore\n', 'code\nmore', 'code2\nmore2'],
    ['NFKC ligature', '\u{FB01}\n', 'fi', 'fx'],
  ])('edits through %s', async (_label, content, find, replace) => {
    const { outcome, bytes } = await edit('fuzzy.txt', content, find, replace)
    expect(outcome.failureReason).toBeUndefined()
    expect(bytes).toBe(`${replace}\n`)
  })

  it('refuses an ambiguous normalised match and leaves the file alone', async () => {
    const content = '\u{2018}a\u{2019}\nx\n\u{2018}a\u{2019}\n'
    const { outcome, bytes } = await edit('ambiguous.txt', content, "'a'", 'b')
    expect(outcome.failureReason).toBeDefined()
    expect(bytes).toBe(content)
  })

  it('copies untouched lines back byte-exact', async () => {
    const { outcome, bytes } = await edit(
      'untouched.txt',
      'keep \u{2019}this\u{2019}\nchange \u{2019}that\u{2019}\n',
      "change 'that'",
      "change 'other'",
    )
    expect(outcome.failureReason).toBeUndefined()
    expect(bytes).toBe("keep \u{2019}this\u{2019}\nchange 'other'\n")
  })

  it('keeps CRLF breaks and the BOM across a normalised edit', async () => {
    const { outcome, bytes } = await edit(
      'crlf.txt',
      '\u{FEFF}\u{201C}first\u{201D}\r\nsecond\r\n',
      '"first"',
      '"1st"',
    )
    expect(outcome.failureReason).toBeUndefined()
    expect(bytes).toBe('\u{FEFF}"1st"\r\nsecond\r\n')
  })

  it('refuses find equal to replace and leaves the file alone', async () => {
    const { outcome, bytes } = await edit('nochange.txt', 'same\n', 'same', 'same')
    expect(outcome.failureReason).toBeDefined()
    expect(bytes).toBe('same\n')
  })
})
