import { createHash, randomUUID } from 'node:crypto'
import { constants } from 'node:fs'
import { lstat, mkdir, open, rename, rm } from 'node:fs/promises'
import path from 'node:path'
import * as z from 'zod/mini'
import { settingSchema } from '../host/settings'
import { storeErrorCode } from '../host/backend/storeErrors'
import { countSecretMatches } from '../shared/redact'
import { RUNTIME_STATE, SETTINGS_SECTION, SETTING_DEFAULTS } from '../shared/constants'
import { jsonValueSchema, settingKeySchema } from '../shared/hostApi/data'
import { setTimeout as delay } from 'node:timers/promises'
import { workspaceKey } from './dataFolder'

const recordSchema = z
  .strictObject({
    version: z.union([z.literal(1), z.literal(RUNTIME_STATE.version)]),
    revision: z.optional(z.number().check(z.int(), z.gte(0), z.lte(Number.MAX_SAFE_INTEGER))),
    activityAt: z.optional(z.number().check(z.gte(0))),
    key: z.string().check(z.maxLength(RUNTIME_STATE.maximumKeyChars)),
    value: jsonValueSchema,
  })
  .check(z.refine((record) => record.version === 1 || record.revision !== undefined))
type JsonValue = z.infer<typeof jsonValueSchema>
type Scope = 'user' | 'workspace'
type StoreKind = 'settings' | 'storage'
// Separate ACP/panel store instances share the exact resolved record queue.
const publications = new Map<string, Promise<void>>()
const observers = new Map<string, Set<(key: string) => void>>()
const activitySchema = z.object({ at: z.number().check(z.gte(0)) })
const credentialName = /(?:api[_-]?key|access[_-]?token|refresh[_-]?token|password|secret)/iu

/** Values have no credential lane; neither a secret-shaped value nor a named credential is stored. */
function checkValue(key: string, value: JsonValue): void {
  const inspect = (name: string, item: JsonValue): void => {
    if (credentialName.test(name)) throw new Error('MHP_STATE_CREDENTIAL_REFUSED')
    if (name === 'name' && typeof item === 'string' && credentialName.test(item))
      throw new Error('MHP_STATE_CREDENTIAL_REFUSED')
    if (typeof item === 'object' && item !== null) {
      for (const [field, child] of Object.entries(item)) inspect(field, child)
    }
  }
  inspect(key, value)
  if (countSecretMatches(JSON.stringify(value), []) > 0)
    throw new Error('MHP_STATE_CREDENTIAL_REFUSED')
}

/** Per-key atomic records avoid unrelated writers replacing a whole shared map. */
export class RuntimeSettingsStore {
  private readonly writers = new Set<Promise<void>>()

  public constructor(
    private readonly root: string,
    private readonly workspaceRoot: string,
  ) {}

  private file(kind: StoreKind, scope: Scope, key: string): string {
    recordSchema.shape.key.parse(key)
    const name = createHash('sha256').update(key).digest('hex')
    const namespace = scope === 'user' ? 'global' : workspaceKey(this.workspaceRoot)
    return path.resolve(this.root, RUNTIME_STATE.folder, kind, namespace, `${name}.json`)
  }

  private async readRecord(
    kind: StoreKind,
    scope: Scope,
    key: string,
  ): Promise<z.infer<typeof recordSchema> | undefined> {
    const file = this.file(kind, scope, key)
    let handle
    try {
      const entry = await lstat(file)
      if (!entry.isFile()) throw new Error('MHP_STATE_INVALID_RECORD')
      handle = await open(file, constants.O_RDONLY | constants.O_NOFOLLOW)
    } catch (error: unknown) {
      if (storeErrorCode(error) === 'ENOENT') return
      throw error
    }
    try {
      const stat = await handle.stat()
      if (!stat.isFile() || stat.size > RUNTIME_STATE.maximumRecordBytes)
        throw new Error('MHP_STATE_INVALID_RECORD')
      const bytes = new Uint8Array(RUNTIME_STATE.maximumRecordBytes + 1)
      let offset = 0
      for (;;) {
        const part = await handle.read(bytes, offset, bytes.length - offset, null)
        offset += part.bytesRead
        if (offset > RUNTIME_STATE.maximumRecordBytes) throw new Error('MHP_STATE_TOO_LARGE')
        if (part.bytesRead === 0) break
      }
      const raw: unknown = JSON.parse(new TextDecoder().decode(bytes.subarray(0, offset)))
      const parsed = recordSchema.safeParse(raw)
      if (!parsed.success) throw new Error('MHP_STATE_INVALID_RECORD')
      const record = parsed.data
      if (record.key !== key) throw new Error('MHP_STATE_INVALID_RECORD')
      checkValue(key, record.value)
      return record
    } finally {
      await handle.close()
    }
  }

