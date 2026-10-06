import { nodeTempRoot, nodeNativeTest } from './helpers/nodeNative'
import { readFile, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { afterEach, describe, expect } from 'vitest'
import { NODE_DEPLOY_KEY_NAME, NODE_KEYS_FILE, SECRET_KEYS } from '../../src/shared/constants'
import { NodeInterimKeyStore } from '../../src/runtime/node/keyStore'
import { NodePrivateFiles } from '../../src/runtime/node/privateFiles'
import { FixtureCodec } from './helpers/nodeVaultCodec'

const directories: string[] = []
async function setup(codec = new FixtureCodec()) {
  const dir = await nodeTempRoot('m110-keys-')
  directories.push(dir)
  const store = new NodeInterimKeyStore(new NodePrivateFiles(dir), codec)
  await store.initialize('test passphrase')
  return { store, dir, codec }
}
afterEach(async () => {
  for (const dir of directories.splice(0)) await rm(dir, { recursive: true, force: true })
})

describe('M110-N interim item encryption and slot handoff', () => {
  nodeNativeTest(
    'H06/H15 starts sealed, encrypts items, and restarts sealed without a plaintext canary on disk',
    async () => {
      const { store, dir, codec } = await setup()
      expect(store.isSealed).toBe(true)
      await expect(store.get(SECRET_KEYS.modelApiKey)).rejects.toThrow()
      await store.unlock('test passphrase')
      await store.store(SECRET_KEYS.modelApiKey, 'synthetic-provider-canary')
      await store.store(NODE_DEPLOY_KEY_NAME, 'synthetic-deploy-canary')
      expect(await store.get(SECRET_KEYS.modelApiKey)).toBe('synthetic-provider-canary')
      expect(await store.get(NODE_DEPLOY_KEY_NAME)).toBe('synthetic-deploy-canary')
      const disk = await readFile(path.join(dir, NODE_KEYS_FILE), 'utf8')
      expect(disk).not.toContain('synthetic-provider-canary')
      expect(disk).not.toContain('synthetic-deploy-canary')
      expect(disk).not.toContain('test passphrase')
      const restarted = new NodeInterimKeyStore(new NodePrivateFiles(dir), codec)
      expect(restarted.isSealed).toBe(true)
      await restarted.unlock('test passphrase')
      expect(await restarted.get(SECRET_KEYS.modelApiKey)).toBe('synthetic-provider-canary')
      await restarted.delete(SECRET_KEYS.modelApiKey)
      expect(await restarted.get(SECRET_KEYS.modelApiKey)).toBeUndefined()
      restarted.seal()
      await expect(restarted.store(NODE_DEPLOY_KEY_NAME, 'test')).rejects.toThrow()
    },
  )
  nodeNativeTest(
    'H15 refuses wrong passphrase and item tampering or kind substitution',
    async () => {
      const { store, dir, codec } = await setup()
      await expect(store.unlock('wrong')).rejects.toThrow()
      expect(store.isSealed).toBe(true)
      await store.unlock('test passphrase')
      await store.store(SECRET_KEYS.modelApiKey, 'synthetic-provider-canary')
      store.seal()
      const file = path.join(dir, NODE_KEYS_FILE)
      const original = await readFile(file, 'utf8')
      for (const field of ['ciphertext', 'nonce', 'tag'] as const) {
        const record = codec.parse(original)
        record.items[0]![field][0] = (record.items[0]![field][0] ?? 0) ^ 1
        await writeFile(file, codec.serialize(record))
        await expect(store.unlock('test passphrase')).rejects.toThrow()
        expect(store.isSealed).toBe(true)
      }
      const swapped = codec.parse(original)
      swapped.items[0]!.id = 'deploy'
      await writeFile(file, codec.serialize(swapped))
      await expect(store.unlock('test passphrase')).rejects.toThrow()
    },
  )
  nodeNativeTest(
    'H08 lock during a slow unlock cannot unseal when it eventually returns',
    async () => {
      const codec = new FixtureCodec()
      const { store } = await setup(codec)
      const unwrap = codec.unwrapPassphraseSlot.bind(codec)
      const { promise: ready, resolve: started } = Promise.withResolvers<undefined>()
      const { promise: wait, resolve: release } = Promise.withResolvers<undefined>()
      codec.unwrapPassphraseSlot = async (slot, passphrase) => {
        started(undefined)
        await wait
        return await unwrap(slot, passphrase)
      }
      const unlocking = expect(store.unlock('test passphrase')).rejects.toThrow()
      await ready
      store.seal()
      release(undefined)
      await unlocking
      expect(store.isSealed).toBe(true)
    },
  )
  nodeNativeTest(
    'H06 rejects unsupported handles and destroys the usable slot before wipe',
    async () => {
      const { store, dir } = await setup()
      await expect(store.initialize('another')).rejects.toThrow()
      await store.unlock('test passphrase')
      await expect(store.store('other', 'test')).rejects.toThrow()
      await store.store(SECRET_KEYS.modelApiKey, 'test')
      await store.destroy()
      expect(store.isSealed).toBe(true)
      expect(await readFile(path.join(dir, NODE_KEYS_FILE), 'utf8')).toBe('')
      await expect(store.unlock('test passphrase')).rejects.toThrow()
    },
  )
  nodeNativeTest(
    'H09 refuses empty and oversized item values without altering ciphertext',
    async () => {
      const { store, dir } = await setup()
      await store.unlock('test passphrase')
      const before = await readFile(path.join(dir, NODE_KEYS_FILE))
      for (const value of ['', 'x'.repeat(65_537)])
        await expect(store.store(SECRET_KEYS.modelApiKey, value)).rejects.toThrow()
      expect(await readFile(path.join(dir, NODE_KEYS_FILE))).toEqual(before)
    },
  )
  nodeNativeTest(
    'H08 a wrong unlock seals an already open store and unknown empty handles refuse',
    async () => {
      const { store } = await setup()
      await store.unlock('test passphrase')
      await expect(store.get('unknown')).rejects.toThrow()
      await expect(store.unlock('wrong')).rejects.toThrow()
      expect(store.isSealed).toBe(true)
    },
  )
})
