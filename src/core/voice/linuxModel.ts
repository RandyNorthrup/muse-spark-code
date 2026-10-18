import { createHash } from 'node:crypto'
import { constants } from 'node:fs'
import { lstat, mkdir, mkdtemp, open, readdir, rename, rm, rmdir, unlink } from 'node:fs/promises'
import path from 'node:path'
import * as z from 'zod/mini'
import { UI_TEXT } from '../../shared/constants'
import { LINUX_DICTATION } from '../../shared/linuxDictationConstants'

export interface LinuxModelPin {
  readonly bytes: number
  readonly sha256: string
  readonly url: string
}
export interface LinuxModelDeps {
  readonly directory: string
  readonly fetch: typeof fetch
  readonly consent: (signal: AbortSignal) => Promise<boolean>
  readonly pin?: LinuxModelPin
}

/** One pinned file inside a download directory: the model or a helper file. */
export interface LinuxPinnedTarget extends LinuxModelPin {
  readonly file: string
  readonly partial: string
  /** Owner-only for data; executable for the helper binary. */
  readonly mode: number
}

function isMissing(error: unknown): boolean {
  return error instanceof Error && 'code' in error && error.code === 'ENOENT'
}

/** The lock directory already exists under another name: someone owns it. */
function isOwned(error: unknown): boolean {
  return (
    error instanceof Error &&
    'code' in error &&
    typeof error.code === 'string' &&
    ['EEXIST', 'ENOTEMPTY', 'EPERM', 'EACCES'].includes(error.code)
  )
}
async function removeFile(file: string): Promise<void> {
  try {
    await unlink(file)
  } catch (error: unknown) {
    if (!isMissing(error)) throw error
  }
}

export interface PinnedDownloadDeps {
  readonly directory: string
  readonly fetch: typeof fetch
}

/**
 * One pinned download: a crash leaves resumable bytes, never usable
 * unchecked bytes. The model and every helper file share this path, and
 * one lock directory per folder, so their integrity, redirect, resume and
 * ownership behaviour stay identical.
 */
export class PinnedFileDownload {
  private readonly lock: string

  public constructor(
    private readonly deps: PinnedDownloadDeps,
    private readonly target: LinuxPinnedTarget,
  ) {
    this.lock = path.join(deps.directory, LINUX_DICTATION.lockDirectory)
  }

  private async acquire(): Promise<() => Promise<void>> {
    await mkdir(this.deps.directory, { recursive: true, mode: LINUX_DICTATION.directoryMode })
    const rootInfo = await lstat(this.deps.directory)
    if (!rootInfo.isDirectory()) throw new Error(UI_TEXT.linuxDictationIntegrity)
    const stage = await mkdtemp(path.join(this.deps.directory, '.lock-'))
    const owner = String(process.pid)
    const marker = path.join(stage, owner)
    try {
      const handle = await open(marker, 'wx', LINUX_DICTATION.fileMode)
      await handle.close()
      try {
        await rename(stage, this.lock)
      } catch (error: unknown) {
        if (!isOwned(error)) throw error
        const lockInfo = await lstat(this.lock)
        if (!lockInfo.isDirectory())
          throw new Error(UI_TEXT.linuxDictationIntegrity, { cause: error })
        const owners = await readdir(this.lock)
        if (owners.length === 0) {
          // The previous owner crashed after unlinking its marker but
          // before removing the lock directory: nobody owns it, so
          // reclaim it instead of reporting busy forever.
          try {
            await rmdir(this.lock)
          } catch (error_: unknown) {
            if (!isMissing(error_) && !isOwned(error_)) throw error_
            if (isOwned(error_)) throw new Error(UI_TEXT.linuxDictationBusy, { cause: error_ })
          }
          try {
            await rename(stage, this.lock)
          } catch (error_: unknown) {
            if (isOwned(error_)) throw new Error(UI_TEXT.linuxDictationBusy, { cause: error_ })
            throw error_
          }
        } else {
          const previous = owners[0] ?? ''
          if (owners.length !== 1 || !/^\d+$/.test(previous))
            throw new Error(UI_TEXT.linuxDictationBusy, { cause: error })
          try {
            process.kill(Number(previous), 0)
            throw new Error(UI_TEXT.linuxDictationBusy, { cause: error })
          } catch (error_: unknown) {
            if (!(error_ instanceof Error && 'code' in error_ && error_.code === 'ESRCH'))
              throw error_
          }
          // Atomic publication includes its marker; only a dead owner's marker is removed.
          await unlink(path.join(this.lock, previous))
          await rmdir(this.lock)
          await rename(stage, this.lock)
        }
      }
    } finally {
      await rm(stage, { recursive: true, force: true })
    }
    return async () => {
      await unlink(path.join(this.lock, owner))
      await rmdir(this.lock)
    }
  }

  private async matches(file: string, signal: AbortSignal): Promise<boolean> {
    let handle
    try {
      handle = await open(file, constants.O_RDONLY | constants.O_NOFOLLOW)
    } catch (error: unknown) {
      if (isMissing(error)) return false
      throw error
    }
    try {
      const info = await handle.stat()
      if (!info.isFile() || info.size !== this.target.bytes) return false
      const hash = createHash('sha256')
      const stream = handle.createReadStream({ autoClose: false })
      for await (const chunk of stream) {
        signal.throwIfAborted()
        hash.update(z.instanceof(Buffer).parse(chunk))
      }
      return hash.digest('hex') === this.target.sha256
    } finally {
      await handle.close()
    }
  }

