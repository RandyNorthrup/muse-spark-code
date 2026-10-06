import { createHash, randomUUID } from 'node:crypto'
import { constants } from 'node:fs'
import { lstat, mkdir, open, readdir, realpath, rename, unlink } from 'node:fs/promises'
import path from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import {
  ATOMIC_RENAME_ATTEMPTS,
  ATOMIC_RENAME_DELAY_MS,
  CHECKPOINT_STORAGE_MODE,
  REPORT_HISTORY_MAX_PER_KIND,
  REPORT_MAX_SOURCES,
  REPORT_MAX_TEXT_CHARS,
  REPORT_STORAGE_FILE_MODE,
  REPORT_STORAGE_LINK_COUNT,
  REPORT_STORAGE_KEY_PATTERN,
  UI_TEXT,
} from '../../shared/constants'
import { reportsMethods, type ReportsHostPort } from '../../shared/hostApi/reports'
import {
  reportDocumentSchema,
  type ReportDocument,
  type ReportKind,
} from '../../shared/reportSchema'
import { handleIdentity, lstatIdentity, sameFile } from '../fs/fileIdentity'
import { compareReports } from './diff'

/** R supplies canonical, scrubbed JSON and verifies the saved content hash on decode. */
export interface ReportHistoryCodec {
  encode(document: ReportDocument): string
  decode(json: string): ReportDocument
}

interface ReportFiles {
  list(): Promise<string[]>
  read(name: string): Promise<string | undefined>
  write(name: string, text: string): Promise<void>
  remove(name: string): Promise<void>
}

function hasCode(error: unknown, code: string): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === code
}

function validName(name: string): void {
  if (!REPORT_STORAGE_KEY_PATTERN.test(name)) throw new Error(UI_TEXT.reportUi.generationFailed)
}

/** Shared owner-only storage for history and checks; all mutations hold a bucket lock. */
export class ReportStorage {
  public constructor(private readonly agentDataFolder: string) {}

