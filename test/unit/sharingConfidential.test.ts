// Workspace confidentiality (Codex on PR #227): `.vscode/settings.json`
// is JSONC, so comments and trailing commas must still read. Real files in a
// real folder, through the real reader.
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { runtimeSharingConfidential } from '../../src/runtime/sharing/confidential'
import { SETTING_DEFAULTS } from '../../src/shared/constants'
import { removeFolder } from './helpers/temporaryFolders'

const folders: string[] = []
afterEach(async () => {
  await Promise.all(folders.splice(0).map((folder) => removeFolder(folder)))
})

async function workspace(settings: string): Promise<string> {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'm118-confidential-'))
  folders.push(dir)
  await mkdir(path.join(dir, '.vscode'), { recursive: true })
  await writeFile(path.join(dir, '.vscode', 'settings.json'), settings)
  return dir
}

describe('workspace confidentiality settings', () => {
  it('reads an explicit refusal through comments and trailing commas', async () => {
    const dir = await workspace(
      [
        '{',
        '  // Local agents may read this workspace.',
        '  "museSpark.confidentialWorkspace": false, // trailing comma,',
        '  /* a block comment, */',
        '}',
        '',
      ].join('\n'),
    )
    expect(runtimeSharingConfidential(dir)).toBe(false)
  })

  it('reads an explicit grant through a block comment and trailing comma', async () => {
    const dir = await workspace('{"museSpark.confidentialWorkspace": /* secret */ true,}')
    expect(runtimeSharingConfidential(dir)).toBe(true)
  })

  it('falls back to the default when the file is missing or silent', async () => {
    const missing = await mkdtemp(path.join(os.tmpdir(), 'm118-confidential-'))
    folders.push(missing)
    expect(runtimeSharingConfidential(missing)).toBe(SETTING_DEFAULTS.confidentialWorkspace)
    expect(runtimeSharingConfidential(await workspace('{}'))).toBe(
      SETTING_DEFAULTS.confidentialWorkspace,
    )
  })

  it('refuses when the policy is unreadable', async () => {
    expect(runtimeSharingConfidential(await workspace('not json'))).toBeUndefined()
    expect(runtimeSharingConfidential(await workspace('{"a": /* never ends'))).toBeUndefined()
  })
})
