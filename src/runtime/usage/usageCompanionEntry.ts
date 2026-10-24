// Usage is a handler and page on M104 C's server; it owns no second listener.
import { randomUUID } from 'node:crypto'
import { homedir } from 'node:os'
import { readdir, readFile, realpath } from 'node:fs/promises'
import path from 'node:path'
import { isErrno } from '../../core/fs/errno'
import { startCompanionServer, type CompanionAsset } from '../companion/server'
import { renderCompanionPage } from '../companion/page'
import { agentDataFolder } from '../dataFolder'
import { usageCompanionEventSchema, usageCompanionRequestSchema } from '../../shared/usageCompanion'
import type { UsageCompanionEvent } from '../../shared/usageCompanion'
import type { UsageAccess, UsagePageConnection } from './usageAdapter'
import type { UsageServiceToPageMessage } from '../../shared/usagePage'
import { USAGE_TEXT, loadUsageTable, setUsageText } from '../../shared/l10n/usageTable'
import { readUsageTableFile } from './usageTableFile'
import { setUiText } from '../../shared/l10n/text'
import { usageDeleteDetail } from '../../shared/usageDeleteText'
import type { UiText } from '../../shared/l10n/en'
import type { CoreLogger } from '../../core/logging'
import {
  FONT_PACK_SUBFOLDER,
  USAGE_COMPANION_IDLE_MS,
  USAGE_RECORD_MAX_BYTES,
  USAGE_COMPANION_EVENT_BYTES,
  USAGE_BROWSER_EXPORT_MAX_BYTES,
  USAGE_COMPANION_REQUEST_MS,
  USAGE_COMPANION_MAX_WINDOWS,
  USAGE_STALE_MS,
} from '../../shared/constants'

interface WindowConnection {
  readonly connection: UsagePageConnection
  readonly emit: (message: UsageCompanionEvent) => void
  replies: UsageServiceToPageMessage[]
  download?: { name: string; mimeType: 'text/csv' | 'application/json'; content: string }
  queue: Promise<void>
}
function unsupported(): never {
  throw new Error(USAGE_TEXT.unsupported)
}
function emitReply(current: WindowConnection, id: string): void {
  current.emit({
    type: 'reply',
    id,
    messages: current.replies,
    ...(current.download !== undefined && { download: current.download }),
  })
}
/** An installed font pack version, served only when `fonts install` published it. */
export interface CompanionFontPack {
  readonly directory: string
  readonly files: readonly string[]
}

const FONT_PACK_VERSION_PATTERN = /^[a-z\d-]+-[a-f\d]{64}$/
const FONT_PACK_FILE_PATTERN = /^(?:fonts\.css|[a-z][a-z\d-]*\.woff2)$/

function compareNames(left: string, right: string): number {
  if (left === right) return 0
  return left < right ? -1 : 1
}

/** The servable files of one version directory, or undefined when unusable. */
async function probePackVersion(
  fontsRoot: string,
  directory: string,
): Promise<readonly string[] | undefined> {
  const contained = await realpath(directory)
  // The version folder itself stays in the fonts root: a linked one (a
  // junction on Windows) would serve files from anywhere it points.
  if (path.dirname(contained) !== fontsRoot) return undefined
  const entries = await readdir(directory)
  const files = entries.filter((file) => FONT_PACK_FILE_PATTERN.test(file)).toSorted(compareNames)
  if (!files.includes('fonts.css')) return undefined
  for (const file of files)
    if (path.dirname(await realpath(path.join(directory, file))) !== contained) return undefined
  return files
}

