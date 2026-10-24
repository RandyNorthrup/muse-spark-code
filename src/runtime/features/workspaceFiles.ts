// The workspace's files as the chat reaches them in the runtime (M104 lane B):
// the mention index, attachments read through a confined, race-checked open,
// and the pickers the editor shows over MHP. A path is read only after it is
// confined to the workspace, checked to be the same regular file on both
// sides of the open, and bounded while it is read (a file that grows during
// the read is refused).
import { constants as fsConstants } from 'node:fs'
import { open, realpath } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { MentionIndex } from '../../core/mentionIndex'
import { handleIdentity, sameFile, statIdentity } from '../../core/fs/fileIdentity'
import { confineWorkspacePath } from '../../core/workspacePath'
import type { FileAccess, MentionSearch } from '../../host/conversation/conversationController'
import { createWorkspaceFileLister } from '../../host/mention/workspaceFiles'
import type { Logger } from '../../host/logger'
import {
  MENTION_INDEX_LIMIT,
  MENTION_INDEX_TTL_MS,
  PDF_HEADER_WINDOW_BYTES,
  UI_TEXT,
} from '../../shared/constants'
import type { HostServices } from '../../shared/hostApi/methods'
import { hasPdfHeader } from '../../shared/pdfHeader'
import { walkFiles } from '../fileWalk'
import { unavailable } from './unavailable'

/** Reads only a confined regular file, bounded even when it grows during the read. */
export async function readConfinedBytes(
  file: string,
  root: string,
  maximum: number,
  expected?: string,
  isPrefixOnly = false,
): Promise<Uint8Array> {
  const confined = await confineWorkspacePath(root, path.relative(root, file), process.platform, {
    realPath: realpath,
  })
  if (!confined.ok || (expected !== undefined && confined.checkedAbsolute !== expected))
    return unavailable()
  const handle = await open(confined.checkedAbsolute, fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW)
  try {
    const info = await handleIdentity(handle)
    const after = await realpath(confined.checkedAbsolute)
    const target = await statIdentity(after)
    if (after !== confined.checkedAbsolute || !sameFile(target, info)) return unavailable()
    if (!info.isFile() || (!isPrefixOnly && info.size > BigInt(maximum))) return unavailable()
    const bytes = new Uint8Array(maximum + 1)
    let offset = 0
    for (;;) {
      const next = await handle.read(
        bytes,
        offset,
        (isPrefixOnly ? maximum : bytes.length) - offset,
        null,
      )
      offset += next.bytesRead
      if (offset > maximum) return unavailable()
      if (next.bytesRead === 0 || (isPrefixOnly && offset === maximum)) break
    }
    return bytes.subarray(0, offset)
  } finally {
    await handle.close()
  }
}

export interface RuntimeWorkspaceFilesDeps {
  readonly host: HostServices
  readonly workspaceRoot: string
  readonly log: Logger
  readonly respectGitIgnore: () => boolean
  readonly isWorkspaceTrusted: () => boolean
  readonly runGit: (args: readonly string[], cwd: string) => Promise<string>
}

export interface RuntimeWorkspaceFiles {
  readonly mentions: MentionSearch
  readonly files: FileAccess
  /** The indexed relative paths the host's selection excerpts may be shared from. */
  readonly admits: (relativePath: string) => boolean
  readonly index: MentionIndex
}

/** Mentions and file access for one workspace, the pickers answered by the editor's own. */
export function createRuntimeWorkspaceFiles(
  deps: RuntimeWorkspaceFilesDeps,
): RuntimeWorkspaceFiles {
  const { host, workspaceRoot, log } = deps
  let admitted = new Set<string>()
  const list = createWorkspaceFileLister({
    workspaceRoot,
    respectGitIgnore: deps.respectGitIgnore,
    isWorkspaceTrusted: deps.isWorkspaceTrusted,
    runGit: deps.runGit,
    findFiles: (signal) => walkFiles(workspaceRoot, MENTION_INDEX_LIMIT, log, signal),
    log,
  })
  const index = new MentionIndex({
    listFiles: async () => {
      const found = await list()
      admitted = new Set(found.map((file) => file.replaceAll('\\', '/')))
      return found
    },
    now: Date.now,
    ttlMs: MENTION_INDEX_TTL_MS,
    limit: MENTION_INDEX_LIMIT,
    log,
  })
  const pickable = async (): Promise<Awaited<ReturnType<MentionSearch['search']>>> => {
    const indexed = await index.search('', MENTION_INDEX_LIMIT)
    return indexed.filter((item) => !item.isFolder)
  }
  const files: FileAccess = {
    showOpenDialog: async () => {
      const items = await pickable()
      const picked = await host.request('ui/pick', {
        title: UI_TEXT.attachFile,
        items: items.map((item) => ({ id: item.path, title: item.path })),
        multiple: true,
      })
      if (picked === null) return []
      return picked.map((id) => {
        const item = items.find((candidate) => candidate.path === id)
        if (item === undefined) return unavailable()
        return {
          name: path.basename(item.path),
          fsPath: path.resolve(workspaceRoot, item.path),
          relativePath: item.path,
        }
      })
    },
    readFile: async (file, maximum, expected) => {
      if (maximum === 0)
        return {
          bytes: undefined,
          isPdf: hasPdfHeader(
            await readConfinedBytes(file, workspaceRoot, PDF_HEADER_WINDOW_BYTES, expected, true),
          ),
        }
      const bytes = await readConfinedBytes(file, workspaceRoot, maximum, expected)
      return { bytes, isPdf: hasPdfHeader(bytes) }
    },
    canonicalRelativePath: async (file) => {
      const confined = await confineWorkspacePath(
        workspaceRoot,
        path.relative(workspaceRoot, file),
        process.platform,
        { realPath: realpath },
      )
      return confined.ok
        ? { canonical: confined.canonical, checkedAbsolute: confined.checkedAbsolute }
        : undefined
    },
    pickMentionFile: async () => {
      const items = await pickable()
      const selected = await host.request('ui/pick', {
        title: UI_TEXT.attachFile,
        items: items.map((item) => ({ id: item.path, title: item.path })),
        multiple: false,
      })
      return typeof selected?.[0] === 'string' ? selected[0] : undefined
    },
    toRelativePath: (uri) => {
      try {
        const relative = path.relative(workspaceRoot, fileURLToPath(uri))
        return relative.startsWith('..') || path.isAbsolute(relative)
          ? undefined
          : relative.replaceAll(path.sep, '/')
      } catch (error: unknown) {
        // NARROW: a URI that names no file on this machine is outside the workspace.
        if (error instanceof TypeError) return
        throw error
      }
    },
  }
  return {
    mentions: index,
    files,
    admits: (relativePath) => admitted.has(relativePath),
    index,
  }
}
