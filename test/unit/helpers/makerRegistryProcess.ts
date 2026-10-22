import type { MakerSecrets } from '../../../src/core/maker/ports'
import process from 'node:process'
import { randomUUID } from 'node:crypto'
import * as z from 'zod/mini'
import {
  FileMachineStorage,
  MachineRegistry,
  machineSecretName,
} from '../../../src/core/maker/registry'

export const REGISTRY_PROCESS_MARKER = 'makerRegistryChild'

if (process.argv[3] === REGISTRY_PROCESS_MARKER) {
  const commandSchema = z.strictObject({
    operation: z.enum(['register', 'remove']),
    id: z.string(),
    endpoint: z.string(),
  })
  const replySchema = z.strictObject({ request: z.string(), value: z.optional(z.string()) })
  const waiting = new Map<string, (value: string | undefined) => void>()
  function secret(operation: string, name: string, value?: string): Promise<string | undefined> {
    const request = randomUUID()
    return new Promise((resolve) => {
      waiting.set(request, resolve)
      process.send?.({ type: 'secret', request, operation, name, value })
    })
  }
  const secrets: MakerSecrets = {
    get: (name) => secret('get', name),
    store: async (name, value) => {
      await secret('store', name, value)
    },
    delete: async (name) => {
      await secret('delete', name)
    },
  }
  const directory = process.argv[2]
  if (directory === undefined) throw new Error('missingDirectory')
  const registry = new MachineRegistry(new FileMachineStorage(directory), secrets, {
    classify: () => 'private',
    resolve: () => Promise.resolve(['192.168.1.2']),
  })
  process.on('message', (input: unknown) => {
    const reply = replySchema.safeParse(input)
    if (reply.success) {
      waiting.get(reply.data.request)?.(reply.data.value)
      waiting.delete(reply.data.request)
      return
    }
    const command = commandSchema.parse(input)
    void (async () => {
      try {
        const key = randomUUID()
        if (command.operation === 'remove') await registry.remove(command.id)
        else
          await registry.register(
            {
              id: command.id,
              name: command.id,
              kind: 'moonraker',
              category: 'printer',
              endpoint: command.endpoint,
              allowPlainHttp: false,
              limits: {},
            },
            key,
          )
        const records = await registry.list()
        const record = records.find((entry) => entry.id === command.id)
        const isOwnCredential =
          record === undefined ||
          (await secrets.get(machineSecretName(record.registrationId))) === key
        process.send?.({ type: 'result', ok: true, isOwnCredential, records })
      } catch (error) {
        process.send?.({
          type: 'result',
          ok: false,
          error: error instanceof Error ? error.message : 'unknownFailure',
        })
      }
    })()
  })
}
