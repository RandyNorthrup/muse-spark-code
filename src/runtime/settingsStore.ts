// The runtime panel's settings and storage (M104 lane B, D84). An MHP host's
// `settings/*` and `storage/*` requests, and the panel's own conversations,
// read and write here. Nothing here is a second copy of a file the runtime
// already reads: a user setting lives where the runtime already looks for
// it, the agent data folder's `settings.json` (by its documented key) or,
// for the resource governor's settings, `resources.json`. A workspace's own
// settings and both storage scopes are JSON files of their own, the
// workspace's in its folder of the data folder (never in the repository).
//
// A write changes one key of one file: read, change, replace atomically,
// with one writer per file at a time, in this process (a queue) and across
// processes (the runtime's named lock, which the OS releases if a holder
// dies). So no key another writer set is lost, and keys this store does not
// know (a person's own lines in settings.json) are kept.
import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import * as z from 'zod/mini'
import { writeFileAtomically } from '../host/fsAtomic'
import { isStoreErrorCode } from '../host/backend/storeErrors'
import type { Logger } from '../host/logger'
import {
  isSettingName,
  parseSettingValue,
  readSettings,
  type ExtensionSettings,
  type SettingsSource,
} from '../host/settings'
import {
  MACHINE_SCOPED_SETTINGS,
  RUNTIME_PANEL_STATE,
  RUNTIME_RESOURCE_SETTINGS_FILE,
  RUNTIME_SETTINGS_FILE,
  SETTING_DEFAULTS,
  SETTINGS_SECTION,
} from '../shared/constants'
import { isCredentialVariable } from '../shared/credentialEnvironment'
import { jsonValueSchema, settingKeySchema } from '../shared/hostApi/data'
import { countSecretMatches } from '../shared/redact'
import { RESOURCE_SETTING_KEYS, resourceSettingsSchema } from '../shared/resources'
import { workspaceDataFolder } from './dataFolder'
import { personScope, withNamedLock } from './namedLock'

type JsonValue = z.infer<typeof jsonValueSchema>
export type StateScope = 'user' | 'workspace'

/**
Why a read or write was refused. The message is the MHP failure's stable
code; it never carries a value, a path or a key's text.
*/
export class RuntimeStateError extends Error {
  public constructor(
    public readonly kind:
      'unknownSetting' | 'invalidValue' | 'machineSetting' | 'credential' | 'damaged',
    options?: { readonly cause?: unknown },
  ) {
    super(
      `MHP_STATE_${kind.replaceAll(/[A-Z]/gu, (letter) => `_${letter}`).toUpperCase()}`,
      options,
    )
    this.name = 'RuntimeStateError'
  }
}

const tableSchema = z.record(z.string(), jsonValueSchema)
type Table = z.infer<typeof tableSchema>

const machineNames: ReadonlySet<string> = new Set(MACHINE_SCOPED_SETTINGS)
type ResourceField = keyof typeof RESOURCE_SETTING_KEYS
function isResourceField(field: string): field is ResourceField {
  return Object.hasOwn(RESOURCE_SETTING_KEYS, field)
}
const resourceFields = new Map<string, ResourceField>()
for (const [field, name] of Object.entries(RESOURCE_SETTING_KEYS))
  if (isResourceField(field)) resourceFields.set(name, field)

/**
A setting's key in the runtime's own settings files: its name, with a dotted
group folded into camel case. That is the documented `settings.json` key of
every setting the runtime already read there (`paidDailyBudgetUsd`,
`mediaConverterPath`, `reportsPlanMaxBytes` for `reports.planMaxBytes`).
*/
export function runtimeSettingFileKey(name: string): string {
  return name.replaceAll(/\.([a-z])/gu, (_dot, letter: string) => letter.toUpperCase())
}

/**
What one MHP key names: a setting of the settings table, or one of the
resource governor's machine settings, each validated by its own schema.
*/
type Named =
  | { readonly kind: 'setting'; readonly name: string }
  | { readonly kind: 'resource'; readonly name: string; readonly field: ResourceField }

function validValue(named: Named, value: unknown): JsonValue {
  if (named.kind === 'resource')
    return jsonValueSchema.parse(
      resourceSettingsSchema.parse({ [named.field]: value })[named.field],
    )
  if (!isSettingName(named.name)) throw new RuntimeStateError('unknownSetting')
  return jsonValueSchema.parse(parseSettingValue(named.name, value))
}

function defaultValue(named: Named): JsonValue {
  return named.kind === 'resource'
    ? jsonValueSchema.parse(resourceSettingsSchema.parse({})[named.field])
    : jsonValueSchema.parse(
        Object.entries(SETTING_DEFAULTS).find(([name]) => name === named.name)?.[1],
      )
}

