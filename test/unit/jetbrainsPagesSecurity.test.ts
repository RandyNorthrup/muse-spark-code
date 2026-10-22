// @vitest-environment jsdom
import { execFile } from 'node:child_process'
import { copyFile, mkdir, mkdtemp, readFile, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { promisify } from 'node:util'
import { afterAll, beforeAll, expect, it } from 'vitest'
import { withoutCredentials } from '../../src/runtime/credentialVariables'

const rig = { root: '' }
beforeAll(async () => {
  rig.root = await mkdtemp(path.join(tmpdir(), 'jetbrains-pages-security-'))
  for (const folder of ['src', 'l10n', 'node_modules'])
    await symlink(path.resolve(folder), path.join(rig.root, folder), 'junction')
  const host = path.join(rig.root, 'hosts/jetbrains')
  await mkdir(path.join(host, 'src/main/resources'), { recursive: true })
  for (const file of [
    'build-resources.mjs',
    'check-bundle-size.mjs',
    'src/main/resources/nativeModules.mjs',
  ])
    await copyFile(path.join('hosts/jetbrains', file), path.join(host, file))
  const webview = path.join(rig.root, 'dist/webview')
  await mkdir(path.join(webview, 'portable'), { recursive: true })
  await writeFile(path.join(webview, 'whatsNew.js'), 'export {}')
  await writeFile(path.join(webview, 'portable/main.js'), '')
  await writeFile(
    path.join(webview, 'portable/modules.json'),
    JSON.stringify({
      modules: [
        { path: '/assets/portable/main.js', bytes: 0, sha256: '0'.repeat(64), imports: [] },
      ],
    }),
  )
  await writeFile(path.join(rig.root, 'dist/whatsNew.json'), '{"schema":1,"releases":[]}')
  await writeFile(path.join(rig.root, 'package.json'), '{"version":"0.17.0"}')
  await promisify(execFile)(process.execPath, [path.join(host, 'build-resources.mjs')], {
    env: withoutCredentials(process.env),
  })
})
afterAll(async () => {
  const { removeFolder } = await import('./helpers/temporaryFolders')
  await removeFolder(rig.root)
})

it.each(['chat', 'tasks', 'whatsNew'])(
  'generates %s with external nonce-bearing scripts and no executable bridge placeholder',
  async (kind) => {
    for (const language of [
      'en',
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
    ]) {
      const html = await readFile(
        path.join(rig.root, `hosts/jetbrains/build/generated/pages/${kind}.${language}.html`),
        'utf8',
      )
      const document = new DOMParser().parseFromString(html, 'text/html')
      expect(document.documentElement.lang).toBe(language)
      expect(html).not.toContain('__MUSE_BRIDGE__')
      const scripts = document.querySelectorAll('script:not([type="application/json"])')
      expect(scripts.length).toBeGreaterThan(0)
      for (const script of scripts) {
        expect(script.getAttribute('src')).toMatch(/^__MUSE_ASSET_BASE__/u)
        expect(script.getAttribute('nonce')).toBe('__MUSE_NONCE__')
        expect(script.textContent).toBe('')
      }
      const csp = document
        .querySelector('meta[http-equiv="Content-Security-Policy"]')
        ?.getAttribute('content')
      expect(csp).toContain("default-src 'none'")
      expect(csp).toContain("script-src 'nonce-__MUSE_NONCE__'")
      expect(csp).not.toContain('unsafe-inline')
      expect(csp).not.toContain('unsafe-eval')
    }
  },
)
