// @vitest-environment jsdom
import { mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, expect, it } from 'vitest'
import { portablePage } from '../../src/runtime/panel/portablePage'
import { EN } from '../../src/shared/l10n/en'
import { setUiText } from '../../src/shared/l10n/text'
import { removeFolder } from './helpers/temporaryFolders'

const rig = { root: '' }
beforeAll(async () => {
  rig.root = await mkdtemp(path.join(tmpdir(), 'portable-page-security-'))
  await writeFile(path.join(rig.root, 'modules.json'), '{"modules":[]}')
  for (const file of ['loader.js', 'main.css', 'whatsNew.css'])
    await writeFile(path.join(rig.root, file), '')
})
afterAll(async () => {
  await removeFolder(rig.root)
})

async function renderDocument(sessionId = 'session'): Promise<Document> {
  const page = await portablePage(rig.root, { kind: 'dark', tokens: {} })
  return new DOMParser().parseFromString(
    page.render({ surface: 'chat', sessionId, surfaceKind: 'chat' }, 'nonce'),
    'text/html',
  )
}

it.each([
  '&lt;img src=x&gt;',
  '<img src=x onerror="attacker()">',
  '</p><script>attacker()</script>',
])('keeps translated launch errors as literal text: %s', async (text) => {
  setUiText({ ...EN, companionLaunchFailed: text }, 'en')
  try {
    const document = await renderDocument()
    const alert = document.querySelector('#launch-error')
    expect(alert?.textContent).toBe(text)
    expect(alert?.children).toHaveLength(0)
    expect(document.querySelectorAll('script')).toHaveLength(5)
  } finally {
    setUiText(EN, 'en')
  }
})

it.each([
  '&quot;',
  '" onload="attacker()',
  '<tag>',
  '</body><script>attacker()</script>',
  "'session",
])('preserves opaque session identifiers without markup: %s', async (sessionId) => {
  const document = await renderDocument(sessionId)
  expect(document.body.dataset['sessionId']).toBe(sessionId)
  expect(document.querySelector('[onload]')).toBeNull()
  expect(document.querySelectorAll('script')).toHaveLength(5)
  expect(JSON.parse(document.querySelector('#muse-panel')?.textContent ?? '')).toEqual({
    surface: 'chat',
    sessionId,
    surfaceKind: 'chat',
  })
})

it('rejects a nonce before either script is rendered', async () => {
  const page = await portablePage(rig.root, { kind: 'dark', tokens: {} })
  expect(() =>
    page.render(
      { surface: 'chat', sessionId: 'session', surfaceKind: 'chat' },
      "nonce' 'unsafe-inline",
    ),
  ).toThrow('MHP_INVALID_NONCE')
})

it.each([
  ['&', '&amp;'],
  ['<', '&lt;'],
  ['>', '&gt;'],
])('encodes the launch-text metacharacter %s once', async (text, encoded) => {
  setUiText({ ...EN, companionLaunchFailed: text }, 'en')
  try {
    const page = await portablePage(rig.root, { kind: 'dark', tokens: {} })
    expect(
      page.render({ surface: 'chat', sessionId: 'session', surfaceKind: 'chat' }, 'nonce'),
    ).toContain(`hidden>${encoded}</p>`)
  } finally {
    setUiText(EN, 'en')
  }
})

it.each([
  ['&', '&amp;'],
  ['"', '&quot;'],
])('encodes the session-attribute delimiter %s once', async (sessionId, encoded) => {
  const page = await portablePage(rig.root, { kind: 'dark', tokens: {} })
  expect(page.render({ surface: 'chat', sessionId, surfaceKind: 'chat' }, 'nonce')).toContain(
    `data-session-id="${encoded}"`,
  )
})

it('embeds manifest import text as inert JSON, including closing tags and line separators', async () => {
  const file = path.join(rig.root, 'modules.json')
  const original = await readFile(file)
  const text = '</script><script>attacker()</script><!--\u{2028}\u{2029}'
  const manifest = {
    modules: [
      {
        path: '/assets/portable/loader.js',
        bytes: 0,
        sha256: '0'.repeat(64),
        imports: [{ start: 0, end: 0, text, target: '/assets/portable/loader.js', dynamic: true }],
      },
    ],
  }
  try {
    await writeFile(file, JSON.stringify(manifest))
    const document = await renderDocument()
    const data = document.querySelector('#muse-modules')?.textContent
    expect(data).not.toMatch(/[<\u{2028}\u{2029}]/u)
    expect(JSON.parse(data ?? '')).toEqual(manifest)
    expect(document.querySelectorAll('script')).toHaveLength(5)
  } finally {
    await writeFile(file, original)
  }
})
