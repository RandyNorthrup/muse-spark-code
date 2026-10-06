import { execFile } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { mkdir, open, rename, rm } from 'node:fs/promises'
import path from 'node:path'
import { promisify } from 'node:util'
import { withoutCredentials } from '../../core/credentialEnvironment'
import { storeErrorCode } from '../../host/backend/storeErrors'
import {
  CHECKPOINT_STORAGE_MODE,
  REPORT_STORAGE_FILE_MODE,
  SCHEDULE_MAX_PROMPT_CHARS,
  SCHEDULE_POLL_INTERVAL_MS,
  UI_TEXT,
} from '../../shared/constants'
import type { BackgroundFilePort, BackgroundProcessResult } from './nativeBackground'

function systemProgram(file: string, env: NodeJS.ProcessEnv): string {
  if (file === 'launchctl') return '/bin/launchctl'
  if (file === 'systemctl') return '/usr/bin/systemctl'
  if (file !== 'powershell.exe' && file !== 'schtasks.exe') return file
  const root = Object.entries(env).find(([name]) => name.toUpperCase() === 'SYSTEMROOT')?.[1]
  if (root === undefined || !path.win32.isAbsolute(root) || /[\p{Cc}]/u.test(root))
    throw new Error(UI_TEXT.scheduleV2.runtime.backgroundUnavailable)
  return file === 'powershell.exe'
    ? path.win32.join(root, 'System32', 'WindowsPowerShell', 'v1.0', file)
    : path.win32.join(root, 'System32', file)
}

/** Only the fixed OS programs receive this credential-free environment. */
export function backgroundProcessRunner(
  env: NodeJS.ProcessEnv,
): (file: string, args: readonly string[]) => Promise<BackgroundProcessResult> {
  return async (file, args) => {
    try {
      const result = await promisify(execFile)(systemProgram(file, env), [...args], {
        env: withoutCredentials(env),
        windowsHide: true,
        timeout: SCHEDULE_POLL_INTERVAL_MS,
        maxBuffer: SCHEDULE_MAX_PROMPT_CHARS,
      })
      return { exitCode: 0, stdout: result.stdout, stderr: result.stderr }
    } catch (error: unknown) {
      if (
        typeof error === 'object' &&
        error !== null &&
        'code' in error &&
        typeof error.code === 'number' &&
        'stdout' in error &&
        typeof error.stdout === 'string' &&
        'stderr' in error &&
        typeof error.stderr === 'string'
      )
        return { exitCode: error.code, stdout: error.stdout, stderr: error.stderr }
      throw new Error(UI_TEXT.scheduleV2.runtime.unavailable, { cause: error })
    }
  }
}

/** Owner-only files; no recursive deletion, and a missing file alone reads absent. */
export function nodeBackgroundFiles(): BackgroundFilePort {
  return {
    async read(file) {
      let handle
      try {
        handle = await open(file, 'r')
      } catch (error: unknown) {
        if (storeErrorCode(error) === 'ENOENT') return
        throw error
      }
      try {
        const info = await handle.stat()
        if (!info.isFile() || info.size > SCHEDULE_MAX_PROMPT_CHARS)
          throw new Error(UI_TEXT.scheduleV2.runtime.invalidResponse)
        const bytes = Buffer.alloc(SCHEDULE_MAX_PROMPT_CHARS + 1)
        let offset = 0
        for (;;) {
          const { bytesRead } = await handle.read(bytes, offset, bytes.length - offset, null)
          offset += bytesRead
          if (offset > SCHEDULE_MAX_PROMPT_CHARS)
            throw new Error(UI_TEXT.scheduleV2.runtime.invalidResponse)
          if (bytesRead === 0)
            return new TextDecoder('utf-8', { fatal: true }).decode(bytes.subarray(0, offset))
        }
      } finally {
        await handle.close()
      }
    },
    async write(file, text, encoding) {
      await mkdir(path.dirname(file), { recursive: true, mode: CHECKPOINT_STORAGE_MODE })
      const temporary = `${file}.${randomUUID()}.tmp`
      try {
        const handle = await open(temporary, 'wx', REPORT_STORAGE_FILE_MODE)
        try {
          await handle.writeFile(
            encoding === 'utf16le' ? Buffer.from(`\u{FEFF}${text}`, 'utf16le') : text,
            'utf8',
          )
          await handle.sync()
        } finally {
          await handle.close()
        }
        await rename(temporary, file)
      } finally {
        await rm(temporary, { force: true })
      }
    },
    async remove(file) {
      await rm(file, { force: true })
    },
  }
}