  private async read(kind: StoreKind, scope: Scope, key: string): Promise<JsonValue | undefined> {
    const record = await this.readRecord(kind, scope, key)
    return record?.value
  }

  private async lock(file: string): Promise<() => Promise<void>> {
    const deadline = Date.now() + RUNTIME_STATE.lockTimeoutMs
    for (;;) {
      try {
        const handle = await open(`${file}.lock`, 'wx', RUNTIME_STATE.fileMode)
        return async () => {
          await handle.close()
          await rm(`${file}.lock`)
        }
      } catch (error: unknown) {
        if (storeErrorCode(error) !== 'EEXIST') throw error
        // Never steal a live or abandoned lock: a bounded, named refusal is
        // safer than two publishers believing they own the same CAS window.
        if (Date.now() >= deadline) throw new Error('MHP_STATE_LOCK_TIMEOUT', { cause: error })
        await delay(RUNTIME_STATE.lockRetryMs)
      }
    }
  }

  private async publish(
    kind: StoreKind,
    scope: Scope,
    key: string,
    value: JsonValue,
    activityAt?: number,
  ): Promise<void> {
    const file = this.file(kind, scope, key)
    await mkdir(path.dirname(file), { recursive: true, mode: RUNTIME_STATE.directoryMode })
    for (let attempt = 0; attempt < RUNTIME_STATE.casAttempts; attempt++) {
      const observed = await this.readRecord(kind, scope, key)
      const expected = observed?.revision ?? 0
      const unlock = await this.lock(file)
      const temporary = `${file}.${randomUUID()}.tmp`
      try {
        const current = await this.readRecord(kind, scope, key)
        // The comparison and atomic rename are inside the same cross-process
        // exclusive lock. Stale snapshots are refused and reread on retry.
        if ((current?.revision ?? 0) !== expected) continue
        const previousActivity = activitySchema.safeParse(current?.value)
        const newestAt =
          current?.activityAt ?? (previousActivity.success ? previousActivity.data.at : 0)
        if (activityAt !== undefined && activityAt < newestAt) return
        const record = recordSchema.parse({
          version: RUNTIME_STATE.version,
          key,
          value,
          revision: expected + 1,
          ...(activityAt !== undefined && { activityAt }),
        })
        const text = JSON.stringify(record)
        if (Buffer.byteLength(text) > RUNTIME_STATE.maximumRecordBytes)
          throw new Error('MHP_STATE_TOO_LARGE')
        const handle = await open(temporary, 'wx', RUNTIME_STATE.fileMode)
        try {
          await handle.writeFile(text, 'utf8')
          await handle.sync()
        } finally {
          await handle.close()
        }
        await rename(temporary, file)
        return
      } finally {
        try {
          await rm(temporary, { force: true })
        } finally {
          await unlock()
        }
      }
    }
    throw new Error('MHP_STATE_VERSION_CONFLICT')
  }

  private async write(kind: StoreKind, scope: Scope, key: string, value: JsonValue): Promise<void> {
    const file = this.file(kind, scope, key)
    checkValue(key, value)
    if (Buffer.byteLength(JSON.stringify(value)) > RUNTIME_STATE.maximumRecordBytes)
      throw new Error('MHP_STATE_TOO_LARGE')
    const activity = activitySchema.safeParse(value)
    let activityAt: number | undefined
    if (kind === 'storage' && key === 'lastSession')
      activityAt = activity.success ? activity.data.at : Date.now()
    const previous = publications.get(file)
    const writing = (async () => {
      try {
        await previous
      } catch {
        /* A failed earlier update does not veto a new explicit update. */
      }
      await this.publish(kind, scope, key, value, activityAt)
    })()
    publications.set(file, writing)
    this.writers.add(writing)
    try {
      await writing
    } finally {
      this.writers.delete(writing)
      if (publications.get(file) === writing) publications.delete(file)
    }
  }

