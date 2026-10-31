// M108 X developer options over real modules: the production services own
// the files, the confirmations and the profile resources; time and answers
// are the test's (a fixed clock and the user's own replies), nothing else.
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { DeveloperOptions, DeveloperOptionsError } from '../../src/core/developer/developerOptions'
import { developerConfirmation } from '../../src/core/developer/surfaces'
import { AccountStore } from '../../src/core/providers/accounts'
import {
  checkDeveloperAccount,
  createRuntimeAccountServices,
} from '../../src/runtime/providers/runtimeServices'
import { fileAccountsMetadata } from '../../src/runtime/providers/providersFileStore'
import { runTerminalDeveloperCommand } from '../../src/runtime/providers/accountsEntry'
import { parseDeveloperCommand } from '../../src/runtime/developer/developerCommand'
import { collectingLogger } from './helpers/collectingLogger'
import { DeveloperLocalFiles } from '../../src/runtime/developer/localFiles'
import type { SecretStore } from '../../src/host/auth/credentialStore'
import {
  DEVELOPER_CLICK_WINDOW_MS,
  DEVELOPER_FILES,
  DEVELOPER_UNLOCK_MS,
  DEVELOPER_VERSION_CLICKS,
  UI_TEXT,
} from '../../src/shared/constants'

const NOW = 1_790_000_000_000
const folders: string[] = []
afterEach(() => {
  for (const folder of folders.splice(0)) rmSync(folder, { recursive: true, force: true })
})

function scratch(): string {
  mkdirSync('temp', { recursive: true })
  const folder = mkdtempSync(path.join('temp', 'developer-options-'))
  folders.push(folder)
  return folder
}

function mapSecrets(): SecretStore {
  const kept = new Map<string, string>()
  return {
    get: (key: string) => Promise.resolve(kept.get(key)),
    store: (key: string, value: string) => {
      kept.set(key, value)
      return Promise.resolve()
    },
    delete: (key: string) => {
      kept.delete(key)
      return Promise.resolve()
    },
  }
}

interface Harness {
  readonly folder: string
  readonly owner: DeveloperOptions
  readonly answers: string[]
  readonly printed: string[]
  readonly clock: { value: number }
}

async function setup(): Promise<Harness> {
  const folder = scratch()
  const answers: string[] = []
  const printed: string[] = []
  const clock = { value: NOW }
  const services = createRuntimeAccountServices({
    dataDir: folder,
    secrets: mapSecrets(),
    now: () => clock.value,
    log: collectingLogger([]),
  })
  const owner = await services.developer({
    readLine: (prompt: string) => {
      printed.push(prompt)
      return Promise.resolve(answers.shift() ?? 'no')
    },
    print: (line: string) => {
      printed.push(line)
    },
  })
  return { folder, owner, answers, printed, clock }
}

function accept(question: 'unlock' | 'multiple' | 'reset' | 'resetForeign'): string {
  return developerConfirmation(question).accept
}

async function failureOf(work: Promise<unknown>): Promise<unknown> {
  try {
    await work
  } catch (error: unknown) {
    return error
  }
  throw new Error('the refused call unexpectedly succeeded')
}

function auditOf(folder: string): { action: string; source: string }[] {
  const file = path.join(folder, 'developer', DEVELOPER_FILES.audit)
  const text = existsSync(file) ? readFileSync(file, 'utf8').trim() : ''
  return text === ''
    ? []
    : text
        .split('\n')
        .map(
          (row) => JSON.parse(row) as { action: string; source: string; v: number; time: number },
        )
        .map((row) => ({ action: row.action, source: row.source }))
}

function slotsOf(folder: string): Record<string, string> {
  const file = path.join(folder, 'developer', DEVELOPER_FILES.slots)
  return existsSync(file)
    ? (JSON.parse(readFileSync(file, 'utf8')) as { slots: Record<string, string> }).slots
    : {}
}

