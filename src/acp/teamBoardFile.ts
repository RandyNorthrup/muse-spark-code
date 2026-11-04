// One workspace's team board on disk (M96b, RVACPTEAM): whole-file writes, in
// order, each one atomic. Every write carries the whole board, so one that
// fails is its own caller's failure and the next write repairs the file: the
// failure must not reach the writes after it. A crash can leave the temporary
// file behind; nothing reads it, and the next write replaces it.
import { mkdir, rename, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { ACP_TEAM_BOARD_FILE, EXEC_TEAM_FILE_MODE } from '../shared/constants'

export interface TeamBoardFile {
  /** Queues the board's text; settles with this write's own outcome. */
  write(text: string): Promise<void>
  /** The latest write's outcome. */
  settled(): Promise<void>
}

export function teamBoardFile(folder: string): TeamBoardFile {
  let last = Promise.resolve()
  return {
    write: (text) => {
      const previous = last
      last = (async () => {
        await Promise.allSettled([previous])
        await mkdir(folder, { recursive: true })
        const target = path.join(folder, ACP_TEAM_BOARD_FILE)
        const temporary = `${target}.new`
        try {
          await writeFile(temporary, text, { mode: EXEC_TEAM_FILE_MODE })
          await rename(temporary, target)
        } catch (error: unknown) {
          await Promise.allSettled([rm(temporary, { force: true, recursive: true })])
          throw error
        }
      })()
      return last
    },
    settled: () => last,
  }
}
