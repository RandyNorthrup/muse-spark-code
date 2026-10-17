// The account read's failure boundary (D119): a host that cannot answer
// reads as unsigned-in, with the failure's kind in the record; anything
// that is not an error keeps its kind, and an answer in another shape
// stays silent.
import { describe, expect, it } from 'vitest'
import type { Logger } from '../../src/host/logger'
import { readAccountState } from '../../src/host/auth/accountHost'

function log(lines: string[]): Logger {
  const record = (message: string) => {
    lines.push(message)
  }
  return { trace: record, info: record, warn: record, error: record }
}

function connection(request: () => Promise<Record<string, unknown>>) {
  return {
    request,
    closed: Promise.resolve(),
    onNotification: () => undefined,
  }
}

class HostDiedError extends Error {
  public constructor(message: string) {
    super(message)
    this.name = 'HostDiedError'
  }
}

describe('account read failures', () => {
  it('reads a host failure as unsigned-in, with the kind in words', async () => {
    const failure = new HostDiedError('the host died mid-answer')
    const lines: string[] = []
    const answer = await readAccountState(
      connection(() => Promise.reject(failure)),
      log(lines),
    )
    expect(answer).toBe(undefined)
    expect(lines).toHaveLength(1)
    expect(lines[0]).toContain('account/read')
    expect(lines[0]).toContain('HostDied')
    expect(lines[0]).not.toContain('the host died mid-answer')
  })

  it('stays silent when the answer comes in another shape', async () => {
    const lines: string[] = []
    const answer = await readAccountState(
      connection(() => Promise.resolve({ wrong: 1 })),
      log(lines),
    )
    expect(answer).toBe(undefined)
    expect(lines).toEqual([])
  })

  it('keeps a foreign failure past the boundary', async () => {
    const lines: string[] = []
    await expect(
      readAccountState(
        // The foreign probe deliberately rejects with a non-Error: the
        // boundary must preserve it with its kind (PLAN.md §8, PR161FIN).
        // eslint-disable-next-line @typescript-eslint/prefer-promise-reject-errors -- deliberate foreign rejection; the probe asserts it by identity.
        connection(() => Promise.reject('account-broken')),
        log(lines),
      ),
    ).rejects.toBe('account-broken')
    expect(lines).toEqual([])
  })
})