describe('M108 X developer options', () => {
  it('unlocks after seven version clicks on one surface', async () => {
    expect(DEVELOPER_VERSION_CLICKS).toBe(7)
    const harness = await setup()
    for (let click = 1; click < DEVELOPER_VERSION_CLICKS; click += 1) {
      const snapshot = await harness.owner.versionClick('help')
      expect(snapshot.isUnlocked).toBe(false)
    }
    harness.answers.push(accept('unlock'))
    const unlocked = await harness.owner.versionClick('help')
    expect(unlocked.isUnlocked).toBe(true)
    expect(unlocked.expiresAt).toBe(NOW + DEVELOPER_UNLOCK_MS)
    expect(auditOf(harness.folder)).toContainEqual({ action: 'unlock', source: 'version' })
  })

  it('keeps surfaces apart and lets a stale click window lapse', async () => {
    const harness = await setup()
    for (let click = 1; click < DEVELOPER_VERSION_CLICKS; click += 1) {
      await harness.owner.versionClick('help')
    }
    // Six on Help plus one on What's New is not seven anywhere.
    const split = await harness.owner.versionClick('whatsnew')
    expect(split.isUnlocked).toBe(false)
    harness.clock.value += DEVELOPER_CLICK_WINDOW_MS + 1
    // The window lapsed, so the count restarts: one more click stays locked.
    const lapsed = await harness.owner.versionClick('help')
    expect(lapsed.isUnlocked).toBe(false)
    expect(auditOf(harness.folder)).toEqual([])
  })

  it('leaves a denied unlock locked with no grant written', async () => {
    const harness = await setup()
    for (let click = 1; click < DEVELOPER_VERSION_CLICKS; click += 1) {
      await harness.owner.versionClick('help')
    }
    harness.answers.push('no')
    const snapshot = await harness.owner.versionClick('help')
    expect(snapshot.isUnlocked).toBe(false)
    expect(snapshot.expiresAt).toBeNull()
    expect(auditOf(harness.folder)).toEqual([])
  })

  it('expires the grant with an audit row', async () => {
    const harness = await setup()
    harness.answers.push(accept('unlock'))
    await harness.owner.unlock('terminal')
    expect(harness.owner.snapshot().isUnlocked).toBe(true)
    harness.clock.value = NOW + DEVELOPER_UNLOCK_MS + 1
    const expired = await harness.owner.refresh()
    expect(expired.isUnlocked).toBe(false)
    expect(expired.expiresAt).toBeNull()
    expect(auditOf(harness.folder)).toContainEqual({ action: 'expire', source: 'lifecycle' })
  })

  it('keeps a failed profile start visible and removable, folders and slots honest', async () => {
    const harness = await setup()
    harness.answers.push(accept('unlock'), accept('multiple'))
    await harness.owner.unlock('terminal')
    await harness.owner.setMultiple(true, 'terminal')
    // The child launch refuses until its bindings land; the profile stays
    // recorded, its folder on disk, its slot released by the rollback.
    const failure = await failureOf(harness.owner.addProfile('meta', 'default', 'terminal'))
    expect(failure).toBeInstanceOf(Error)
    expect((failure as Error).message).toBe(UI_TEXT.developer.unavailable)
    const recorded = harness.owner.snapshot()
    expect(recorded.profiles).toHaveLength(1)
    const profile = recorded.profiles[0]
    if (profile === undefined) throw new Error('no profile was recorded')
    expect(existsSync(path.join(harness.folder, 'developer', 'profiles', profile.id))).toBe(true)
    expect(slotsOf(harness.folder)).toEqual({})
    const actions = auditOf(harness.folder).map((row) => row.action)
    expect(actions).toContain('create')
    // Removal completes: the folder goes, the record goes, the audit stays.
    await harness.owner.removeProfile(profile.id, 'terminal')
    expect(harness.owner.snapshot().profiles).toEqual([])
    expect(existsSync(path.join(harness.folder, 'developer', 'profiles', profile.id))).toBe(false)
    expect(auditOf(harness.folder)).toContainEqual({ action: 'remove', source: 'terminal' })
  })

  it('resets everything after confirmation and keeps the unlock when denied', async () => {
    const harness = await setup()
    harness.answers.push(accept('unlock'), accept('multiple'))
    await harness.owner.unlock('terminal')
    await harness.owner.setMultiple(true, 'terminal')
    await failureOf(harness.owner.addProfile('meta', 'default', 'terminal'))
    harness.answers.push('no')
    const denied = await harness.owner.reset('terminal')
    expect(denied.isUnlocked).toBe(true)
    expect(denied.isMultipleAccountsOn).toBe(false)
    expect(denied.profiles).toHaveLength(1)
    harness.answers.push(accept('reset'))
    const cleared = await harness.owner.reset('terminal')
    expect(cleared.isUnlocked).toBe(false)
    expect(cleared.profiles).toEqual([])
    expect(auditOf(harness.folder)).toContainEqual({ action: 'reset', source: 'terminal' })
  })

  it('refuses an unknown account for a profile before recording anything', async () => {
    const harness = await setup()
    harness.answers.push(accept('unlock'), accept('multiple'))
    await harness.owner.unlock('terminal')
    await harness.owner.setMultiple(true, 'terminal')
    const failure = await failureOf(harness.owner.addProfile('meta', 'nobody', 'terminal'))
    expect((failure as Error).message).toBe(UI_TEXT.developer.invalidRequest)
    expect(harness.owner.snapshot().profiles).toEqual([])
    expect(auditOf(harness.folder).some((row) => row.action === 'create')).toBe(false)
  })

  it('refuses unreadable or future-dated state in fixed words', async () => {
    const folder = scratch()
    const files = new DeveloperLocalFiles(`${folder}/developer`)
    const metadata = fileAccountsMetadata(folder)
    const store = new AccountStore(metadata, {
      read: () => Promise.reject(new Error('vault must stay shut')),
      readForRemoval: () => Promise.reject(new Error('vault must stay shut')),
      write: () => Promise.reject(new Error('vault must stay shut')),
      remove: () => Promise.reject(new Error('vault must stay shut')),
    })
    const deps = {
      machineId: 'machine-a',
      now: () => NOW,
      newProfileId: () => 'p1',
      store: files,
      resources: files.resources(),
      checkAccount: (provider: string, account: string) =>
        checkDeveloperAccount(metadata, store, provider, account),
      confirm: () => Promise.resolve(true),
      changed: () => undefined,
    }
    const broken = new DeveloperLocalFiles(`${folder}/broken`)
    const brokenDeps = { ...deps, store: broken, resources: broken.resources() }
    // Written through the real store path so the envelope is genuine.
    await broken.commit(
      {
        v: 1,
        machineId: 'machine-a',
        unlockedAt: null,
        expiresAt: null,
        isMultipleAccountsOn: false,
        profiles: [],
      },
      { v: 1, time: NOW, action: 'disable', source: 'lifecycle' },
    )
    writeFileSync(path.join(folder, 'broken', DEVELOPER_FILES.state), '{broken')
    const corrupt = await failureOf(DeveloperOptions.open(brokenDeps))
    expect(corrupt).toBeInstanceOf(Error)
    expect((corrupt as Error).message).toBe(UI_TEXT.developer.unavailable)
    await files.commit(
      {
        v: 1,
        machineId: 'machine-a',
        unlockedAt: NOW + 1,
        expiresAt: NOW + DEVELOPER_UNLOCK_MS,
        isMultipleAccountsOn: false,
        profiles: [],
      },
      { v: 1, time: NOW, action: 'unlock', source: 'terminal' },
    )
    const future = await failureOf(DeveloperOptions.open(deps))
    expect(future).toBeInstanceOf(DeveloperOptionsError)
    expect((future as DeveloperOptionsError).code).toBe('unavailable')
  })

  it('keeps state on its machine until a confirmed foreign reset', async () => {
    const folder = scratch()
    const files = new DeveloperLocalFiles(`${folder}/developer`)
    const metadata = fileAccountsMetadata(folder)
    const store = new AccountStore(metadata, {
      read: () => Promise.reject(new Error('vault must stay shut')),
      readForRemoval: () => Promise.reject(new Error('vault must stay shut')),
      write: () => Promise.reject(new Error('vault must stay shut')),
      remove: () => Promise.reject(new Error('vault must stay shut')),
    })
    const checkAccount = (provider: string, account: string): Promise<void> =>
      checkDeveloperAccount(metadata, store, provider, account)
    const base = {
      now: () => NOW,
      newProfileId: () => 'p1',
      store: files,
      resources: files.resources(),
      checkAccount,
      changed: () => undefined,
    }
    const home = await DeveloperOptions.open({
      ...base,
      machineId: 'machine-a',
      confirm: () => Promise.resolve(true),
    })
    await home.unlock('terminal')
    expect(home.snapshot().isUnlocked).toBe(true)
    const foreign = await failureOf(
      DeveloperOptions.open({
        ...base,
        machineId: 'machine-b',
        confirm: () => Promise.resolve(true),
      }),
    )
    expect(foreign).toBeInstanceOf(DeveloperOptionsError)
    expect((foreign as DeveloperOptionsError).code).toBe('differentMachine')
    // Denying the foreign reset changes nothing: the next open refuses too.
    const denied = await failureOf(
      DeveloperOptions.resetForeign(
        { ...base, machineId: 'machine-b', confirm: () => Promise.resolve(false) },
        'terminal',
      ),
    )
    expect(denied).toBeInstanceOf(DeveloperOptionsError)
    expect((denied as DeveloperOptionsError).code).toBe('differentMachine')
    const stillForeign = await failureOf(
      DeveloperOptions.open({
        ...base,
        machineId: 'machine-b',
        confirm: () => Promise.resolve(true),
      }),
    )
    expect(stillForeign).toBeInstanceOf(DeveloperOptionsError)
    expect((stillForeign as DeveloperOptionsError).code).toBe('differentMachine')
    const cleared = await DeveloperOptions.resetForeign(
      { ...base, machineId: 'machine-b', confirm: () => Promise.resolve(true) },
      'terminal',
    )
    expect(cleared.isUnlocked).toBe(false)
    expect(cleared.profiles).toEqual([])
    expect(auditOf(folder)).toContainEqual({ action: 'resetForeign', source: 'terminal' })
  })
})

