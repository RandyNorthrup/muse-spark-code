import { UI_TEXT, VAULT_KEY_BYTES } from '../../../shared/constants'
import type { VaultSlotRecord } from '../../../shared/vault'

// The wrap flow every platform slot follows: own the key, check the
// capability, invoke the helper and record an accepted container, erasing
// the owned copy either way. Platforms differ only in the invoke arguments,
// the acceptance check and the record.

export interface SlotWrapDeps<Container> {
  readonly key: Uint8Array
  readonly checkCapability: () => Promise<void>
  readonly invoke: (owned: Buffer) => Promise<{ container: Container | undefined }>
  readonly accept: (container: Container) => boolean
  readonly record: (raw: string) => VaultSlotRecord
}

/** Wrap a key through the platform helper without ever exposing the owned copy. */
export async function wrapSlotKey<Container>(
  deps: SlotWrapDeps<Container>,
): Promise<VaultSlotRecord> {
  const { key } = deps
  if (key.length !== VAULT_KEY_BYTES) throw new Error(UI_TEXT.vault.useChanged)
  const owned = Buffer.alloc(VAULT_KEY_BYTES)
  owned.set(key)
  try {
    await deps.checkCapability()
    const { container } = await deps.invoke(owned)
    if (container === undefined || !deps.accept(container))
      throw new Error(UI_TEXT.vault.useChanged)
    return deps.record(Buffer.from(JSON.stringify(container)).toString('base64'))
  } finally {
    owned.fill(0)
  }
}