  public async transaction<T>(
    parts: readonly string[],
    isWriting: boolean,
    work: (files: ReportFiles) => Promise<T>,
  ): Promise<T> {
    for (const part of parts) validName(part)
    const root = path.resolve(this.agentDataFolder)
    if (isWriting) await mkdir(root, { recursive: true, mode: CHECKPOINT_STORAGE_MODE })
    let directory = root
    let isMissing = false
    for (const part of ['', 'reports', 'v1', ...parts]) {
      directory = path.join(directory, part)
      if (isWriting) {
        try {
          await mkdir(directory, { mode: CHECKPOINT_STORAGE_MODE })
        } catch (error: unknown) {
          if (!hasCode(error, 'EEXIST')) throw error
        }
      }
      try {
        const info = await lstat(directory)
        if (!info.isDirectory() || info.isSymbolicLink())
          throw new Error(UI_TEXT.reportUi.generationFailed)
      } catch (error: unknown) {
        if (isWriting || !hasCode(error, 'ENOENT')) throw error
        isMissing = true
        break
      }
    }
    const canonical = isMissing ? undefined : await realpath(directory)
    const confined = async () => {
      if (canonical === undefined) throw new Error(UI_TEXT.reportUi.generationFailed)
      const info = await lstat(directory)
      if (info.isSymbolicLink() || (await realpath(directory)) !== canonical)
        throw new Error(UI_TEXT.reportUi.generationFailed)
      // An ancestor must not have become a link into a different tree.
      let ancestor = directory
      while (ancestor !== root) {
        ancestor = path.dirname(ancestor)
        const info = await lstat(ancestor)
        if (info.isSymbolicLink()) throw new Error(UI_TEXT.reportUi.generationFailed)
      }
    }
    const fileFor = (name: string) => {
      validName(name)
      return path.join(directory, name)
    }
    const regular = async (file: string) => {
      const info = await lstatIdentity(file)
      if (
        !info.isFile() ||
        info.isSymbolicLink() ||
        info.nlink !== BigInt(REPORT_STORAGE_LINK_COUNT)
      )
        throw new Error(UI_TEXT.reportUi.generationFailed)
      return info
    }
    const files: ReportFiles = {
      async list() {
        if (isMissing) return []
        await confined()
        return await readdir(directory)
      },
      async read(name) {
        if (isMissing) return
        const file = fileFor(name)
        await confined()
        try {
          const held = await regular(file)
          const handle = await open(
            file,
            constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
          )
          try {
            const actual = await handleIdentity(handle)
            // A bounded allocation even for a corrupt or growing file.
            const maximum = REPORT_MAX_TEXT_CHARS * REPORT_MAX_SOURCES
            if (
              !sameFile(held, actual) ||
              !actual.isFile() ||
              actual.nlink !== BigInt(REPORT_STORAGE_LINK_COUNT) ||
              actual.size > BigInt(maximum)
            )
              throw new Error(UI_TEXT.reportUi.generationFailed)
            const bytes = Buffer.alloc(Number(actual.size) + 1)
            let size = 0
            while (size < bytes.length) {
              const read = await handle.read(bytes, size, bytes.length - size, size)
              if (read.bytesRead === 0) break
              size += read.bytesRead
            }
            await confined()
            if (size > Number(actual.size) || !sameFile(actual, await regular(file)))
              throw new Error(UI_TEXT.reportUi.generationFailed)
            return bytes.subarray(0, size).toString('utf8')
          } finally {
            await handle.close()
          }
        } catch (error: unknown) {
          if (hasCode(error, 'ENOENT')) return
          throw error
        }
      },
      async write(name, text) {
        if (!isWriting || Buffer.byteLength(text) > REPORT_MAX_TEXT_CHARS * REPORT_MAX_SOURCES)
          throw new Error(UI_TEXT.reportUi.saveFailed)
        const target = fileFor(name)
        await confined()
        try {
          await regular(target)
        } catch (error: unknown) {
          if (!hasCode(error, 'ENOENT')) throw error
        }
        const stage = fileFor(`stage-${randomUUID()}`)
        const handle = await open(stage, 'wx', REPORT_STORAGE_FILE_MODE)
        const identity = await handleIdentity(handle)
        const cleanup = async () => {
          await confined()
          try {
            if (sameFile(identity, await regular(stage))) await unlink(stage)
          } catch (error: unknown) {
            if (!hasCode(error, 'ENOENT')) throw error
          }
        }
        try {
          try {
            await confined()
            await handle.writeFile(text, 'utf8')
            await handle.sync()
          } finally {
            await handle.close()
          }
          await confined()
          if (!sameFile(identity, await regular(stage)))
            throw new Error(UI_TEXT.reportUi.saveFailed)
          await rename(stage, target)
        } finally {
          await cleanup()
        }
      },
      async remove(name) {
        if (!isWriting) throw new Error(UI_TEXT.reportUi.saveFailed)
        await confined()
        const file = fileFor(name)
        await regular(file)
        await unlink(file)
      },
    }
    if (!isWriting) return await work(files)
    const lock = fileFor('writer.lock')
    let handle
    for (let attempt = 0; attempt < ATOMIC_RENAME_ATTEMPTS; attempt += 1) {
      await confined()
      try {
        handle = await open(lock, 'wx', REPORT_STORAGE_FILE_MODE)
        break
      } catch (error: unknown) {
        if (!hasCode(error, 'EEXIST') || attempt + 1 === ATOMIC_RENAME_ATTEMPTS) throw error
        await delay(ATOMIC_RENAME_DELAY_MS)
      }
    }
    if (handle === undefined) throw new Error(UI_TEXT.reportUi.saveFailed)
    const identity = await handleIdentity(handle)
    try {
      return await work(files)
    } finally {
      await handle.close()
      await confined()
      if (sameFile(identity, await regular(lock))) await unlink(lock)
    }
  }
}

interface HistoryScope {
  readonly workspaceKey: string
  readonly kind: ReportKind
}

/** Authorization precedes storage access on every surface, including saved-id comparison. */
export class ReportHistory implements Pick<ReportsHostPort, 'history' | 'get' | 'compare'> {
  public constructor(
    private readonly deps: {
      readonly storage: ReportStorage
      readonly codec: ReportHistoryCodec
      readonly keepHistory: () => boolean
      readonly authorize: (scope: HistoryScope) => Promise<void>
    },
  ) {}