/**
Locate the installed local-font pack without trusting names: version
directories match the installer's publication shape and stay in the fonts
root, and every served file is realpath-contained and allowlisted. Returns
undefined when no pack is installed; the page then uses the system font
stack.
*/
export async function findCompanionFontPack(
  fontsRoot: string,
): Promise<CompanionFontPack | undefined> {
  let entries: string[]
  let root: string
  try {
    root = await realpath(fontsRoot)
    entries = await readdir(root)
  } catch (error: unknown) {
    // An unreadable fonts root has no pack; the page uses the system stack.
    if (!isErrno(error)) throw error
    return undefined
  }
  const versions = entries
    .filter((entry) => FONT_PACK_VERSION_PATTERN.test(entry))
    .toSorted(compareNames)
  for (const version of versions.toReversed()) {
    try {
      const files = await probePackVersion(root, path.join(fontsRoot, version))
      if (files !== undefined) return { directory: path.join(fontsRoot, version), files }
    } catch (error: unknown) {
      // An unreadable version is skipped for the next older one.
      if (!isErrno(error)) throw error
      continue
    }
  }
  return undefined
}

export async function openUsageCompanion(deps: {
  readonly usage: UsageAccess
  readonly assetsFolder: string
  readonly locale: string
  readonly uiText: UiText
  readonly log: CoreLogger
  /** Overrides the installed-fonts root (tests); defaults to the user's data folder. */
  readonly fontsRoot?: string | undefined
}) {
  setUiText(deps.uiText, deps.locale)
  const table = await loadUsageTable({
    language: deps.locale,
    readTableFile: (segments) =>
      readUsageTableFile(path.join(deps.assetsFolder, '..', '..'), segments),
    warn: (message) => {
      deps.log.warn(message)
    },
  })
  setUsageText(table.table)
  const assets = new Map<string, CompanionAsset>()
  const root = await realpath(deps.assetsFolder)
  const imports: Record<string, string> = {}
  const modules = new Map<string, string>()
  const loadModule = async (name: string): Promise<string> => {
    const specifier = `muse-usage/${name}`
    if (modules.has(name)) return specifier
    const source = path.join(root, name)
    if (!source.startsWith(`${root}${path.sep}`) || (await realpath(source)) !== source)
      throw new Error('EPANEL_ASSET')
    modules.set(name, '')
    let content = await readFile(source, 'utf8')
    for (const match of content.matchAll(
      /\b(from\s*|import\s*(?:\(\s*)?)["'](\.[^"']+\.js)["']/gu,
    )) {
      const relative = match[2]
      const prefix = match[1]
      if (relative === undefined || prefix === undefined) throw new Error('EPANEL_ASSET')
      const dependency = path.posix.normalize(path.posix.join(path.posix.dirname(name), relative))
      if (!/^(?:chunks\/)?[\w-]+\.js$/u.test(dependency)) throw new Error('EPANEL_ASSET')
      const target = await loadModule(dependency)
      content = content.replace(match[0], () => `${prefix}${JSON.stringify(target)}`)
    }
    modules.set(name, content)
    imports[specifier] = `data:text/javascript;charset=utf-8,${encodeURIComponent(content)}`
    return specifier
  }
  await loadModule('usage.js')
  // M114 C-M114-1: the theme closure's emitted sheets ride static files, so
  // no stylesheet enters the JavaScript chunks or the entry CSS budget. A
  // missing sheet is a broken install and throws, never an unthemed page.
  const stylesheets = ['/usage.css', '/theme.css']
  for (const name of ['usage.js', 'usage.css', 'theme.css']) {
    const source = path.join(root, name)
    // A missing file realpaths to ENOENT; the page reports a broken install
    // either way, never a half-asset page.
    let contained: string | undefined
    try {
      contained = await realpath(source)
    } catch (error: unknown) {
      if (!isErrno(error)) throw error
      contained = undefined
    }
    if (contained !== source) throw new Error('EPANEL_ASSET')
    assets.set(`/${name}`, {
      content: modules.get(name) ?? (await readFile(source)),
      contentType: name.endsWith('.css') ? 'text/css' : 'text/javascript',
    })
  }
  // M114 C-M114-1: the installed local-font pack, served only after `fonts
  // install` published it. Absent without it; the page uses the system stack.
  const fontsRoot =
    deps.fontsRoot ??
    path.join(
      agentDataFolder({ platform: process.platform, env: process.env, homeDir: homedir() }),
      FONT_PACK_SUBFOLDER,
    )
  const fontPack = await findCompanionFontPack(fontsRoot)
  if (fontPack !== undefined) {
    const packRoot = await realpath(fontPack.directory)
    for (const file of fontPack.files) {
      const source = path.join(packRoot, file)
      if (path.dirname(await realpath(source)) !== packRoot) throw new Error('EPANEL_ASSET')
      assets.set(`/fonts/${file}`, {
        content: await readFile(source),
        contentType: file.endsWith('.css') ? 'text/css' : 'font/woff2',
      })
    }
    stylesheets.push('/fonts/fonts.css')
  }
  const connections = new Map<string, WindowConnection>()
  const approvals = new Map<
    string,
    { session: string; count: number; resolve(isApproved: boolean): void }
  >()
  return await startCompanionServer({
    limits: {
      maxBodyBytes: USAGE_RECORD_MAX_BYTES,
      maxEventBytes: USAGE_COMPANION_EVENT_BYTES,
      requestTimeoutMs: USAGE_COMPANION_REQUEST_MS,
      idleTimeoutMs: USAGE_COMPANION_IDLE_MS,
      launchCodeTtlMs: USAGE_STALE_MS,
      sessionTtlMs: USAGE_COMPANION_IDLE_MS,
      maxSessions: USAGE_COMPANION_MAX_WINDOWS,
    },
    assets,
    renderPage: (nonce) =>
      renderCompanionPage(nonce, {
        locale: table.locale,
        title: table.table.title,
        stylesheets,
        modules: ['/usage.js'],
        imports,
        uiTable: { locale: deps.locale, table: deps.uiText },
        usageTable: { type: 'usage/table', ...table },
      }),
    handler: {
      inputSchema: usageCompanionRequestSchema,
      outputSchema: usageCompanionEventSchema,
      subscribe: (session, emit) => {
        const state: WindowConnection = {
          emit,
          replies: [],
          queue: Promise.resolve(),
          connection: deps.usage.connect({
            post: (message) => {
              connections.get(session)?.replies.push(message)
            },
            saveFile: (content, format) => {
              const current = connections.get(session)
              if (current === undefined) return Promise.resolve(false)
              current.download = {
                name: `usage.${format}`,
                mimeType: format === 'json' ? 'application/json' : 'text/csv',
                content,
              }
              return Promise.resolve(true)
            },
            exportMaxBytes: USAGE_BROWSER_EXPORT_MAX_BYTES,
            confirmDelete: (count, resources) =>
              new Promise<boolean>((resolve) => {
                const id = randomUUID()
                approvals.set(id, { session, count, resolve })
                emit({
                  type: 'confirm',
                  id,
                  count,
                  detail: usageDeleteDetail(count, resources),
                })
              }),
            setHistory: deps.usage.setHistory ?? unsupported,
          }),
        }
        connections.set(session, state)
        return () => {
          state.connection.dispose()
          connections.delete(session)
          for (const [id, approval] of approvals)
            if (approval.session === session) {
              approval.resolve(false)
              approvals.delete(id)
            }
        }
      },
      post: async (request, session, signal) => {
        if (request.type === 'confirm') {
          const approval = approvals.get(request.id)
          if (approval?.session !== session || approval.count !== request.count)
            throw new Error('EPANEL_CONFIRM')
          approvals.delete(request.id)
          approval.resolve(request.approved)
          return
        }
        const current = connections.get(session)
        if (current === undefined) throw new Error('EPANEL_STREAM')
        const previous = current.queue
        const next = (async () => {
          await previous
          signal.throwIfAborted()
          current.replies = []
          delete current.download
          const abort = () => {
            for (const [id, approval] of approvals)
              if (approval.session === session) {
                approval.resolve(false)
                approvals.delete(id)
              }
          }
          signal.addEventListener('abort', abort, { once: true })
          try {
            await current.connection.receive(request.message)
            signal.throwIfAborted()
            emitReply(current, request.id)
          } finally {
            signal.removeEventListener('abort', abort)
          }
        })()
        current.queue = (async () => {
          try {
            await next
          } catch {
            /* The request reports its error; later requests may still run. */
          }
        })()
        await next
      },
    },
  })
}
