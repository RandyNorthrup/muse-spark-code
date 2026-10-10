import { lstat, mkdir, mkdtemp, open, readdir, rename, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import * as z from 'zod/mini'
import {
  FONT_DIRECTORY_MODE,
  FONT_FILE_MODE,
  FONT_INSTALL_TIMEOUT_MS,
  UI_TEXT,
} from '../../shared/constants'
import { installFontPack, type FontAsset, type FontInstallPort } from './install'

async function readLocal(file: string, bytes: number, signal: AbortSignal): Promise<Uint8Array> {
  const initial = await lstat(file)
  if (!initial.isFile()) throw new Error(UI_TEXT.acpFontInstallFailed)
  const handle = await open(file, 'r')
  try {
    const info = await handle.stat()
    if (!info.isFile() || info.size !== bytes) throw new Error(UI_TEXT.acpFontInstallFailed)
    const data = Buffer.alloc(bytes + 1)
    let offset = 0
    for (;;) {
      signal.throwIfAborted()
      const part = await handle.read(data, offset, data.length - offset, null)
      offset += part.bytesRead
      if (offset > bytes) throw new Error(UI_TEXT.acpFontInstallFailed)
      if (part.bytesRead === 0) return data.subarray(0, offset)
    }
  } finally {
    await handle.close()
  }
}

async function download(
  asset: FontAsset,
  fetcher: typeof fetch,
  signal: AbortSignal,
): Promise<Uint8Array> {
  const response = await fetcher(asset.url, { signal, redirect: 'error', credentials: 'omit' })
  if (!response.ok || response.body === null) throw new Error(UI_TEXT.acpFontInstallFailed)
  const reader = response.body.getReader()
  const chunks: Uint8Array[] = []
  let size = 0
  try {
    for (;;) {
      signal.throwIfAborted()
      const part = await reader.read()
      if (part.done) return Buffer.concat(chunks)
      const chunk = z.instanceof(Uint8Array).parse(part.value)
      size += chunk.byteLength
      if (size > asset.bytes) throw new Error(UI_TEXT.acpFontInstallFailed)
      chunks.push(chunk)
    }
  } finally {
    await reader.cancel()
    reader.releaseLock()
  }
}

async function isMatchingPack(
  directory: string,
  assets: ReadonlyMap<string, Uint8Array>,
): Promise<boolean> {
  try {
    const info = await lstat(directory)
    const files = await readdir(directory)
    if (!info.isDirectory() || files.length !== assets.size) return false
    for (const [file, bytes] of assets) {
      const target = path.join(directory, file)
      const existing = await readLocal(
        target,
        bytes.byteLength,
        AbortSignal.timeout(FONT_INSTALL_TIMEOUT_MS),
      )
      if (!Buffer.from(existing).equals(bytes)) return false
    }
    return true
  } catch {
    // An absent, unreadable or invalid pack is not reusable; publication handles the failure.
    return false
  }
}

/** OS/image adapter: versioned app data only, not fontconfig, an editor or an OS font registry. */
export function nodeFontInstallPort(input: {
  readonly directory: string
  readonly sourceDirectory?: string | undefined
  readonly fetch: typeof fetch
}): FontInstallPort {
  return {
    async read(asset, signal) {
      return input.sourceDirectory === undefined
        ? await download(asset, input.fetch, signal)
        : await readLocal(path.join(input.sourceDirectory, asset.file), asset.bytes, signal)
    },
    async publish(id, assets) {
      await mkdir(input.directory, { recursive: true, mode: FONT_DIRECTORY_MODE })
      const info = await lstat(input.directory)
      if (!info.isDirectory()) throw new Error(UI_TEXT.acpFontInstallFailed)
      const destination = path.join(input.directory, id)
      if (await isMatchingPack(destination, assets)) return destination
      const stage = await mkdtemp(path.join(input.directory, '.install-'))
      try {
        for (const [file, bytes] of assets)
          await writeFile(path.join(stage, file), bytes, { mode: FONT_FILE_MODE, flag: 'wx' })
        try {
          await rename(stage, destination)
        } catch (error: unknown) {
          if (!(await isMatchingPack(destination, assets))) throw error
        }
        return destination
      } finally {
        await rm(stage, { recursive: true, force: true })
      }
    },
  }
}

export async function runFontInstall(input: {
  readonly manifest: unknown
  readonly directory: string
  readonly sourceDirectory?: string | undefined
  readonly fetch: typeof fetch
}): Promise<string> {
  return await installFontPack(
    input.manifest,
    nodeFontInstallPort(input),
    AbortSignal.timeout(FONT_INSTALL_TIMEOUT_MS),
  )
}