  private async response(offset: number, signal: AbortSignal): Promise<Response> {
    let url = this.target.url
    for (let hop = 0; hop <= LINUX_DICTATION.redirectLimit; hop += 1) {
      const target = new URL(url)
      if (target.protocol !== 'https:' || target.username !== '' || target.password !== '')
        throw new Error(UI_TEXT.linuxDictationDownloadFailed)
      const response = await this.deps.fetch(url, {
        signal,
        redirect: 'manual',
        credentials: 'omit',
        headers: {
          'Accept-Encoding': 'identity',
          ...(offset !== 0 && { Range: `bytes=${String(offset)}-` }),
        },
      })
      const status = z.number().parse(response.status)
      if (!new Set<number>(LINUX_DICTATION.redirects).has(status)) return response
      const next = z.string().parse(response.headers.get('location'))
      await response.body?.cancel()
      url = new URL(next, url).href
    }
    throw new Error(UI_TEXT.linuxDictationDownloadFailed)
  }

  public async ensure(
    canDownload: (signal: AbortSignal) => Promise<boolean>,
    signal: AbortSignal,
  ): Promise<string | undefined> {
    signal.throwIfAborted()
    const release = await this.acquire()
    try {
      const installed = path.join(this.deps.directory, this.target.file)
      const partial = path.join(this.deps.directory, this.target.partial)
      if (await this.matches(installed, signal)) {
        await removeFile(partial)
        return installed
      }
      await removeFile(installed)
      if (!(await canDownload(signal))) return undefined
      signal.throwIfAborted()
      const handle = await open(
        partial,
        constants.O_RDWR | constants.O_CREAT | constants.O_NOFOLLOW,
        this.target.mode,
      )
      try {
        await handle.chmod(this.target.mode)
        const info = await handle.stat()
        if (!info.isFile()) throw new Error(UI_TEXT.linuxDictationIntegrity)
        let offset = info.size
        if (offset > this.target.bytes) {
          await handle.truncate(0)
          offset = 0
        }
        if (offset !== this.target.bytes) {
          const response = await this.response(offset, signal)
          const status = z.number().parse(response.status)
          if (status === LINUX_DICTATION.statusOk) {
            await handle.truncate(0)
            offset = 0
          } else if (
            offset === 0 ||
            status !== LINUX_DICTATION.statusPartial ||
            response.headers.get('content-range') !==
              `bytes ${String(offset)}-${String(this.target.bytes - 1)}/${String(this.target.bytes)}`
          ) {
            await response.body?.cancel()
            throw new Error(UI_TEXT.linuxDictationDownloadFailed)
          }
          const length = response.headers.get('content-length')
          if (length !== null && Number(length) !== this.target.bytes - offset) {
            await response.body?.cancel()
            throw new Error(UI_TEXT.linuxDictationIntegrity)
          }
          if (response.body === null) throw new Error(UI_TEXT.linuxDictationDownloadFailed)
          const reader = response.body.getReader()
          try {
            for (;;) {
              signal.throwIfAborted()
              const part = await reader.read()
              if (part.done) break
              const bytes = z.instanceof(Uint8Array).parse(part.value)
              if (offset + bytes.byteLength > this.target.bytes)
                throw new Error(UI_TEXT.linuxDictationIntegrity)
              let written = 0
              while (written < bytes.byteLength) {
                const result = await handle.write(
                  bytes,
                  written,
                  bytes.byteLength - written,
                  offset + written,
                )
                if (result.bytesWritten === 0) throw new Error(UI_TEXT.linuxDictationDownloadFailed)
                written += result.bytesWritten
              }
              offset += bytes.byteLength
            }
          } finally {
            await reader.cancel()
            reader.releaseLock()
          }
          if (offset !== this.target.bytes) throw new Error(UI_TEXT.linuxDictationDownloadFailed)
        }
        await handle.sync()
      } finally {
        await handle.close()
      }
      if (!(await this.matches(partial, signal))) {
        await removeFile(partial)
        throw new Error(UI_TEXT.linuxDictationIntegrity)
      }
      signal.throwIfAborted()
      await rename(partial, installed)
      return installed
    } finally {
      await release()
    }
  }

  public async remove(): Promise<void> {
    const release = await this.acquire()
    try {
      await removeFile(path.join(this.deps.directory, this.target.file))
      await removeFile(path.join(this.deps.directory, this.target.partial))
    } finally {
      await release()
    }
  }
}

/** Shared on-disk acquisition: a crash leaves resumable bytes, never a usable unchecked model. */
export class LinuxDictationModel {
  private readonly download: PinnedFileDownload
  public readonly modelPath: string

  public constructor(private readonly deps: LinuxModelDeps) {
    const pin = deps.pin ?? LINUX_DICTATION
    this.modelPath = path.join(deps.directory, LINUX_DICTATION.modelFile)
    this.download = new PinnedFileDownload(deps, {
      file: LINUX_DICTATION.modelFile,
      partial: LINUX_DICTATION.partialFile,
      bytes: pin.bytes,
      sha256: pin.sha256,
      url: pin.url,
      mode: LINUX_DICTATION.fileMode,
    })
  }

  public async ensure(signal: AbortSignal): Promise<string | undefined> {
    return await this.download.ensure(this.deps.consent, signal)
  }

  public async remove(): Promise<void> {
    await this.download.remove()
  }
}
