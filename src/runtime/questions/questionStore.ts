import { randomUUID } from 'node:crypto'
import { chmod, lstat, mkdir, open, readFile, readdir, rename, rm } from 'node:fs/promises'
import path from 'node:path'
import {
  CHECKPOINT_STORAGE_MODE,
  QUESTION_ID_MAX_CHARS,
  REPORT_STORAGE_FILE_MODE,
  UI_TEXT,
} from '../../shared/constants'
import { openQuestionStoreSchema, type QuestionStore } from '../../shared/questions'

async function regular(file: string): Promise<void> {
  try {
    const metadata = await lstat(file)
    if (!metadata.isFile()) throw new Error(UI_TEXT.questionAnswerFailed)
  } catch (error: unknown) {
    if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT')) throw error
  }
}
/** Shared owner-only persistence for the runtime and the extension's private global storage. */
export function createQuestionStore(directory: string): QuestionStore {
  const fileFor = (sessionId: string) => {
    if (!/^[A-Za-z0-9_-]+$/u.test(sessionId) || sessionId.length > QUESTION_ID_MAX_CHARS)
      throw new Error(UI_TEXT.answerNotAccepted)
    return path.join(directory, `${sessionId}.json`)
  }
  const prepare = async () => {
    await mkdir(directory, { recursive: true, mode: CHECKPOINT_STORAGE_MODE })
    const metadata = await lstat(directory)
    if (!metadata.isDirectory()) throw new Error(UI_TEXT.questionAnswerFailed)
    if (process.platform !== 'win32') await chmod(directory, CHECKPOINT_STORAGE_MODE)
  }
  return {
    async load(sessionId) {
      const file = fileFor(sessionId)
      await prepare()
      await regular(file)
      let raw: unknown
      try {
        raw = JSON.parse(await readFile(file, 'utf8'))
      } catch (error: unknown) {
        if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return []
        // JSON parser errors can quote question text. Never propagate the raw exception.
        raw = undefined
      }
      const parsed = openQuestionStoreSchema.safeParse(raw)
      if (!parsed.success || parsed.data.snapshot.sessionId !== sessionId)
        throw new Error(UI_TEXT.questionAnswerFailed)
      if (process.platform !== 'win32') await chmod(file, REPORT_STORAGE_FILE_MODE)
      return parsed.data.snapshot.questions
    },
    async save(sessionId, questions) {
      const file = fileFor(sessionId)
      const parsed = openQuestionStoreSchema.safeParse({
        version: 1,
        snapshot: { sessionId, questions },
      })
      if (!parsed.success) throw new Error(UI_TEXT.questionAnswerFailed)
      await prepare()
      await regular(file)
      const temporary = `${file}.${randomUUID()}.tmp`
      try {
        const handle = await open(temporary, 'wx', REPORT_STORAGE_FILE_MODE)
        try {
          await handle.writeFile(JSON.stringify(parsed.data), 'utf8')
          await handle.sync()
        } finally {
          await handle.close()
        }
        await rename(temporary, file)
      } finally {
        await rm(temporary, { force: true })
      }
    },
    async remove(sessionId) {
      const file = fileFor(sessionId)
      await prepare()
      await rm(file, { force: true })
      const prefix = `${path.basename(file)}.`
      const names = await readdir(directory)
      for (const name of names)
        if (name.startsWith(prefix) && name.endsWith('.tmp'))
          await rm(path.join(directory, name), { force: true })
    },
  }
}
