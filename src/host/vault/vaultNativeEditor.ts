import { randomBytes } from 'node:crypto'
import {
  UI_TEXT,
  VAULT_TOTP_DIGITS,
  VAULT_ID_BYTES,
  VAULT_TOTP_PERIOD_SECONDS,
} from '../../shared/constants'
import {
  type VaultItem,
  type VaultItemMetadata,
  type VaultBinding,
  type vaultMaterialSchema,
  vaultItemSchema,
  vaultItemMetadataSchema,
  vaultBindingSchema,
} from '../../shared/vault'
import * as z from 'zod/mini'

export interface VaultNativeInput {
  input(options: { prompt: string; password: boolean; value?: string }): Promise<string | undefined>
  pick(options: readonly { label: string; id: string }[]): Promise<string | undefined>
  /** S owns key generation/import and must return owned private bytes and verified public metadata. */
  sshKey(): Promise<{
    material: Extract<ReturnType<typeof vaultMaterialSchema.parse>, { kind: 'sshKey' }>
    publicKey: string
    fingerprint: string
  } | null>
  now(): number
}
class Cancelled extends Error {}

/** Returned bytes transfer to the controller, which wipes after the transaction. */
export async function editVaultItem(
  native: VaultNativeInput,
  current?: VaultItemMetadata,
  signal?: AbortSignal,
): Promise<VaultItem | VaultItemMetadata | null> {
  const buffers: Uint8Array[] = []
  let isTransferred = false
  function checkCancellation(): void {
    if (signal?.aborted) throw new Cancelled()
  }
  async function input(prompt: string, isPassword: boolean, value?: string): Promise<string> {
    checkCancellation()
    const entered = await native.input({
      prompt,
      password: isPassword,
      ...(value !== undefined && { value }),
    })
    checkCancellation()
    if (entered === undefined) throw new Cancelled()
    return entered
  }
  async function bytes(prompt: string, isOptional = false): Promise<Buffer<ArrayBuffer> | null> {
    const entered = { value: await input(prompt, true) }
    try {
      if (isOptional && entered.value === '') return null
      const buffer = Buffer.alloc(Buffer.byteLength(entered.value))
      buffer.write(entered.value)
      buffers.push(buffer)
      return buffer
    } finally {
      entered.value = ''
    }
  }
  async function requiredBytes(prompt: string): Promise<Buffer<ArrayBuffer>> {
    const value = await bytes(prompt)
    if (value === null) throw new Cancelled()
    return value
  }
  async function choice(options: readonly { label: string; id: string }[]): Promise<string> {
    checkCancellation()
    const value = await native.pick(options)
    checkCancellation()
    if (value === undefined) throw new Cancelled()
    return value
  }
  async function isToggleOn(label: string, isOn: boolean): Promise<boolean> {
    const selected = await choice([
      { label: `${label}: ${isOn ? UI_TEXT.toggleOn : UI_TEXT.toggleOff}`, id: 'keep' },
      { label: `${label}: ${isOn ? UI_TEXT.toggleOff : UI_TEXT.toggleOn}`, id: 'change' },
    ])
    return selected === 'keep' ? isOn : !isOn
  }
  try {
    const kind =
      current?.kind ??
      (await choice([
        { label: UI_TEXT.vault.apiKey, id: 'apiKey' },
        { label: UI_TEXT.vault.password, id: 'password' },
        { label: UI_TEXT.vault.secret, id: 'secret' },
        { label: UI_TEXT.vault.webLogin, id: 'webLogin' },
        { label: UI_TEXT.vault.totp, id: 'totp' },
        { label: UI_TEXT.vault.oauth, id: 'oauth' },
        { label: UI_TEXT.vault.sshKey, id: 'sshKey' },
        { label: UI_TEXT.vault.session, id: 'session' },
      ]))
    const name = await input(
      `${UI_TEXT.vault.name}: ${UI_TEXT.vault.labelWarning}`,
      false,
      current?.name,
    )
    const label = await input(
      `${UI_TEXT.vault.label}: ${UI_TEXT.vault.labelWarning}`,
      false,
      current?.label,
    )
    const bindingsText = await input(
      UI_TEXT.vault.target,
      false,
      JSON.stringify(current?.bindings ?? []),
    )
    const bindingArray = z.array(vaultBindingSchema).parse(JSON.parse(bindingsText))
    const bindings: VaultBinding[] = bindingArray
    const isFirstParty = current?.firstParty ?? false
    const isRestricted = isFirstParty || kind === 'internal' || kind === 'devicePair'
    // The current mode stays first so accepting every default preserves it.
    const modeChoices = [
      { label: UI_TEXT.vault.askEveryTime, id: 'askEveryTime' },
      { label: UI_TEXT.vault.askOncePerSession, id: 'askOncePerSession' },
      { label: UI_TEXT.vault.alwaysAllow, id: 'alwaysAllow' },
      { label: UI_TEXT.vault.never, id: 'never' },
    ]
    if (current !== undefined) {
      const at = modeChoices.findIndex((option) => option.id === current.policy.mode)
      if (at > 0) {
        const [keeping] = modeChoices.splice(at, 1)
        if (keeping !== undefined) modeChoices.unshift(keeping)
      }
    }
    const mode = isRestricted ? 'never' : await choice(modeChoices)
    const isRequirePresence = await isToggleOn(
      `${UI_TEXT.vault.requirePresence}: ${UI_TEXT.vault.presenceAdvice}`,
      current?.requirePresence ?? false,
    )
    const expiresAt = current?.dates.expiresAt
    const expiry = await input(
      UI_TEXT.vault.expires,
      false,
      expiresAt == null ? '' : new Date(expiresAt).toISOString(),
    )
    const metadata = vaultItemMetadataSchema.parse({
      id: current?.id ?? randomBytes(VAULT_ID_BYTES).toString('hex'),
      name,
      handle: `secret://${name}`,
      label,
      kind,
      bindings,
      requirePresence: isRequirePresence,
      hidden: isRestricted || (await isToggleOn(UI_TEXT.vault.hidden, current?.hidden ?? false)),
      firstParty: isFirstParty,
      policy: {
        mode,
        unattendedAllowed:
          !isRestricted &&
          !isRequirePresence &&
          (await isToggleOn(UI_TEXT.vault.unattended, current?.policy.unattendedAllowed ?? false)),
        allowDisclosure:
          !isRestricted &&
          (await isToggleOn(UI_TEXT.vault.disclosureUse, current?.policy.allowDisclosure ?? false)),
      },
      dates: {
        ...(current?.dates ?? {
          createdAt: native.now(),
          rotatedAt: null,
          expiresAt: null,
          lastUsedAt: null,
        }),
        expiresAt: expiry === '' ? null : new Date(expiry).getTime(),
      },
      publicKey: current?.publicKey ?? null,
      fingerprint: current?.fingerprint ?? null,
    })
    if (
      current !== undefined &&
      (await choice([
        { label: UI_TEXT.vault.metadataOnly, id: 'metadata' },
        { label: UI_TEXT.vault.replaceValue, id: 'replace' },
      ])) === 'metadata'
    )
      return metadata
    let material: unknown
    switch (metadata.kind) {
      case 'apiKey': {
        material = {
          kind: 'apiKey',
          value: await requiredBytes(UI_TEXT.vault.value),
          auth: await choice([
            { label: `${UI_TEXT.vault.apiKey} (Bearer)`, id: 'bearer' },
            { label: UI_TEXT.vault.apiKey, id: 'apiKey' },
            { label: UI_TEXT.vault.headerUse, id: 'header' },
          ]),
          origin: await input(UI_TEXT.vault.origin, false),
        }
        break
      }
      case 'password': {
        material = {
          kind: 'password',
          username: await bytes(UI_TEXT.vault.username, true),
          password: await requiredBytes(UI_TEXT.vault.password),
        }
        break
      }
      case 'webLogin': {
        const origins = await input(UI_TEXT.vault.origin, false)
        material = {
          kind: 'webLogin',
          origins: origins.split(','),
          username: await requiredBytes(UI_TEXT.vault.username),
          password: await requiredBytes(UI_TEXT.vault.password),
          totpSeed: await bytes(UI_TEXT.vault.seed, true),
        }
        break
      }
      case 'totp': {
        material = {
          kind: 'totp',
          seed: await requiredBytes(UI_TEXT.vault.seed),
          algorithm: 'sha1',
          digits: VAULT_TOTP_DIGITS.standard,
          periodSeconds: VAULT_TOTP_PERIOD_SECONDS,
        }
        break
      }
      case 'oauth': {
        material = {
          kind: 'oauth',
          accessToken: await requiredBytes(`${UI_TEXT.vault.value} (accessToken)`),
          refreshToken: await bytes(`${UI_TEXT.vault.value} (refreshToken)`, true),
          issuer: await input('issuer', false),
          resource: await input(UI_TEXT.vault.resource, false),
          expiresAt: new Date(await input(UI_TEXT.vault.expires, false)).getTime(),
        }
        break
      }
      case 'session': {
        material = {
          kind: 'session',
          cookies: await requiredBytes(UI_TEXT.vault.session),
          origin: await input(UI_TEXT.vault.origin, false),
          expiresAt: new Date(await input(UI_TEXT.vault.expires, false)).getTime(),
        }
        break
      }
      case 'sshKey': {
        const key = await native.sshKey()
        if (key === null) throw new Cancelled()
        material = key.material
        if (key.material.storage === 'software') buffers.push(key.material.privateKey)
        metadata.publicKey = key.publicKey
        metadata.fingerprint = key.fingerprint
        break
      }
      case 'secret':
      case 'internal':
      case 'devicePair': {
        material = { kind: metadata.kind, value: await requiredBytes(UI_TEXT.vault.value) }
        break
      }
    }
    const item = vaultItemSchema.parse({
      metadata: {
        ...metadata,
        dates: { ...metadata.dates, rotatedAt: current === undefined ? null : native.now() },
      },
      material,
    })
    checkCancellation()
    isTransferred = true
    return item
  } catch (error) {
    if (error instanceof Cancelled) return null
  } finally {
    if (!isTransferred) for (const buffer of buffers) buffer.fill(0)
  }
  throw new Error(UI_TEXT.vault.operationFailed)
}
