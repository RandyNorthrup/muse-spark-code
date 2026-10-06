import { constants, createPublicKey, verify } from 'node:crypto'
import * as z from 'zod/mini'
import {
  UI_TEXT,
  VAULT_FORMAT_VERSION,
  VAULT_KEY_BYTES,
  VAULT_LIMITS,
} from '../../../shared/constants'
import { vaultEncodedSchema } from '../../../shared/vault'

const id = z.string().check(z.regex(/^[a-f0-9]{32}$/u))
const identity = z.strictObject({
  slotId: id,
  vaultId: id,
  tier: z.enum(['osStore', 'hardware', 'presence']),
})
const blob = vaultEncodedSchema.check(
  z.maxLength(VAULT_LIMITS.text),
  z.refine((v) => Buffer.from(v, 'base64').toString('base64') === v),
)
const challenge = blob.check(z.refine((v) => Buffer.from(v, 'base64').length === VAULT_KEY_BYTES))
const text = z
  .string()
  .check(z.minLength(1), z.maxLength(VAULT_LIMITS.text), z.regex(/^[^\0\r\n]+$/u))
// Fixed CNG RSA format, mirrored by the native helper (not a tunable).
const RSA_BYTES = 256
const RSA_BITS = 2048
export const windowsVaultContainerSchema = z
  .strictObject({
    v: z.literal(VAULT_FORMAT_VERSION),
    identity,
    sealed: blob,
    helloPublicKey: z.nullable(blob),
  })
  .check(
    z.refine(
      (v) =>
        (v.identity.tier === 'presence') === (v.helloPublicKey !== null) &&
        (v.identity.tier === 'osStore' || Buffer.from(v.sealed, 'base64').length === RSA_BYTES),
    ),
  )
export type WindowsVaultIdentity = z.infer<typeof identity>
const base = { v: z.literal(VAULT_FORMAT_VERSION) }
export const windowsVaultRequestSchema = z.discriminatedUnion('operation', [
  z.strictObject({ ...base, operation: z.literal('probe') }),
  z.strictObject({ ...base, operation: z.literal('screenLock') }),
  z.strictObject({ ...base, operation: z.literal('delete'), identity }),
  z.strictObject({ ...base, operation: z.literal('wrap'), identity, title: text, use: text }),
  z.strictObject({
    ...base,
    operation: z.literal('unwrap'),
    identity,
    container: windowsVaultContainerSchema,
    title: text,
    use: text,
    challenge,
  }),
])
type WindowsVaultRequest = z.infer<typeof windowsVaultRequestSchema>
const ok = { ...base, status: z.literal('ok') }
const probeSchema = z.strictObject({
  ...ok,
  rsa: z.boolean(),
  ecc: z.boolean(),
  hello: z.boolean(),
  dpapi: z.boolean(),
})
const wrapSchema = z.strictObject({ ...ok, container: windowsVaultContainerSchema })
const presenceSchema = z.strictObject({
  challenge,
  publicKey: blob,
  signature: blob,
  padding: z.enum(['pss', 'pkcs1']),
})
const unwrapSchema = z.strictObject({ ...ok, presence: z.optional(presenceSchema) })
const lockedSchema = z.strictObject({ ...ok, locked: z.literal(true) })
const doneSchema = z.strictObject(ok)

/** Owned response bytes; the invocation erases them, and all private input copies. */
export interface WindowsVaultTransport {
  exchange(header: Uint8Array, key: Uint8Array): Promise<Uint8Array>
}

/** Exactly the bytes signed by the helper's fresh Windows Hello request. */
export function windowsPresenceMessage(
  request: Extract<WindowsVaultRequest, { operation: 'unwrap' }>,
): Buffer {
  const { vaultId, slotId, tier } = request.identity
  return Buffer.from(
    `MuseSparkVault.${vaultId}.${slotId}.${tier}\n${request.use}\n${request.challenge}`,
  )
}

export async function invokeWindowsVault(
  transport: WindowsVaultTransport,
  input: WindowsVaultRequest,
  key: Uint8Array = new Uint8Array(),
) {
  const parsed = windowsVaultRequestSchema.safeParse(input)
  if (!parsed.success || key.length !== (parsed.data.operation === 'wrap' ? VAULT_KEY_BYTES : 0))
    throw new Error(UI_TEXT.vault.useChanged)
  const request = parsed.data
  const header = Buffer.from(JSON.stringify(request))
  if (header.length > VAULT_LIMITS.text) throw new Error(UI_TEXT.vault.useChanged)
  const owned = Buffer.alloc(key.length)
  owned.set(key)
  let output: Uint8Array | undefined
  try {
    output = await transport.exchange(header, owned)
    const frame = Buffer.from(output.buffer, output.byteOffset, output.byteLength)
    if (frame.length < Uint32Array.BYTES_PER_ELEMENT) throw new Error(UI_TEXT.vault.noAccess)
    const length = frame.readUInt32BE(0)
    const start = Uint32Array.BYTES_PER_ELEMENT
    const expected = request.operation === 'unwrap' ? VAULT_KEY_BYTES : 0
    if (length === 0 || length > VAULT_LIMITS.text || frame.length !== start + length + expected)
      throw new Error(UI_TEXT.vault.noAccess)
    const metadata: unknown = JSON.parse(frame.subarray(start, start + length).toString('utf8'))
    const probe = request.operation === 'probe' ? probeSchema.parse(metadata) : undefined
    const wrapped = request.operation === 'wrap' ? wrapSchema.parse(metadata) : undefined
    if (request.operation === 'unwrap') {
      const response = unwrapSchema.parse(metadata)
      if (request.identity.tier === 'presence') {
        const proof = response.presence
        if (
          proof?.challenge !== request.challenge ||
          proof.publicKey !== request.container.helloPublicKey
        )
          throw new Error(UI_TEXT.vault.noAccess)
        const publicKey = createPublicKey({
          key: Buffer.from(proof.publicKey, 'base64'),
          format: 'der',
          type: 'spki',
        })
        if (
          publicKey.asymmetricKeyType !== 'rsa' ||
          publicKey.asymmetricKeyDetails?.modulusLength !== RSA_BITS ||
          !verify(
            'sha256',
            windowsPresenceMessage(request),
            {
              key: publicKey,
              padding:
                proof.padding === 'pss'
                  ? constants.RSA_PKCS1_PSS_PADDING
                  : constants.RSA_PKCS1_PADDING,
              saltLength: constants.RSA_PSS_SALTLEN_DIGEST,
            },
            Buffer.from(proof.signature, 'base64'),
          )
        )
          throw new Error(UI_TEXT.vault.noAccess)
      } else if (response.presence !== undefined) throw new Error(UI_TEXT.vault.noAccess)
    } else if (request.operation === 'screenLock') lockedSchema.parse(metadata)
    else if (probe === undefined && wrapped === undefined) doneSchema.parse(metadata)
    const unwrapped = Buffer.alloc(expected)
    unwrapped.set(frame.subarray(start + length))
    return { probe, container: wrapped?.container, key: unwrapped }
  } catch {
    // OS, JSON, Zod and transport messages may contain secret/caller text.
    throw new Error(UI_TEXT.vault.noAccess)
  } finally {
    owned.fill(0)
    output?.fill(0)
  }
}
