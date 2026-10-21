// The orphan sweep over a real process table: a group that is gone
// ends quietly instead of failing, and nothing runs without a group.

import { describe, expect, it } from 'vitest'
import { sweepExitedTree, type ProcessTreeDeps } from '../../src/host/processTree'
import { collectingLogger as logger } from './helpers/collectingLogger'

const deadGroup = 4_194_304

function sweepDeps(messages: string[]): ProcessTreeDeps {
  return {
    platform: 'linux',
    systemRoot: undefined,
    log: logger(messages).warn,
  }
}

describe('sweepExitedTree', () => {
  // A missing POSIX group answers ESRCH; Windows answers its own miss.
  it.runIf(process.platform !== 'win32')(
    'ends quietly when the group is already gone',
    async () => {
      const messages: string[] = []
      await sweepExitedTree(deadGroup, Date.now(), Date.now(), sweepDeps(messages))
      expect(messages).toHaveLength(0)
    },
  )

  it('resolves at once without a group', async () => {
    const messages: string[] = []
    await sweepExitedTree(undefined, Date.now(), Date.now(), sweepDeps(messages))
    expect(messages).toHaveLength(0)
  })
})
