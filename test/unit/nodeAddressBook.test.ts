// M110r Y2: nodes by identity, last-known addresses, rotating discovery tokens.
import { createHmac } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import {
  AddressBook,
  discoveryToken,
  firstHandshakeWins,
  nodeIdFromPublicKey,
  tokenHour,
} from '../../src/core/devices/addressBook'

const NODE = 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad'

describe('node identity', () => {
  it('is the SHA-256 fingerprint of the identity key', () => {
    expect(nodeIdFromPublicKey(Buffer.from('abc'))).toBe(NODE)
  })
})

describe('discovery tokens', () => {
  const pairKey = Buffer.from('pair-key-between-two-nodes')
  it('is the HMAC of the hour under the pair key, as 8-byte big-endian', () => {
    const hourBytes = Buffer.alloc(8)
    hourBytes.writeBigUInt64BE(500_000n)
    const expected = createHmac('sha256', pairKey).update(hourBytes).digest('hex')
    expect(discoveryToken(pairKey, 500_000)).toBe(expected)
  })
  it('rotates hourly and differs per pair', () => {
    const hour = tokenHour(Date.now())
    expect(tokenHour(hour * 3_600_000 + 59_000)).toBe(hour)
    expect(discoveryToken(pairKey, hour)).not.toBe(discoveryToken(pairKey, hour + 1))
    expect(discoveryToken(pairKey, hour)).not.toBe(
      discoveryToken(Buffer.from('another-pair-key'), hour),
    )
  })
})

describe('address book', () => {
  it('keeps last-known addresses newest first without duplicates', () => {
    const book = new AddressBook()
    book.remember(NODE, 'build-pi', ['192.0.2.44', '192.0.2.154', '192.0.2.44'], 100)
    expect(book.addressesFor(NODE)).toEqual(['192.0.2.44', '192.0.2.154'])
    book.recordSuccess(NODE, '192.0.2.154', 200)
    expect(book.addressesFor(NODE)).toEqual(['192.0.2.154', '192.0.2.44'])
    expect(book.known(NODE)?.label).toBe('build-pi')
  })
  it('ignores success for unknown nodes and empty books', () => {
    const book = new AddressBook()
    book.recordSuccess(NODE, '192.0.2.1', 0)
    expect(book.addressesFor(NODE)).toEqual([])
    expect(book.known(NODE)).toBeUndefined()
  })
  it('round-trips through the store, and a corrupt dump changes nothing', () => {
    const book = new AddressBook()
    book.remember(NODE, 'build-pi', ['192.0.2.44'], 100)
    const restored = new AddressBook()
    restored.load(book.dump())
    expect(restored.known(NODE)).toEqual(book.known(NODE))
    expect(() => {
      restored.load('{"entries":[{"id":"nope"}]}')
    }).toThrow()
    expect(restored.known(NODE)).toEqual(book.known(NODE))
  })
})

describe('firstHandshakeWins', () => {
  it('the first proven handshake wins and the losers abort', async () => {
    let loserSignal: AbortSignal | undefined
    const loserControl: { settle?: (value: string) => void } = {}
    const loser = new Promise<string>((resolve) => {
      loserControl.settle = resolve
    })
    const winner = firstHandshakeWins([
      (signal) => {
        loserSignal = signal
        return loser
      },
      () =>
        new Promise<string>((resolve) => {
          setTimeout(() => {
            resolve('overlay')
          }, 5)
        }),
    ])
    await expect(winner).resolves.toBe('overlay')
    expect(loserSignal?.aborted).toBe(true)
    loserControl.settle?.('late')
    await expect(loser).resolves.toBe('late')
  })
  it('every leg failing rejects with all of their reasons', async () => {
    let failure: unknown
    try {
      await firstHandshakeWins([
        () => Promise.reject(new Error('refused')),
        () => Promise.reject(new Error('timeout')),
      ])
      expect.unreachable('all legs failed')
    } catch (error: unknown) {
      failure = error
    }
    expect(failure).toBeInstanceOf(AggregateError)
    if (!(failure instanceof AggregateError)) expect.unreachable('AggregateError')
    expect(
      failure.errors.map((entry: unknown) =>
        entry instanceof Error ? entry.message : typeof entry,
      ),
    ).toEqual(['refused', 'timeout'])
  })
  it('no legs is refused, never silent', async () => {
    await expect(firstHandshakeWins([])).rejects.toThrow('no discovery legs')
  })
})
