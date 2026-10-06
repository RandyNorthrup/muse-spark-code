import { VaultAuditLog, type VaultAuditAnchorPort } from '../../../src/core/vault/broker/audit'
import { type VaultPrivateFilesPort } from '../../../src/core/vault/broker/files'
import { vaultAuditRecordSchema } from '../../../src/shared/vault'

export function realAudit() {
  let bytes = Buffer.alloc(0),
    anchor = { generation: 0, hash: '0'.repeat(64), baseGeneration: 0, baseHash: '0'.repeat(64) }
  const entered = Promise.withResolvers<undefined>(),
    waiting = Promise.withResolvers<undefined>()
  let isHolding = false,
    isFailing = false
  const files: VaultPrivateFilesPort = {
    writer: () => {
      let isClosed = false
      return {
        append: (next) => {
          if (isClosed) throw new Error('closed audit')
          if (isFailing) throw new Error('test terminal append failed')
          bytes = Buffer.concat([bytes, next])
        },
        replace: (next) => {
          if (isClosed) throw new Error('closed audit')
          bytes = Buffer.from(next)
        },
        close: () => {
          isClosed = true
        },
      }
    },
    directory: () => Promise.resolve(),
    read: () => Promise.resolve(Buffer.from(bytes)),
    replace: (_path, next) => {
      bytes = Buffer.from(next)
      return Promise.resolve()
    },
    claim: () => Promise.reject(new Error('unused audit claim')),
  }
  let tail: Promise<unknown> = Promise.resolve()
  const anchors: VaultAuditAnchorPort = {
    read: () => Promise.resolve(structuredClone(anchor)),
    write: async (next) => {
      anchor = structuredClone(next)
      if (!isHolding) {
        return
      }

      entered.resolve(undefined)
      await waiting.promise
    },
    transaction: async (run) => {
      const previous = tail
      const next = (async () => {
        try {
          await previous
        } catch {
          /* Prior caller owns failure. */
        }
        return await run()
      })()
      tail = next
      return await next
    },
  }
  const audit = new VaultAuditLog('test-audit', anchors, undefined, files)
  return {
    audit,
    entered: entered.promise,
    hold: () => {
      isHolding = true
    },
    release: () => {
      isHolding = false
      waiting.resolve(undefined)
    },
    fail: (isFailed: boolean) => {
      isFailing = isFailed
    },
    generation: () => anchor.generation,
    outcomes: () =>
      bytes
        .toString('utf8')
        .split('\n')
        .filter(Boolean)
        .map((line) => vaultAuditRecordSchema.parse(JSON.parse(line)).outcome),
  }
}
