import { randomBytes } from 'node:crypto'
import {
  UI_TEXT,
  VAULT_TOTP_DIGITS,
  VAULT_ID_BYTES,
  VAULT_LIMITS,
  VAULT_TOTP_PERIOD_SECONDS,
} from '../../shared/constants'
import { fill } from '../../shared/l10n/text'
import {
  type VaultItem,
  type VaultItemMetadata,
  type VaultBinding,
  type vaultMaterialSchema,
  vaultItemSchema,
  vaultItemMetadataSchema,
  vaultBindingSchema,
  vaultOriginSchema,
  vaultIssuerSchema,
  vaultResourceSchema,
} from '../../shared/vault'
import { readVaultExpiry } from '../../shared/vaultExpiry'
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

type GuidedTargetKind = 'ssh' | 'sshAnyHost' | 'sshSign' | 'git' | 'origin'

function isGuidedTargetKind(id: string): id is GuidedTargetKind {
  switch (id) {
    case 'ssh':
    case 'sshAnyHost':
    case 'sshSign':
    case 'git':
    case 'origin': {
      return true
    }
    default: {
      return false
    }
  }
}

function targetKindOptions(isKeepOffered: boolean): { label: string; id: string }[] {
  const options = [
    { label: UI_TEXT.vault.targetNone, id: 'none' },
    { label: UI_TEXT.vault.targetSsh, id: 'ssh' },
    { label: UI_TEXT.vault.targetSshAny, id: 'sshAnyHost' },
    { label: UI_TEXT.vault.targetSshSign, id: 'sshSign' },
    { label: UI_TEXT.vault.targetGit, id: 'git' },
    { label: UI_TEXT.vault.targetOrigin, id: 'origin' },
    { label: UI_TEXT.vault.disclosureUse, id: 'disclosure' },
    { label: UI_TEXT.vault.targetCustom, id: 'custom' },
  ]
  if (isKeepOffered) options.unshift({ label: UI_TEXT.vault.targetKeep, id: 'keep' })
  return options
}

function guidedTargetFields(kind: GuidedTargetKind): { key: string; prompt: string }[] {
  switch (kind) {
    case 'ssh': {
      return [
        { key: 'host', prompt: UI_TEXT.vault.targetHostName },
        { key: 'remoteUser', prompt: UI_TEXT.vault.remoteUser },
        { key: 'hostKeyFingerprint', prompt: UI_TEXT.vault.hostKey },
      ]
    }
    case 'sshAnyHost': {
      return [{ key: 'remoteUser', prompt: UI_TEXT.vault.remoteUser }]
    }
    case 'sshSign': {
      return [{ key: 'keyFingerprint', prompt: UI_TEXT.vault.targetKeyFingerprint }]
    }
    case 'git': {
      return [
        { key: 'host', prompt: UI_TEXT.vault.targetHostName },
        { key: 'path', prompt: UI_TEXT.vault.targetPath },
      ]
    }
    case 'origin': {
      return [{ key: 'origin', prompt: UI_TEXT.vault.origin }]
    }
  }
}

function guidedBindingCandidate(
  kind: GuidedTargetKind,
  answers: Readonly<Record<string, string>>,
  isForwarding: boolean,
): unknown {
  switch (kind) {
    case 'ssh': {
      return {
        kind,
        host: answers['host'],
        remoteUser: answers['remoteUser'],
        hostKeyFingerprint: answers['hostKeyFingerprint'],
        forwarding: isForwarding,
      }
    }
    case 'sshAnyHost': {
      return { kind, remoteUser: answers['remoteUser'], forwarding: isForwarding }
    }
    case 'sshSign': {
      return { kind, keyFingerprint: answers['keyFingerprint'], namespace: 'git' }
    }
    case 'git': {
      return { kind, protocol: 'https', host: answers['host'], path: answers['path'] }
    }
    case 'origin': {
      return { kind, origin: answers['origin'] }
    }
  }
}

function firstIssueFields(issues: readonly { path: readonly unknown[] }[]): string[] {
  const issue = issues.find((entry) => entry.path.some((part) => typeof part === 'string'))
  return issue === undefined
    ? []
    : issue.path.filter((part): part is string => typeof part === 'string')
}

