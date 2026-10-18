import { EventEmitter } from 'node:events'
import { closeSync, openSync, writeSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { CdpConnection, type PipeReader } from '../../src/core/browser/cdpPipe'

/** A writer around a closed file descriptor: the write genuinely fails with EBADF. */
function brokenWriter(): { write(chunk: string): boolean } {
  const fd = openSync('/dev/null', 'w')
  closeSync(fd)
  return {
    write: (chunk: string) => {
      writeSync(fd, chunk)
      return true
    },
  }
}

describe('the debugging pipe send', () => {
  it('rejects a broken write with the write failure itself', async () => {
    const reader = new EventEmitter() as unknown as PipeReader
    const connection = new CdpConnection(brokenWriter(), reader)
    // The rejection keeps the operating system's failure (EBADF), never a
    // rewritten sentence: wrapping it in a fixed error loses the code.
    await expect(connection.send('Page.enable')).rejects.toMatchObject({ code: 'EBADF' })
  })
})
