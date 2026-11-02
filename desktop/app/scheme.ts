// Muse Desktop (M111, D91.13) lane BP: the workbench window's own scheme.
// ES module chunks cannot load over file://, so main serves its folder
// over DESKTOP_APP_SCHEME instead. This module is the pure half: which
// URLs answer and which file each serves. Only the app host answers,
// only HTML, script and style files, and only from inside the app
// folder — anything else is denied, never adapted. Main registers the
// privileged scheme and reads the served files; the real-Electron proof
// exercises the whole path.

import path from 'node:path'
import { DESKTOP_APP_HOST, DESKTOP_APP_SCHEME } from '../../src/shared/constants'

const SERVED_EXTENSIONS = new Map([
  ['.html', 'text/html'],
  ['.js', 'text/javascript'],
  ['.css', 'text/css'],
])

export type AppFileResolution =
  { readonly outcome: 'serve'; readonly file: string } | { readonly outcome: 'denied' }

/**
Which file answers an app URL, or denied. The URL must name the app
scheme and host; the path must stay inside the app folder with a served
extension. Windows separators are normalised before comparing.
*/
export function resolveAppFile(appDir: string, url: string): AppFileResolution {
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return { outcome: 'denied' }
  }
  if (parsed.protocol !== `${DESKTOP_APP_SCHEME}:` || parsed.host !== DESKTOP_APP_HOST) {
    return { outcome: 'denied' }
  }
  let decoded: string
  try {
    decoded = decodeURIComponent(parsed.pathname)
  } catch {
    return { outcome: 'denied' }
  }
  const normalized = path.posix.normalize(decoded.replaceAll('\\', '/'))
  const segments = normalized.split('/').filter((segment) => segment.length > 0)
  if (segments.length === 0 || segments.some((segment) => segment === '..' || segment === '.')) {
    return { outcome: 'denied' }
  }
  const extension = path.posix.extname(segments.at(-1) ?? '').toLowerCase()
  if (!SERVED_EXTENSIONS.has(extension)) return { outcome: 'denied' }
  const file = path.resolve(appDir, ...segments)
  const relative = path.relative(path.resolve(appDir), file)
  const isOutside =
    relative === '' ||
    relative === '..' ||
    relative.startsWith(`..${path.sep}`) ||
    path.isAbsolute(relative)
  return isOutside ? { outcome: 'denied' } : { outcome: 'serve', file }
}

/** The content type a served app file answers with. */
export function mimeForAppFile(file: string): string {
  const extension = path.extname(file).toLowerCase()
  return SERVED_EXTENSIONS.get(extension) ?? 'application/octet-stream'
}