  private async entries(files: ReportFiles, kind: ReportKind) {
    const entries: { id: string; document: ReportDocument }[] = []
    const names = await files.list()
    for (const name of names) {
      if (!/^[a-f0-9]+\.json$/.test(name)) continue
      const text = await files.read(name)
      if (text === undefined) continue
      const document = reportDocumentSchema.parse(this.deps.codec.decode(text))
      const id = createHash('sha256').update(text).digest('hex')
      if (name !== `${id}.json` || document.header.kind !== kind)
        throw new Error(UI_TEXT.reportUi.generationFailed)
      entries.push({ id, document })
    }
    return entries.toSorted((a, b) => {
      const date = Date.parse(b.document.header.asOf) - Date.parse(a.document.header.asOf)
      if (date !== 0) return date
      if (a.id < b.id) return -1
      return a.id > b.id ? 1 : 0
    })
  }

  public async save(workspaceKey: string, input: ReportDocument) {
    if (!this.deps.keepHistory()) return { status: 'disabled' as const }
    const document = reportDocumentSchema.parse(input)
    const scope = reportsMethods['reports/history'].params.parse({
      workspaceKey,
      kind: document.header.kind,
    })
    await this.deps.authorize(scope)
    const text = this.deps.codec.encode(document)
    const verified = reportDocumentSchema.parse(this.deps.codec.decode(text))
    if (verified.header.kind !== scope.kind) throw new Error(UI_TEXT.reportUi.saveFailed)
    const id = createHash('sha256').update(text).digest('hex')
    await this.deps.storage.transaction(
      ['history', workspaceKey, scope.kind],
      true,
      async (files) => {
        await files.write(`${id}.json`, text)
        const entries = await this.entries(files, scope.kind)
        for (const entry of entries.slice(REPORT_HISTORY_MAX_PER_KIND))
          await files.remove(`${entry.id}.json`)
      },
    )
    return { status: 'saved' as const, entry: { id, header: verified.header } }
  }

  public async history(
    input: Parameters<ReportsHostPort['history']>[0],
  ): ReturnType<ReportsHostPort['history']> {
    try {
      const scope = reportsMethods['reports/history'].params.parse(input)
      await this.deps.authorize(scope)
      const entries = await this.deps.storage.transaction(
        ['history', scope.workspaceKey, scope.kind],
        false,
        async (files) => {
          const saved = await this.entries(files, scope.kind)
          return saved
            .slice(0, REPORT_HISTORY_MAX_PER_KIND)
            .map(({ id, document }) => ({ id, header: document.header }))
        },
      )
      return { status: 'listed', entries }
    } catch {
      return { status: 'failed', reason: UI_TEXT.reportUi.generationFailed }
    }
  }

  public async get(
    input: Parameters<ReportsHostPort['get']>[0],
  ): ReturnType<ReportsHostPort['get']> {
    try {
      const scope = reportsMethods['reports/get'].params.parse(input)
      await this.deps.authorize(scope)
      const document = await this.deps.storage.transaction(
        ['history', scope.workspaceKey, scope.kind],
        false,
        async (files) => {
          const saved = await this.entries(files, scope.kind)
          return saved.find((entry) => entry.id === scope.id)?.document
        },
      )
      if (document !== undefined) return { status: 'retrieved', document }
    } catch {
      // Malformed, redirected and foreign history is unavailable, never regenerated.
    }
    return { status: 'failed', reason: UI_TEXT.reportUi.generationFailed }
  }

  public async compare(
    input: Parameters<ReportsHostPort['compare']>[0],
  ): ReturnType<ReportsHostPort['compare']> {
    try {
      const scope = reportsMethods['reports/compare'].params.parse(input)
      const from = await this.get({
        workspaceKey: scope.workspaceKey,
        kind: scope.kind,
        id: scope.fromId,
      })
      const to = await this.get({
        workspaceKey: scope.workspaceKey,
        kind: scope.kind,
        id: scope.toId,
      })
      if (from.status === 'retrieved' && to.status === 'retrieved')
        return { status: 'compared', diff: compareReports(from.document, to.document) }
    } catch {
      // Both saved ids must remain inside the authorized workspace and kind.
    }
    return { status: 'failed', reason: UI_TEXT.reportUi.generationFailed }
  }
}
