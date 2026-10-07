import * as z from 'zod/mini'
import {
  UI_TEXT,
  VAULT_FORMAT_VERSION,
  VAULT_KEY_BYTES,
  VAULT_LIMITS,
  VAULT_NONCE_BYTES,
  VAULT_TAG_BYTES,
} from '../../../shared/constants'
import { vaultEncodedSchema } from '../../../shared/vault'

const id = z.string().check(z.regex(/^[a-f0-9]{32}$/u))
const identity = z.strictObject({
  slotId: id,
  vaultId: id,
  tier: z.enum(['osStore', 'hardware', 'presence']),
})
const encodedBytes = (length: number) =>
  vaultEncodedSchema.check(
    z.refine((value) => {
      const bytes = Buffer.from(value, 'base64')
      return bytes.length === length && bytes.toString('base64') === value
    }),
  )
const blob = vaultEncodedSchema.check(
  z.maxLength(VAULT_LIMITS.text),
  z.refine((value) => Buffer.from(value, 'base64').toString('base64') === value),
)
export const macVaultContainerSchema = z
  .strictObject({
    v: z.literal(VAULT_FORMAT_VERSION),
    identity,
    sealed: encodedBytes(VAULT_NONCE_BYTES + VAULT_KEY_BYTES + VAULT_TAG_BYTES),
    keyBlob: z.optional(blob),
    ephemeral: z.optional(encodedBytes(VAULT_KEY_BYTES * 2 + 1)),
    salt: z.optional(encodedBytes(VAULT_KEY_BYTES)),
  })
  .check(
    z.refine((value) =>
      value.identity.tier === 'osStore'
        ? value.keyBlob === undefined && value.ephemeral === undefined && value.salt === undefined
        : value.keyBlob !== undefined && value.ephemeral !== undefined && value.salt !== undefined,
    ),
  )
export type MacVaultContainer = z.infer<typeof macVaultContainerSchema>
export type MacVaultIdentity = z.infer<typeof identity>

const requestBase = { v: z.literal(VAULT_FORMAT_VERSION) }
const use = z
  .string()
  .check(z.minLength(1), z.maxLength(VAULT_LIMITS.text), z.regex(/^[^\0\r\n]+$/u))
export const macVaultRequestSchema = z.discriminatedUnion('operation', [
  z.strictObject({ ...requestBase, operation: z.literal('probe') }),
  z.strictObject({ ...requestBase, operation: z.literal('wrap'), identity }),
  z.strictObject({ ...requestBase, operation: z.literal('delete'), identity }),
  z.strictObject({
    ...requestBase,
    operation: z.literal('unwrap'),
    identity,
    container: macVaultContainerSchema,
    use,
  }),
])
type MacVaultRequest = z.infer<typeof macVaultRequestSchema>
const responseBase = { v: z.literal(VAULT_FORMAT_VERSION), status: z.literal('ok') }
const probeSchema = z.strictObject({
  ...responseBase,
  secureEnclave: z.boolean(),
  certified: z.boolean(),
})
const wrapSchema = z.strictObject({ ...responseBase, container: macVaultContainerSchema })
const doneSchema = z.strictObject(responseBase)
const errorSchema = z.strictObject({
  v: z.literal(VAULT_FORMAT_VERSION),
  status: z.literal('error'),
  code: z.enum([
    'invalidRequest',
    'unavailable',
    'keychainLocked',
    'itemMissing',
    'authentication',
    'cancelled',
  ]),
})

// Fixed protocol metadata for B's recovery UI; no native diagnostic text escapes.
const failures = {
  cancelled: { name: 'MacVaultCancelledError', recoveryAction: 'requestAgain' },
  unavailable: { name: 'MacVaultUnavailableError', recoveryAction: 'usePassphrase' },
  keychainLocked: { name: 'MacVaultKeychainLockedError', recoveryAction: 'unlockKeychain' },
  itemMissing: { name: 'MacVaultItemMissingError', recoveryAction: 'restoreSlot' },
  authentication: { name: 'MacVaultAuthenticationError', recoveryAction: 'restoreBackup' },
  invalidRequest: { name: 'MacVaultInvalidRequestError', recoveryAction: 'repairRequest' },
} as const

