// A team's board on disk, for the ACP agent and a headless run (M96b, RVACPTEAM):
// whole-file writes, in order, each one atomic. Every write carries the whole board,
// so one that fails is its own caller's failure and the next write repairs the file:
// the failure must not reach the writes after it. A crash can leave the temporary file
// behind; nothing reads it, and the next write replaces it.
import { rename, rm, writeFile } from 'node:fs/promises'
import { EXEC_TEAM_FILE_MODE } from '../../shared/constants'

export interface TeamBoardFile {
  /** Queues the board's text; settles with this write's own outcome. */
  write(text: string): Promise<void>
  /** The latest write's outcome. */
  settled(): Promise<void>
}

/** `target` names the file when a write's turn comes, and may refuse it or make its folder. */
export function teamBoardFile(target: () => string | Promise<string>): TeamBoardFile {
  let last = Promise.resolve()
  return {
    write: (text) => {
      const previous = last
      last = (async () => {
        await Promise.allSettled([previous])
        const file = await target()
        const temporary = `${file}.new`
        try {
          await writeFile(temporary, text, { mode: EXEC_TEAM_FILE_MODE })
          await rename(temporary, file)
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
