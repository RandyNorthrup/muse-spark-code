// The workbench window's own scheme (desktop/app/scheme.ts): which URLs
// answer, which file each serves, and what each denial refuses.
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { mimeForAppFile, resolveAppFile } from '../../../desktop/app/scheme'
import { DESKTOP_APP_HOST, DESKTOP_APP_SCHEME } from '../../../src/shared/constants'

const APP_DIR = '/opt/muse-desktop/resources/app'

function appUrl(pathname: string): string {
  return `${DESKTOP_APP_SCHEME}://${DESKTOP_APP_HOST}${pathname}`
}

describe('M111 lane BP app scheme', () => {
  it('serves the window files from inside the app folder', () => {
    for (const name of ['index.html', 'renderer.js', 'renderer.TerminalView.js', 'renderer.css']) {
      const resolved = resolveAppFile(APP_DIR, appUrl(`/${name}`))
      expect(resolved).toEqual({ outcome: 'serve', file: path.resolve(APP_DIR, name) })
    }
  })

  it('denies other schemes, hosts and malformed URLs', () => {
    expect(resolveAppFile(APP_DIR, `https://${DESKTOP_APP_HOST}/renderer.js`).outcome).toBe(
      'denied',
    )
    expect(resolveAppFile(APP_DIR, `${DESKTOP_APP_SCHEME}://evil/renderer.js`).outcome).toBe(
      'denied',
    )
    expect(resolveAppFile(APP_DIR, 'not a url').outcome).toBe('denied')
    expect(resolveAppFile(APP_DIR, appUrl('/renderer.js%')).outcome).toBe('denied')
    expect(resolveAppFile(APP_DIR, appUrl('/')).outcome).toBe('denied')
  })

  it('denies escapes, unserved extensions and dotfiles outside the folder', () => {
    expect(resolveAppFile(APP_DIR, appUrl('/../main.mjs')).outcome).toBe('denied')
    expect(resolveAppFile(APP_DIR, appUrl('/%2e%2e/main.mjs')).outcome).toBe('denied')
    // A backslash escape normalises to the same in-folder file, never out.
    expect(resolveAppFile(APP_DIR, appUrl('/..%5crenderer.js'))).toEqual({
      outcome: 'serve',
      file: path.resolve(APP_DIR, 'renderer.js'),
    })
    expect(resolveAppFile(APP_DIR, appUrl('/main.mjs')).outcome).toBe('denied')
    expect(resolveAppFile(APP_DIR, appUrl('/renderer.js.map')).outcome).toBe('denied')
    expect(resolveAppFile(APP_DIR, appUrl('/package.json')).outcome).toBe('denied')
  })

  it('names the module MIME types the window needs', () => {
    expect(mimeForAppFile('/app/renderer.js')).toBe('text/javascript')
    expect(mimeForAppFile('/app/renderer.css')).toBe('text/css')
    expect(mimeForAppFile('/app/index.html')).toBe('text/html')
  })
})
