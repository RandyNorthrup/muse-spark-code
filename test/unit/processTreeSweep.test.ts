// The orphan sweep over a real process table: signalling a group that
// is gone resolves instead of failing, and the miss is said once.

import { describe, expect, it } from 'vitest'
import { sweepExitedTree } from '../../src/host/processTree'

const deadGroup = 4_194_304

describe('sweepExitedTree', () => {
  // A missing POSIX group answers ESRCH; Windows answers its own miss.
  it.runIf(process.platform !== 'win32')(
    'ends quietly when the group is already gone',
    async () => {
      const messages: string[] = []
      await sweepExitedTree(deadGroup, Date.now(), Date.now(), {
        platform: 'linux',
        systemRoot: undefined,
        log: (message: string) => {
          messages.push(message)
        },
      })
      expect(messages).toHaveLength(0)
    },
  )

  it('resolves at once without a group', async () => {
    const messages: string[] = []
    await sweepExitedTree(undefined, Date.now(), Date.now(), {
      platform: 'linux',
      systemRoot: undefined,
      log: (message: string) => {
        messages.push(message)
      },
    })
    expect(messages).toHaveLength(0)
  })
})
