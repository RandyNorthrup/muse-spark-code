import { randomBytes } from 'node:crypto'
import { describe, expect, it, vi } from 'vitest'
import {
  BrokerSecretStore,
  type VaultCredentialBindingPort,
} from '../../../src/host/vault/brokerClient'
import { vaultPrivateReadSchema } from '../../../src/shared/vaultProtocol'

const binding = vaultPrivateReadSchema.parse({
  v: 1,
  kind: 'firstPartyRead',
  itemId: 'f'.repeat(32),
  origin: 'https://example.test',
  client: 'model',
})
function setup() {
  const source = Buffer.from(randomBytes(32).toString('hex'))
  const bindings: VaultCredentialBindingPort = {
    resolve: vi.fn(() => Promise.resolve(binding)),
    store: vi.fn(() => Promise.resolve()),
    delete: vi.fn(() => Promise.resolve()),
  }
  const reader = { read: vi.fn(() => Promise.resolve(source)) }
  return { source, bindings, reader, store: new BrokerSecretStore(reader, bindings) }
}
describe('first-party credential adapter', () => {
  it('reads per request and erases the broker buffer after conversion', async () => {
    const fixture = setup(),
      expected = fixture.source.toString('utf8')
    expect(await fixture.store.get('provider-key')).toBe(expected)
    expect(fixture.reader.read).toHaveBeenCalledWith(binding)
    expect(fixture.source.every((byte) => byte === 0)).toBe(true)
    fixture.bindings.resolve = () => Promise.resolve(null)
    expect(await fixture.store.get('missing')).toBeUndefined()
    expect(fixture.reader.read).toHaveBeenCalledOnce()
  })
  it.each([false, true])(
    'existing entry flow erases transient write bytes even on failure %s',
    async (isFailed) => {
      const fixture = setup(),
        value = randomBytes(32).toString('hex')
      let held: Uint8Array = new Uint8Array()
      fixture.bindings.store = (_key, bytes) => {
        held = bytes
        expect(Buffer.from(bytes).toString('utf8')).toBe(value)
        return isFailed ? Promise.reject(new Error('test store failed')) : Promise.resolve()
      }
      if (isFailed)
        await expect(fixture.store.store('provider-key', value)).rejects.toThrow(
          'test store failed',
        )
      else await fixture.store.store('provider-key', value)
      expect(held.every((byte) => byte === 0)).toBe(true)
      await fixture.store.delete('provider-key')
      expect(fixture.bindings.delete).toHaveBeenCalledWith('provider-key')
    },
  )
})
