import path from 'node:path'
import { symlinkSync, unlinkSync } from 'node:fs'
import { mkdir, rename, writeFile } from 'node:fs/promises'
import { execFileSync } from 'node:child_process'
import { PlanModeHold } from '../../../src/core/review/planModeHold'
import { reviewTurnText } from '../../../src/core/review/reviewPrompt'
import type { ReviewTurnFeatures } from '../../../src/host/review/reviewBundle'

/**
 * The review's parts as the bundle builds them (dist/review.js), over the
 * real modules: the collector a test chooses, and the marker it expects.
 */
export function reviewParts(
  collect: ReviewTurnFeatures['collect'],
  newMarker: ReviewTurnFeatures['newMarker'] = () => 'marker',
): ReviewTurnFeatures {
  return {
    collect,
    turnText: reviewTurnText,
    newMarker,
    createHold: (deps) => new PlanModeHold(deps),
  }
}

/** Two real Git repositories and an owned alias, for physical request ownership. */
export async function aliasedReviewRepositories(base: string, name: string) {
  const first = path.join(base, `${name}-A`)
  const foreign = path.join(base, `${name}-B`)
  const repositories: readonly (readonly [string, string])[] = [
    [first, 'OWNED_A_EDIT'],
    [foreign, 'OWNED_B_EDIT'],
  ]
  for (const [folder, marker] of repositories) {
    await mkdir(folder)
    const git = (...args: string[]) =>
      execFileSync(
        'git',
        ['-c', 'user.name=t', '-c', 'user.email=t@e.x', '-c', 'commit.gpgsign=false', ...args],
        { cwd: folder, stdio: ['ignore', 'pipe', 'pipe'] },
      )
    git('init', '-q', '-b', 'main')
    await writeFile(path.join(folder, 'probe.txt'), `${marker}\n`)
    git('add', 'probe.txt')
    git('commit', '-q', '-m', 'owned root')
    await writeFile(path.join(folder, 'probe.txt'), `${marker}_NEXT\n`)
  }
  const alias = path.join(base, `${name}-alias`)
  const link = process.platform === 'win32' ? 'junction' : 'dir'
  symlinkSync(first, alias, link)
  const retarget = () => {
    unlinkSync(alias)
    symlinkSync(foreign, alias, link)
  }
  const replace = async () => {
    await rename(first, `${first}-retired`)
    await rename(foreign, first)
  }
  return { first, foreign, alias, retarget, replace }
}
