// The English table left out of the Model API bundle (PLAN.md D6, the joint
// M82/M77/M78 amendment): the plugin's own behaviour on small entries, and the
// real bundle it makes. The bundle's handoff of the installed table is tested
// in modelApiBundle.test.ts.

import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { build } from 'esbuild'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { injectedTable } from '../../scripts/lib/injectedTable.mjs'
import { EN } from '../../src/shared/l10n/en'
import { buildModelApiBundle } from './helpers/modelApiBundle'
import { removeFolder } from './helpers/temporaryFolders'

// A sentence only the English table holds.
const ENGLISH_SENTENCE = EN.goalObjectiveMissing

async function bundled(
  source: string,
  resolveDir = path.resolve('.'),
): Promise<{ text: string; errors: readonly string[] }> {
  try {
    const result = await build({
      stdin: { contents: source, resolveDir, loader: 'ts' },
      bundle: true,
      write: false,
      platform: 'node',
      format: 'cjs',
      logLevel: 'silent',
      plugins: [injectedTable()],
    })
    return { text: result.outputFiles.map((file) => file.text).join('\n'), errors: [] }
  } catch (error: unknown) {
    // esbuild's failure names every error in its message.
    return { text: '', errors: [error instanceof Error ? error.message : String(error)] }
  }
}

describe('the English table of a bundle that is handed one', () => {
  const built = { folder: '', file: '' }
  beforeAll(() => {
    built.folder = mkdtempSync(path.join(tmpdir(), 'muse-injected-table-'))
    built.file = buildModelApiBundle(built.folder)
  })
  afterAll(() => removeFolder(built.folder))

  it('leaves the table out of what reads UI_TEXT through text.ts', async () => {
    const { text, errors } = await bundled(
      "import { UI_TEXT } from './src/shared/l10n/text'\nconsole.log(UI_TEXT)",
    )
    expect(errors).toEqual([])
    expect(text).not.toContain(ENGLISH_SENTENCE)
  })

  it('refuses any other value import of the table, so nothing reads it empty', async () => {
    const { errors } = await bundled(
      "import { EN } from './src/shared/l10n/en'\nconsole.log(EN.goalObjectiveMissing)",
    )
    expect(errors).toHaveLength(1)
    expect(errors[0]).toContain('imports the English table')
  })

  it('leaves an import of another file named en alone', async () => {
    const folder = mkdtempSync(path.join(tmpdir(), 'muse-other-en-'))
    try {
      writeFileSync(path.join(folder, 'en.ts'), "export const kept = 'another en kept'\n")
      const { text, errors } = await bundled(
        "import { kept } from './en'\nconsole.log(kept)",
        folder,
      )
      expect(errors).toEqual([])
      expect(text).toContain('another en kept')
    } finally {
      await removeFolder(folder)
    }
  })

  it('makes the Model API bundle without it: neither the sentence nor the table is in the file', () => {
    const text = readFileSync(built.file, 'utf8')
    expect(text).toContain('createModelApiHost')
    expect(text).not.toContain(ENGLISH_SENTENCE)
  })
})