/** `apiKey`, `access-token`, `client.secret`: a field name as an environment variable spells it. */
function asVariableName(name: string): string {
  return name.replaceAll(/([a-z\d])([A-Z])/gu, '$1_$2').replaceAll(/[-.\s]/gu, '_')
}

/**
Rule 8: no key or token is ever stored here. A field named like a credential,
an environment entry naming one, or text shaped like one refuses the value.
*/
function refuseCredentials(key: string, value: JsonValue): void {
  const inspect = (name: string, item: JsonValue): void => {
    if (isCredentialVariable(asVariableName(name))) throw new RuntimeStateError('credential')
    if (name === 'name' && typeof item === 'string' && isCredentialVariable(item))
      throw new RuntimeStateError('credential')
    if (typeof item === 'object' && item !== null)
      for (const [field, child] of Object.entries(item)) inspect(field, child)
  }
  inspect(key, value)
  if (countSecretMatches(JSON.stringify(value), []) > 0) throw new RuntimeStateError('credential')
}

/** A table file's keys and values: none when it is missing; a file that is not one JSON object refuses. */
async function readTable(file: string): Promise<Table> {
  let text: string
  try {
    text = await readFile(file, 'utf8')
  } catch (error: unknown) {
    // NARROW: a missing file is an empty table; any other failure is the caller's.
    if (isStoreErrorCode(error, 'ENOENT')) return {}
    throw error
  }
  try {
    return tableSchema.parse(JSON.parse(text))
  } catch (error: unknown) {
    // NARROW: malformed text or a file that is not one object is damaged;
    // anything else is not this file's answer to give.
    if (error instanceof SyntaxError || (error instanceof Error && error.name === '$ZodError'))
      throw new RuntimeStateError('damaged', { cause: error })
    throw error
  }
}

// One writer per file in this process; the named lock orders processes.
const writers = new Map<string, Promise<void>>()

/** The named lock of one file, on the person's scope: unrelated files never wait. */
function fileLock(file: string) {
  const id = createHash('sha256')
    .update(path.resolve(file))
    .digest('hex')
    .slice(0, RUNTIME_PANEL_STATE.lockIdChars)
  const scope = personScope()
  return {
    pipe: `${RUNTIME_PANEL_STATE.lockPipe}-${scope}-${id}`,
    folder: `${RUNTIME_PANEL_STATE.lockFolder}-${scope}`,
    file: `${id}.lock`,
  }
}

// Listeners by settings file, shared by every store in the process, so the
// ACP agent's and the panel's stores over one data folder hear each other.
const observers = new Map<string, Set<(keys: readonly string[]) => void>>()

export interface RuntimeSettingsStoreOptions {
  /** The agent data folder (`agentDataFolder`). */
  readonly dataFolder: string
  /** The workspace's canonical root. */
  readonly workspaceRoot: string
  readonly log: Logger
  readonly sleep: (ms: number) => Promise<void>
}

export class RuntimeSettingsStore {
  private readonly workspaceFolder: string

  public constructor(private readonly options: RuntimeSettingsStoreOptions) {
    this.workspaceFolder = workspaceDataFolder(options.dataFolder, options.workspaceRoot)
  }

  private get userSettingsFile(): string {
    return path.join(this.options.dataFolder, RUNTIME_SETTINGS_FILE)
  }

  private get resourceSettingsFile(): string {
    return path.join(this.options.dataFolder, RUNTIME_RESOURCE_SETTINGS_FILE)
  }

  private get workspaceSettingsFile(): string {
    return path.join(this.workspaceFolder, RUNTIME_PANEL_STATE.workspaceSettingsFile)
  }

  private storageFile(scope: StateScope): string {
    return path.join(
      scope === 'user' ? this.options.dataFolder : this.workspaceFolder,
      RUNTIME_PANEL_STATE.storageFile,
    )
  }

  /** Where a setting lives in `scope`, and its key there. */
  private slot(named: Named, scope: StateScope): { readonly file: string; readonly key: string } {
    if (named.kind === 'resource')
      return { file: this.resourceSettingsFile, key: `${SETTINGS_SECTION}.${named.name}` }
    return {
      file: scope === 'user' ? this.userSettingsFile : this.workspaceSettingsFile,
      key: runtimeSettingFileKey(named.name),
    }
  }

