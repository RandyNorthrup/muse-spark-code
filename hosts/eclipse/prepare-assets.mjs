import { cpSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { buildSync } from 'esbuild'
import { createRequire } from 'node:module'

const directory = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(directory, '../..')
const target = path.join(directory, 'plugin/target')
rmSync(path.join(target, 'assets'), { recursive: true, force: true })
rmSync(path.join(target, 'l10n'), { recursive: true, force: true })
mkdirSync(path.join(target, 'assets'), { recursive: true })
mkdirSync(path.join(target, 'l10n'), { recursive: true })
cpSync(path.join(root, 'LICENSE'), path.join(target, 'assets/LICENSE'))
cpSync(
  path.join(root, 'THIRD_PARTY_NOTICES.txt'),
  path.join(target, 'assets/THIRD_PARTY_NOTICES.txt'),
)
cpSync(path.join(root, 'dist/webview'), path.join(target, 'assets/webview'), { recursive: true })
cpSync(
  path.join(root, 'src/shared/hostApi/mhp-v1.1.schema.json'),
  path.join(target, 'assets/mhp.json'),
)
buildSync({
  entryPoints: [path.join(root, 'src/shared/l10n/en.ts')],
  outfile: path.join(target, 'en.cjs'),
  bundle: true,
  platform: 'node',
  format: 'cjs',
})
const { EN } = createRequire(import.meta.url)(path.join(target, 'en.cjs'))
buildSync({
  entryPoints: [path.join(root, 'src/shared/constants.ts')],
  outfile: path.join(target, 'constants.cjs'),
  bundle: true,
  platform: 'node',
  format: 'cjs',
})
const shared = createRequire(import.meta.url)(path.join(target, 'constants.cjs'))
writeFileSync(
  path.join(target, 'assets/config.json'),
  JSON.stringify({
    nonceBytes: shared.NONCE_BYTES,
    selectionChars: shared.MHP.maximumSelectionChars,
    chunkBytes: shared.BOUNDED_FILE_READ_CHUNK_BYTES,
    credentialNames: [...shared.HOOK_FORBIDDEN_ENV_NAMES],
    languages: [
      'en',
      ...readdirSync(path.join(root, 'l10n'))
        .filter((name) => name.startsWith('ui.') && name.endsWith('.json'))
        .map((name) => name.slice('ui.'.length, -'.json'.length)),
    ],
  }),
)
const languages = [
  'en',
  ...readdirSync(path.join(root, 'l10n'))
    .filter((name) => name.startsWith('ui.') && name.endsWith('.json'))
    .map((name) => name.slice('ui.'.length, -'.json'.length)),
]
const escape = (value) =>
  value
    .replaceAll('\\', '\\\\')
    .replaceAll('\n', String.raw`\n`)
    .replaceAll('\r', String.raw`\r`)
    .replaceAll(/[^\u{20}-\u{7E}]/gu, (character) =>
      character
        .split('')
        .map((unit) => String.raw`\u${unit.codePointAt(0).toString(16).padStart(4, '0')}`)
        .join(''),
    )
for (const language of languages) {
  const table =
    language === 'en'
      ? EN
      : JSON.parse(readFileSync(path.join(root, `l10n/ui.${language}.json`), 'utf8'))
  const manifest = JSON.parse(
    readFileSync(
      path.join(root, language === 'en' ? 'package.nls.json' : `package.nls.${language}.json`),
      'utf8',
    ),
  )
  writeFileSync(path.join(target, `l10n/ui.${language}.json`), JSON.stringify(table))
  const values = {
    displayName: manifest.displayName,
    'command.openInNewTab.title': manifest['command.openInNewTab.title'],
    complete: table.insertCode,
    trust: table.trustGrantedNotice,
  }
  if (Object.values(values).some((value) => typeof value !== 'string'))
    throw new Error('MHP_L10N_MISSING')
  writeFileSync(
    path.join(
      target,
      `l10n/plugin${
        language === 'en'
          ? ''
          : `_${language
              .split('-')
              .map((part, index) => (index === 0 ? part : part.toUpperCase()))
              .join('_')}`
      }.properties`,
    ),
    Object.entries(values)
      .map(([key, value]) => `${key}=${escape(value)}`)
      .join('\n'),
  )
}