describe('M108 X developer terminal command', () => {
  it('parses the strict table and refuses misuse as usage', () => {
    expect(parseDeveloperCommand(['developer'])).toEqual({ type: 'developer/unlock' })
    expect(parseDeveloperCommand(['developer', 'status'])).toEqual({ type: 'developer/read' })
    expect(parseDeveloperCommand(['developer', 'enable'])).toEqual({
      type: 'developer/setMultiple',
      enabled: true,
    })
    expect(parseDeveloperCommand(['developer', 'add', 'meta', 'work'])).toEqual({
      type: 'developer/addProfile',
      provider: 'meta',
      account: 'work',
    })
    expect(parseDeveloperCommand(['other'])).toBeUndefined()
    for (const args of [
      ['developer', 'bogus'],
      ['developer', 'add', 'meta'],
      ['developer', 'add', 'META!', 'work'],
      ['developer', 'remove', '../x'],
      ['developer', 'status', 'extra'],
    ]) {
      let failure: unknown
      try {
        parseDeveloperCommand(args)
      } catch (error: unknown) {
        failure = error
      }
      expect(failure).toBeInstanceOf(SyntaxError)
      expect((failure as SyntaxError).message).toBe(UI_TEXT.developer.commandUsage)
    }
  })

  it('answers help and misuse before any state work', async () => {
    const folder = scratch()
    const input = { dataDir: folder, secrets: mapSecrets(), log: collectingLogger([]) }
    const owner = {
      readLine: () => Promise.resolve('no'),
      print: () => undefined,
    }
    const help = await runTerminalDeveloperCommand(
      UI_TEXT,
      'en',
      input,
      owner,
      ['developer', '--help'],
      'test',
    )
    expect(help.exitCode).toBe(0)
    expect(help.text).toContain(UI_TEXT.developer.commandUsage)
    const misuse = await runTerminalDeveloperCommand(
      UI_TEXT,
      'en',
      input,
      owner,
      ['developer', 'add', 'META!', 'work'],
      'test',
    )
    expect(misuse.exitCode).toBe(2)
    expect(misuse.text).toBe(UI_TEXT.developer.commandUsage)
    // Nothing was stored: no machine id, no developer dir.
    expect(existsSync(path.join(folder, 'machine-id'))).toBe(false)
    expect(existsSync(path.join(folder, 'developer'))).toBe(false)
  })

  it('unlocks through the terminal with the real confirmation', async () => {
    const folder = scratch()
    const answers = [accept('unlock')]
    const owner = {
      readLine: () => Promise.resolve(answers.shift() ?? 'no'),
      print: () => undefined,
    }
    const first = await runTerminalDeveloperCommand(
      UI_TEXT,
      'en',
      { dataDir: folder, secrets: mapSecrets(), log: collectingLogger([]) },
      owner,
      ['developer'],
      'test',
    )
    expect(first.exitCode).toBe(0)
    const status = await runTerminalDeveloperCommand(
      UI_TEXT,
      'en',
      { dataDir: folder, secrets: mapSecrets(), log: collectingLogger([]) },
      owner,
      ['developer', 'status'],
      'test',
    )
    expect(status.exitCode).toBe(0)
    // The machine id and the unlock persisted across commands.
    expect(existsSync(path.join(folder, 'machine-id'))).toBe(true)
    expect(auditOf(folder)).toContainEqual({ action: 'unlock', source: 'terminal' })
  })
})
