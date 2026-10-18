// Stages the other-CI launcher into an ACP package directory: each
// CI_LAUNCHER_SOURCES entry is an action/-rooted path (a file or the CI
// prompt directory) and keeps its path below action/ under the stage's ci/,
// so the stage holds ci/lib and ci/prompts exactly as the templates address
// them. Anything outside action/ is refused instead of staged.
import { copyFileSync, cpSync, mkdirSync, statSync } from 'node:fs'
import path from 'node:path'

export function stageCiLauncher(root, stage, sources) {
  for (const source of sources) {
    const relative = path.relative('action', source)
    if (relative === '' || relative.startsWith('..') || path.isAbsolute(relative)) {
      throw new Error(`CI launcher source must stay under action/: ${source}`)
    }
    const absolute = path.join(root, source)
    const target = path.join(stage, 'ci', relative)
    if (statSync(absolute).isDirectory()) {
      cpSync(absolute, target, { recursive: true })
    } else {
      mkdirSync(path.dirname(target), { recursive: true })
      copyFileSync(absolute, target)
    }
  }
}