  /** Changes one key of a table file, one writer at a time; `undefined` removes it. */
  private async change(file: string, key: string, value: JsonValue | undefined): Promise<void> {
    const write = async (): Promise<void> => {
      const kept = Object.entries(await readTable(file)).filter(([name]) => name !== key)
      const table = Object.fromEntries(value === undefined ? kept : [...kept, [key, value]])
      await writeFileAtomically(file, `${JSON.stringify(table, null, 2)}\n`, {
        sleep: this.options.sleep,
        mode: RUNTIME_PANEL_STATE.fileMode,
      })
    }
    const previous = writers.get(file) ?? Promise.resolve()
    const next = (async () => {
      // Only the order matters here: an earlier writer's failure is its own caller's.
      await Promise.allSettled([previous])
      await withNamedLock(write, fileLock(file))
    })()
    writers.set(file, next)
    try {
      await next
    } finally {
      if (writers.get(file) === next) writers.delete(file)
    }
  }

  /** The setting an MHP key (`museSpark.<name>`) names; refuses one this product lacks. */
  private named(key: string): Named {
    const name = settingKeySchema.parse(key).slice(SETTINGS_SECTION.length + 1)
    const field = resourceFields.get(name)
    if (field !== undefined) return { kind: 'resource', name, field }
    if (!isSettingName(name)) throw new RuntimeStateError('unknownSetting')
    return { kind: 'setting', name }
  }

  /** The stored value of a setting: the workspace's unless machine-scoped, then the user's. */
  private async stored(named: Named): Promise<unknown> {
    if (!machineNames.has(named.name)) {
      const workspace = this.slot(named, 'workspace')
      const table = await readTable(workspace.file)
      const value = table[workspace.key]
      if (value !== undefined) return value
    }
    const user = this.slot(named, 'user')
    const table = await readTable(user.file)
    return table[user.key]
  }

  /** Every setting of the settings table, by `readSettings`' rule (absent or invalid: its default). */
  public async readAll(): Promise<ExtensionSettings> {
    const user = await readTable(this.userSettingsFile)
    const workspace = await readTable(this.workspaceSettingsFile)
    const source: SettingsSource = {
      get: (name) => {
        const key = runtimeSettingFileKey(name)
        return !machineNames.has(name) && workspace[key] !== undefined ? workspace[key] : user[key]
      },
    }
    return readSettings(source, this.options.log)
  }

  /**
  `settings/get`: the stored value as the person set it, or the default when
  none is stored or the stored one is not valid for the setting.
  */
  public async getSetting(key: string): Promise<JsonValue> {
    const named = this.named(key)
    const value = await this.stored(named)
    if (value === undefined) return defaultValue(named)
    try {
      validValue(named, value)
    } catch (error: unknown) {
      // NARROW: a stored value its setting refuses reads as the default, as VS Code's reader does.
      if (error instanceof Error && error.name === '$ZodError') return defaultValue(named)
      throw error
    }
    return jsonValueSchema.parse(value)
  }

  /**
  `settings/update`: validated by the setting's own schema. A machine-scoped
  setting (one that chooses what runs or what is billed, D15) is the
  person's alone and refuses the workspace scope, as VS Code's does.
  */
  public async updateSetting(key: string, value: JsonValue, scope: StateScope): Promise<void> {
    const named = this.named(key)
    if (scope === 'workspace' && machineNames.has(named.name))
      throw new RuntimeStateError('machineSetting')
    try {
      validValue(named, value)
    } catch (error: unknown) {
      // NARROW: a value its setting's schema refuses; anything else is not ours.
      if (error instanceof Error && error.name === '$ZodError')
        throw new RuntimeStateError('invalidValue', { cause: error })
      throw error
    }
    refuseCredentials(named.name, value)
    const slot = this.slot(named, scope)
    await this.change(slot.file, slot.key, value)
    const listeners = observers.get(slot.file) ?? []
    for (const listener of listeners) listener([key])
  }

  /** `storage/*.get`: null when nothing is stored under the key. */
  public async getStorage(key: string, scope: StateScope): Promise<JsonValue> {
    const table = await readTable(this.storageFile(scope))
    return table[key] ?? null
  }

  /** `storage/*.set`: null removes the key. */
  public async setStorage(key: string, value: JsonValue, scope: StateScope): Promise<void> {
    const parsed = jsonValueSchema.parse(value)
    refuseCredentials(key, parsed)
    await this.change(this.storageFile(scope), key, parsed ?? undefined)
  }

  /**
  Hears a setting this process's stores update in the user's files or this
  workspace's: the MHP key of each. A person's own edit of a file is read
  at the next read; an MHP host announces its own with `settings/didChange`.
  */
  public onSettingsChanged(listener: (keys: readonly string[]) => void): () => void {
    const files = [this.userSettingsFile, this.resourceSettingsFile, this.workspaceSettingsFile]
    for (const file of files) {
      const listeners = observers.get(file) ?? new Set()
      listeners.add(listener)
      observers.set(file, listeners)
    }
    return () => {
      for (const file of files) {
        const listeners = observers.get(file)
        listeners?.delete(listener)
        if (listeners?.size === 0) observers.delete(file)
      }
    }
  }
}
