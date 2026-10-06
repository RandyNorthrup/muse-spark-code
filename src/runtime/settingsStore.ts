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
import { workspaceKey } from './dataFolder'

const recordSchema = z.strictObject({
  version: z.literal(RUNTIME_STATE.version),
  key: z.string().check(z.maxLength(RUNTIME_STATE.maximumKeyChars)),
  value: jsonValueSchema,
})
type JsonValue = z.infer<typeof jsonValueSchema>
type Scope = 'user' | 'workspace'
type StoreKind = 'settings' | 'storage'
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
  private readonly writers = new Map<string, Promise<void>>()
  private readonly listeners = new Set<(keys: readonly string[]) => void>()

  public constructor(
    private readonly root: string,
    private readonly workspaceRoot: string,
  ) {}

  private file(kind: StoreKind, scope: Scope, key: string): string {
    recordSchema.shape.key.parse(key)
    const name = createHash('sha256').update(key).digest('hex')
    const namespace = scope === 'user' ? 'global' : workspaceKey(this.workspaceRoot)
    return path.join(this.root, RUNTIME_STATE.folder, kind, namespace, `${name}.json`)
  }

  private async read(kind: StoreKind, scope: Scope, key: string): Promise<JsonValue | undefined> {
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
      const record = recordSchema.parse(raw)
      if (record.key !== key) throw new Error('MHP_STATE_INVALID_RECORD')
      checkValue(key, record.value)
      return record.value
    } finally {
      await handle.close()
    }
  }

  private async write(kind: StoreKind, scope: Scope, key: string, value: JsonValue): Promise<void> {
    const file = this.file(kind, scope, key)
    checkValue(key, value)
    const record = recordSchema.parse({ version: RUNTIME_STATE.version, key, value })
    const text = JSON.stringify(record)
    if (Buffer.byteLength(text) > RUNTIME_STATE.maximumRecordBytes)
      throw new Error('MHP_STATE_TOO_LARGE')
    const previous = this.writers.get(file)
    const writing = (async () => {
      // A failed earlier write does not prevent a later explicitly requested update.
      try {
        await previous
      } catch {
        // Failure belongs to the earlier update; this explicit update still runs.
      }
      await mkdir(path.dirname(file), { recursive: true, mode: RUNTIME_STATE.directoryMode })
      const temporary = `${file}.${randomUUID()}.tmp`
      try {
        const handle = await open(temporary, 'wx', RUNTIME_STATE.fileMode)
        try {
          await handle.writeFile(text, 'utf8')
          await handle.sync()
        } finally {
          await handle.close()
        }
        await rename(temporary, file)
      } finally {
        await rm(temporary, { force: true })
      }
    })()
    this.writers.set(file, writing)
    try {
      await writing
    } finally {
      if (this.writers.get(file) === writing) this.writers.delete(file)
    }
  }

  /** The owning controller drains admitted atomic writes before its store is released. */
  public async settled(): Promise<void> {
    const failures: unknown[] = []
    while (this.writers.size > 0) {
      const writes = await Promise.allSettled(this.writers.values())
      for (const write of writes) if (write.status === 'rejected') failures.push(write.reason)
    }
    if (failures.length > 0) throw new AggregateError(failures, 'MHP_STATE_WRITE_FAILED')
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
    for (const listener of this.listeners) listener([key])
  }

  public async getStorage(key: string, scope: Scope): Promise<JsonValue> {
    return (await this.read('storage', scope, key)) ?? null
  }

  public async setStorage(key: string, value: JsonValue, scope: Scope): Promise<void> {
    await this.write('storage', scope, key, jsonValueSchema.parse(value))
  }

  public onSettingsChanged(listener: (keys: readonly string[]) => void): () => void {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }
}