  /** The owning controller drains admitted atomic writes before its store is released. */
  public async settled(): Promise<void> {
    const failures: unknown[] = []
    while (this.writers.size > 0) {
      const writes = await Promise.allSettled(this.writers)
      for (const write of writes) if (write.status === 'rejected') failures.push(write.reason)
    }
    if (failures.length > 0) throw new AggregateError(failures, 'MHP_STATE_WRITE_FAILED')
  }

  /** CLI choices remain effective until an explicit workspace/user setting replaces them. */
  public async settingNames(): Promise<readonly string[]> {
    const keys = Object.keys(SETTING_DEFAULTS).map((key) => `${SETTINGS_SECTION}.${key}`)
    const present = await Promise.all(
      keys.map(async (key) => ((await this.hasSetting(key)) ? key : undefined)),
    )
    return present.filter((key) => key !== undefined)
  }

  public async hasSetting(key: string): Promise<boolean> {
    settingKeySchema.parse(key)
    if (settingSchema(key.slice(SETTINGS_SECTION.length + 1)) === undefined)
      throw new Error('MHP_STATE_UNKNOWN_SETTING')
    return (
      (await this.read('settings', 'workspace', key)) !== undefined ||
      (await this.read('settings', 'user', key)) !== undefined
    )
  }

  public async getSetting(key: string): Promise<JsonValue> {
    settingKeySchema.parse(key)
    const name = key.slice(SETTINGS_SECTION.length + 1)
    const schema = settingSchema(name)
    if (schema === undefined) throw new Error('MHP_STATE_UNKNOWN_SETTING')
    const fallback = Object.entries(SETTING_DEFAULTS).find(([entry]) => entry === name)?.[1]
    const workspace = await this.read('settings', 'workspace', key)
    const user = workspace === undefined ? await this.read('settings', 'user', key) : undefined
    let value = workspace
    if (value === undefined) value = user
    if (value === undefined) value = jsonValueSchema.parse(fallback)
    return jsonValueSchema.parse(schema.parse(value))
  }

  public async updateSetting(key: string, value: JsonValue, scope: Scope): Promise<void> {
    settingKeySchema.parse(key)
    const schema = settingSchema(key.slice(SETTINGS_SECTION.length + 1))
    if (schema === undefined) throw new Error('MHP_STATE_UNKNOWN_SETTING')
    const parsed = jsonValueSchema.parse(schema.parse(value))
    await this.write('settings', scope, key, parsed)
    const listeners = observers.get(this.file('settings', scope, key)) ?? []
    for (const listener of listeners) listener(key)
  }

  public async getStorage(key: string, scope: Scope): Promise<JsonValue> {
    return (await this.read('storage', scope, key)) ?? null
  }

  public async setStorage(key: string, value: JsonValue, scope: Scope): Promise<void> {
    await this.write('storage', scope, key, jsonValueSchema.parse(value))
  }

  public onSettingsChanged(listener: (keys: readonly string[]) => void): () => void {
    const notify = (key: string) => {
      listener([key])
    }
    const files = Object.keys(SETTING_DEFAULTS).flatMap((name) =>
      (['user', 'workspace'] as const).map((scope) =>
        this.file('settings', scope, `${SETTINGS_SECTION}.${name}`),
      ),
    )
    for (const file of files) {
      let listeners = observers.get(file)
      if (listeners === undefined) {
        listeners = new Set()
        observers.set(file, listeners)
      }
      listeners.add(notify)
    }
    return () => {
      for (const file of files) {
        const listeners = observers.get(file)
        listeners?.delete(notify)
        if (listeners?.size === 0) observers.delete(file)
      }
    }
  }
}