export class MacVaultError extends Error {
  readonly recoveryAction
  constructor(readonly code: z.infer<typeof errorSchema>['code']) {
    super(UI_TEXT.vault.noAccess)
    this.name = failures[code].name
    this.recoveryAction = failures[code].recoveryAction
  }
}

function readFrame(output: Uint8Array) {
  const frame = Buffer.from(output.buffer, output.byteOffset, output.byteLength)
  const start = Uint32Array.BYTES_PER_ELEMENT
  if (frame.length < start) throw new Error(UI_TEXT.vault.useChanged)
  const length = frame.readUInt32BE(0)
  if (length === 0 || length > VAULT_LIMITS.text || frame.length < start + length) {
    throw new Error(UI_TEXT.vault.useChanged)
  }
  const metadata: unknown = JSON.parse(frame.subarray(start, start + length).toString('utf8'))
  return { metadata, privateBytes: frame.subarray(start + length) }
}

/** A failed child may return only a complete fixed error frame, never private bytes. */
export function macVaultFailure(output: Uint8Array): MacVaultError | undefined {
  try {
    const { metadata, privateBytes } = readFrame(output)
    const failure = errorSchema.safeParse(metadata)
    if (failure.success && privateBytes.length === 0) return new MacVaultError(failure.data.code)
  } catch {
    // An invalid frame is an uncoded failure, with no parser/native diagnostics.
  }
  return undefined
}

/** Implementations own returned bytes; invoke erases the transport buffer after parsing. */
export interface MacVaultTransport {
  exchange(header: Uint8Array, key: Uint8Array): Promise<Uint8Array>
}

export async function invokeMacVault(
  transport: MacVaultTransport,
  input: MacVaultRequest,
  key: Uint8Array = new Uint8Array(),
) {
  const parsed = macVaultRequestSchema.safeParse(input)
  if (!parsed.success) throw new Error(UI_TEXT.vault.useChanged)
  const request = parsed.data
  if (key.length !== (request.operation === 'wrap' ? VAULT_KEY_BYTES : 0)) {
    throw new Error(UI_TEXT.vault.useChanged)
  }
  const header = Buffer.from(JSON.stringify(request))
  if (header.length > VAULT_LIMITS.text) throw new Error(UI_TEXT.vault.useChanged)
  // Snapshot caller-owned secret bytes before the asynchronous boundary.
  const ownedKey = Buffer.alloc(key.length)
  ownedKey.set(key)
  let output: Uint8Array | undefined
  const inaccessible = new Error(UI_TEXT.vault.noAccess)
  try {
    output = await transport.exchange(header, ownedKey)
    const { metadata, privateBytes } = readFrame(output)
    const failure = errorSchema.safeParse(metadata)
    if (failure.success) {
      if (privateBytes.length > 0) throw new Error(UI_TEXT.vault.useChanged)
      throw new MacVaultError(failure.data.code)
    }
    const expected = request.operation === 'unwrap' ? VAULT_KEY_BYTES : 0
    if (privateBytes.length !== expected) throw new Error(UI_TEXT.vault.useChanged)
    const probe = request.operation === 'probe' ? probeSchema.parse(metadata) : undefined
    const wrapped = request.operation === 'wrap' ? wrapSchema.parse(metadata) : undefined
    if (probe === undefined && wrapped === undefined) doneSchema.parse(metadata)
    const unwrapped = Buffer.alloc(expected)
    unwrapped.set(privateBytes)
    return { probe, container: wrapped?.container, key: unwrapped }
  } catch (error) {
    // JSON, Zod, transport and OS diagnostics can contain caller text. Only
    // the validated fixed error class may cross the broker boundary.
    throw error instanceof MacVaultError ? error : inaccessible
  } finally {
    ownedKey.fill(0)
    output?.fill(0)
  }
}