function bindingsProblem(issues: readonly { path: readonly unknown[] }[]): string {
  const names = firstIssueFields(issues)
  return names.length === 0
    ? UI_TEXT.vault.targetListInvalid
    : fill(UI_TEXT.vault.targetFieldIssue, { field: names.join('.') })
}

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
  /** Asks a box again with the reason until the answer fits; the typed text stays. */
  async function ask(
    prompt: string,
    value: string | undefined,
    problem: (answer: string) => string | null,
  ): Promise<string> {
    let asking = prompt
    let keeping = value
    for (;;) {
      const answer = await input(asking, false, keeping)
      const reason = problem(answer)
      if (reason === null) return answer
      asking = `${reason} ${prompt}`
      keeping = answer
    }
  }
  /**
  Reads an expiry the person types, in the two shapes its prompt names; empty
  stays empty only where allowed. `stored` is the item's own expiry an edit
  pre-fills, or null: keeping it unchanged is never refused as passed.
  */
  async function readExpiry(
    stored: number | null,
    isEmptyAllowed: boolean,
  ): Promise<number | null> {
    const prompt = isEmptyAllowed
      ? `${UI_TEXT.vault.expiresPrompt} ${UI_TEXT.vault.expiresNone}`
      : UI_TEXT.vault.expiresPrompt
    let asking = prompt
    let keeping = stored === null ? undefined : new Date(stored).toISOString()
    for (;;) {
      const answer = await input(asking, false, keeping)
      if (answer === '') {
        if (isEmptyAllowed) return null
        asking = `${UI_TEXT.vault.fieldMissing} ${prompt}`
        keeping = answer
        continue
      }
      const reading = readVaultExpiry(answer, native.now(), stored)
      if (reading.refusal === null) return reading.at
      asking = `${reading.refusal} ${prompt}`
      keeping = answer
    }
  }
  async function readGuidedBinding(kind: GuidedTargetKind): Promise<VaultBinding> {
    const fields = guidedTargetFields(kind)
    const answers: Record<string, string> = {}
    for (const field of fields) {
      answers[field.key] = await ask(field.prompt, undefined, (answer) =>
        answer === '' ? UI_TEXT.vault.fieldMissing : null,
      )
    }
    const isForwarding =
      kind === 'ssh' || kind === 'sshAnyHost'
        ? await isToggleOn(UI_TEXT.vault.forwarding, false)
        : false
    for (;;) {
      const checked = vaultBindingSchema.safeParse(
        guidedBindingCandidate(kind, answers, isForwarding),
      )
      if (checked.success) return checked.data
      const names = firstIssueFields(checked.error.issues)
      const wanted = names.at(-1)
      const retry = fields.find((field) => field.key === wanted) ?? fields[0]
      if (retry === undefined) {
        // Every guided kind asks at least one field: unreachable.
        throw new Error(UI_TEXT.vault.targetListInvalid)
      }
      answers[retry.key] = await ask(retry.prompt, answers[retry.key] ?? '', (answer) =>
        answer === '' ? UI_TEXT.vault.fieldMissing : UI_TEXT.vault.fieldInvalid,
      )
    }
  }
  async function readBindingsJson(prefill: readonly VaultBinding[]): Promise<VaultBinding[]> {
    let asking = UI_TEXT.vault.targetHelp
    let keeping: string | undefined = JSON.stringify(prefill)
    for (;;) {
      const text = await input(asking, false, keeping)
      let parsed: unknown
      try {
        parsed = JSON.parse(text)
      } catch (error: unknown) {
        // Malformed JSON asks again; anything else keeps its kind.
        if (!(error instanceof SyntaxError)) throw error
        asking = `${UI_TEXT.vault.targetNotJson} ${UI_TEXT.vault.targetHelp}`
        keeping = text
        continue
      }
      const checked = z.array(vaultBindingSchema).safeParse(parsed)
      if (checked.success) return checked.data
      asking = `${bindingsProblem(checked.error.issues)} ${UI_TEXT.vault.targetHelp}`
      keeping = text
    }
  }
  async function selectedBinding(kind: string): Promise<VaultBinding | null> {
    if (kind === 'disclosure') return { kind: 'disclosure', recipient: 'person' }
    return isGuidedTargetKind(kind) ? await readGuidedBinding(kind) : null
  }
  async function readBindings(
    existing: readonly VaultBinding[] | undefined,
  ): Promise<VaultBinding[]> {
    const selected = await choice(targetKindOptions(existing !== undefined && existing.length > 0))
    if (selected === 'keep') return [...(existing ?? [])]
    if (selected === 'none') return []
    if (selected === 'custom') return await readBindingsJson(existing ?? [])
    const list: VaultBinding[] = []
    const first = await selectedBinding(selected)
    if (first === null) {
      // The picker only offers known kinds: keep the entries so far.
      return list
    }
    list.push(first)
    for (;;) {
      const again = await choice([
        { label: UI_TEXT.vault.targetAddAnother, id: 'another' },
        { label: UI_TEXT.vault.targetDone, id: 'done' },
      ])
      if (again !== 'another') return list
      const kind = await choice(targetKindOptions(false).filter((option) => option.id !== 'none'))
      if (kind === 'custom') return await readBindingsJson(list)
      const next = await selectedBinding(kind)
      if (next === null) {
        // The picker only offers known kinds: keep the entries so far.
        return list
      }
      list.push(next)
    }
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
    const name = await ask(
      `${UI_TEXT.vault.name}: ${UI_TEXT.vault.labelWarning}`,
      current?.name,
      (answer) => {
        if (answer === '') return UI_TEXT.vault.fieldMissing
        return /^[a-z][a-z0-9-]{0,47}$/u.test(answer) ? null : UI_TEXT.vault.nameInvalid
      },
    )
    const label = await ask(
      `${UI_TEXT.vault.label}: ${UI_TEXT.vault.labelWarning}`,
      current?.label,
      (answer) => {
        if (answer === '') return UI_TEXT.vault.fieldMissing
        return answer.length > VAULT_LIMITS.label || /[\0\r\n]/u.test(answer)
          ? UI_TEXT.vault.labelInvalid
          : null
      },
    )
    const bindings = await readBindings(current?.bindings)
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
    const expiry = await readExpiry(current?.dates.expiresAt ?? null, true)
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
        expiresAt: expiry,
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
          origin: await ask(UI_TEXT.vault.origin, undefined, (answer) => {
            if (answer === '') return UI_TEXT.vault.fieldMissing
            return vaultOriginSchema.safeParse(answer).success ? null : UI_TEXT.vault.originInvalid
          }),
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
        const origins = await ask(UI_TEXT.vault.origin, undefined, (answer) => {
          if (answer === '') return UI_TEXT.vault.fieldMissing
          const entries = answer.split(',').map((part) => part.trim())
          const isValid =
            entries.length > 0 &&
            entries.every(
              (entry) =>
                entry !== '' &&
                entry.startsWith('https://') &&
                vaultOriginSchema.safeParse(entry).success,
            )
          return isValid ? null : UI_TEXT.vault.originsInvalid
        })
        material = {
          kind: 'webLogin',
          origins: origins.split(',').map((part) => part.trim()),
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
          issuer: await ask('issuer', undefined, (answer) => {
            if (answer === '') return UI_TEXT.vault.fieldMissing
            return vaultIssuerSchema.safeParse(answer).success ? null : UI_TEXT.vault.issuerInvalid
          }),
          resource: await ask(UI_TEXT.vault.resource, undefined, (answer) => {
            if (answer === '') return UI_TEXT.vault.fieldMissing
            return vaultResourceSchema.safeParse(answer).success
              ? null
              : UI_TEXT.vault.resourceInvalid
          }),
          expiresAt: await readExpiry(null, false),
        }
        break
      }
      case 'session': {
        material = {
          kind: 'session',
          cookies: await requiredBytes(UI_TEXT.vault.session),
          origin: await ask(UI_TEXT.vault.origin, undefined, (answer) => {
            if (answer === '') return UI_TEXT.vault.fieldMissing
            return !answer.startsWith('https://') || !vaultOriginSchema.safeParse(answer).success
              ? UI_TEXT.vault.originHttpsInvalid
              : null
          }),
          expiresAt: await readExpiry(null, false),
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
  } catch (error: unknown) {
    if (error instanceof Cancelled) return null
    // A refused edit keeps the fixed sentence with its cause for the caller.
    throw new Error(UI_TEXT.vault.operationFailed, { cause: error })
  } finally {
    if (!isTransferred) for (const buffer of buffers) buffer.fill(0)
  }
}
