// @vitest-environment jsdom
import { execFile } from 'node:child_process'
import { copyFile, mkdir, mkdtemp, readFile, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { promisify } from 'node:util'
import { expect, it } from 'vitest'
import { withoutCredentials } from '../../src/runtime/credentialVariables'
import { EN } from '../../src/shared/l10n/en'
import { removeFolder } from './helpers/temporaryFolders'

it('serializes every XML metacharacter in product, version and command labels as character data', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'xcode-plist-security-'))
  const scripts = path.join(root, 'hosts/xcode/Scripts')
  const hostile = '&amp;<key>Injected</key> ]]> "quoted" \'apostrophe\''
  try {
    await symlink(path.resolve('node_modules'), path.join(root, 'node_modules'), 'junction')
    await mkdir(scripts, { recursive: true })
    await mkdir(path.join(root, 'src/shared/hostApi'), { recursive: true })
    await mkdir(path.join(root, 'l10n'))
    await copyFile('hosts/xcode/Scripts/generate.mjs', path.join(scripts, 'generate.mjs'))
    await copyFile(
      'src/shared/hostApi/mhp-v1.1.schema.json',
      path.join(root, 'src/shared/hostApi/mhp-v1.1.schema.json'),
    )
    const source = path.resolve('hosts/xcode/Scripts/nativeTables.ts')
    await writeFile(
      path.join(scripts, 'nativeTables.ts'),
      `import { nativeTables as original } from ${JSON.stringify(source)};
export { escapeHtml } from ${JSON.stringify(source)};
export const nativeTables = { ...original, english: { ...original.english,
xcodeTitle: ${JSON.stringify(hostile)}, xcodeAsk: ${JSON.stringify(hostile)} } };`,
    )
    await writeFile(path.join(root, 'package.json'), JSON.stringify({ version: hostile }))
    for (const language of [
      'cs',
      'de',
      'es',
      'fr',
      'hu',
      'it',
      'ja',
      'ko',
      'pl',
      'pt-br',
      'ru',
      'tr',
      'zh-cn',
      'zh-tw',
    ])
      await writeFile(path.join(root, `l10n/ui.${language}.json`), JSON.stringify(EN))
    await promisify(execFile)(process.execPath, [path.join(scripts, 'generate.mjs')], {
      env: withoutCredentials(process.env),
    })
    for (const file of ['App-Info.plist', 'Extension-Info.plist']) {
      const xml = await readFile(path.join(root, 'hosts/xcode/Generated', file), 'utf8')
      const document = new DOMParser().parseFromString(xml, 'text/xml')
      const values = Array.from(document.querySelectorAll('string'), (node) => node.textContent)
      expect(document.querySelector('parsererror')).toBeNull()
      expect(
        Array.from(document.querySelectorAll('key'), (node) => node.textContent),
      ).not.toContain('Injected')
      expect(values.filter((value) => value === hostile)).toHaveLength(
        file === 'App-Info.plist' ? 3 : 4,
      )
    }
  } finally {
    await removeFolder(root)
  }
})
