import { appendFile, mkdir, mkdtemp, readdir } from 'node:fs/promises'
import path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { acpResourceCommand } from '../../src/acp/resources'
import { RESOURCE_JOURNAL_ROOT, ResourceJournal } from '../../src/core/usage/resourceJournal'
import { resourceHistoryText } from '../../src/core/usage/resourceText'
import { NodeUsageFs } from '../../src/runtime/usage/nodeUsageFs'
import { resourceRecordSchema } from '../../src/shared/resources'
import { usageDeleteDetail } from '../../src/shared/usageDeleteText'
import { USAGE_EN } from '../../src/shared/l10n/usageEn'
import { createResources, type ResourceEntryOptions } from '../../src/runtime/resources/entry'
import type { RuntimeResources } from '../../src/runtime/resources/port'
import { createUsageAccess } from '../../src/runtime/usage/usageServiceEntry'
import { RESOURCE_HISTORY_MAX_MINUTES, UI_TEXT } from '../../src/shared/constants'
import { EN } from '../../src/shared/l10n/en'
import { formatPercent, plural } from '../../src/shared/l10n/text'
import { resourceHistorySchema } from '../../src/shared/resourceHistory'
import { usagePageStateSchema } from '../../src/shared/usagePage'
import { FakeLogOutputChannel } from './helpers/fakes'
import { FakeResourceMachine } from './helpers/resources/runtime'
import { removeFolder } from './helpers/temporaryFolders'

const folders: string[] = []
const hosts: RuntimeResources[] = []
afterEach(async () => {
  for (const host of hosts.splice(0)) host.dispose()
  for (const folder of folders.splice(0)) await removeFolder(folder)
})
async function dataFolder(): Promise<string> {
  await mkdir('temp', { recursive: true })
  const folder = await mkdtemp(path.resolve('temp/m107-history-'))
  folders.push(folder)
  return folder
}
async function resources(
  machineDir: string,
  extra: Partial<ResourceEntryOptions> = {},
): Promise<RuntimeResources> {
  const host = await createResources(
    {
      machineDir,
      sleep: () => Promise.resolve(),
      onError: vi.fn(),
      machine: new FakeResourceMachine(),
      ...extra,
    },
    EN,
    'en',
  )
  hosts.push(host)
  return host
}
function usage(dataFolderPath: string) {
  return createUsageAccess({
    dataFolder: dataFolderPath,
    packageRoot: process.cwd(),
    host: 'ACP',
    locale: 'en',
    uiText: EN,
    log: new FakeLogOutputChannel(),
  })
}
const DAY_NAME = /^\d{4}-\d{2}-\d{2}$/u
const QUERY = { range: 'today', groupBy: 'provider', metric: 'cost' } as const

describe('M107 J/M102 production history binding', () => {
  it('records the agent governor and serves the same journal to every history surface', async () => {
    const folder = await dataFolder()
    // The long-lived ACP agent records; its one real machine sample opens a minute.
    const agent = await resources(folder, { isRecordingHistory: () => true })
    const status = await agent.status()
    agent.dispose()
    // A one-shot `resources history` process reads the journal it never wrote.
    const cli = await resources(folder)
    const history = await vi.waitFor(async () => {
      const read = await cli.history()
      expect(read.minutes).toHaveLength(1)
      return read
    })
    expect(history.minutes[0]?.atMs).toBe(status.sample?.atMs)
    const memory = status.sample?.memoryUsedPercent
    const text = await cli.command('history', false)
    expect(text).toContain(UI_TEXT.resourceHistoryObserved)
    expect(text).toContain(
      `${UI_TEXT.resourceMemory}: ${memory == null ? UI_TEXT.resourceUnknown : formatPercent(memory)} / `,
    )
    expect(text).not.toContain(UI_TEXT.resourceHistoryEmpty)
    expect(resourceHistorySchema.parse(JSON.parse(await cli.command('history', true)))).toEqual(
      history,
    )
    // ACP `/usage resources` and the terminal give the same text.
    const update = await acpResourceCommand([{ type: 'text', text: '/usage resources' }], cli)
    expect(update).toMatchObject({ content: { type: 'text', text } })
    // The usage page state for every editor carries the same validated aggregate.
    const state = await usage(folder).read(QUERY)
    expect(state.resources).toEqual(history)
    // The journal holds no process identity, command, path or environment.
    const day = await readdir(path.join(folder, ...RESOURCE_JOURNAL_ROOT.split('/')))
    expect(day.filter((name) => DAY_NAME.test(name))).toHaveLength(1)
  })

  it('refuses an unreadable journal on every surface instead of showing empty history', async () => {
    const folder = await dataFolder()
    const agent = await resources(folder, { isRecordingHistory: () => true })
    await agent.status()
    agent.dispose()
    const cli = await resources(folder)
    await vi.waitFor(async () => {
      const read = await cli.history()
      expect(read.minutes).toHaveLength(1)
    })
    const root = path.join(folder, ...RESOURCE_JOURNAL_ROOT.split('/'))
    // The live minute can be read before the disposal flush writes the day file,
    // and the root also holds the write lock's files: wait for the UTC day folder.
    let dayPath = ''
    await vi.waitFor(
      async () => {
        const names = await readdir(root)
        const day = names.find((name) => DAY_NAME.test(name))
        expect(day).toBeDefined()
        dayPath = path.join(root, day ?? '')
      },
      { timeout: 3000 },
    )
    const [file] = await readdir(dayPath)
    await appendFile(path.join(dayPath, file ?? ''), 'garbage\n')
    await expect(cli.history()).rejects.toThrow()
    await expect(cli.command('history', false)).rejects.toThrow()
    await expect(
      acpResourceCommand([{ type: 'text', text: '/usage resources' }], cli),
    ).rejects.toThrow()
    const state = await usage(folder).read(QUERY)
    expect(state.resources).toBeNull()
  })

  it('does not record from one-shot commands and keeps an empty journal explicit', async () => {
    const folder = await dataFolder()
    const cli = await resources(folder)
    await cli.status()
    cli.dispose()
    const reader = await resources(folder)
    const history = await reader.history()
    expect(history).toEqual({ minutes: [], events: [], counts: [], work: [] })
    expect(await reader.command('history', false)).toContain(UI_TEXT.resourceHistoryEmpty)
    await expect(readdir(path.join(folder, 'usage'))).rejects.toThrow()
  })

  it('validates the usage state resources field strictly', async () => {
    const folder = await dataFolder()
    const state = await usage(folder).read(QUERY)
    expect(state.resources).toEqual({ minutes: [], events: [], counts: [], work: [] })
    expect(usagePageStateSchema.safeParse({ ...state, resources: null }).success).toBe(true)
    const { resources: _absent, ...withoutResources } = state
    expect(usagePageStateSchema.safeParse(withoutResources).success).toBe(true)
    for (const resourcesField of [
      { ...state.resources, pid: 1 },
      { minutes: [], events: [], counts: [] },
      {
        ...state.resources,
        events: [{ type: 'override', atMs: 0, untilMs: 1, command: 'canary' }],
      },
      {
        ...state.resources,
        minutes: Array.from({ length: RESOURCE_HISTORY_MAX_MINUTES + 1 }, (_, index) => ({
          type: 'resource',
          atMs: index * 60_000,
          event: null,
          work: [],
          minute: {
            cpuPercent: 1,
            memoryUsedPercent: 1,
            availableMemory: 'ample',
            gpuPercent: null,
            diskBusyPercent: null,
            level: 'normal',
            thresholds: { cpuMaxPercent: 85, memoryMaxPercent: 90, memoryMinFreeGiB: 2 },
          },
        })),
      },
      'unavailable',
    ])
      expect(usagePageStateSchema.safeParse({ ...state, resources: resourcesField }).success).toBe(
        false,
      )
  })
})

function reading(atMs: number, cpuPercent: number) {
  return resourceRecordSchema.parse({
    type: 'resource',
    atMs,
    event: null,
    minute: {
      cpuPercent,
      memoryUsedPercent: 50,
      availableMemory: 'ample',
      gpuPercent: null,
      diskBusyPercent: null,
      level: 'normal',
      thresholds: { cpuMaxPercent: 85, memoryMaxPercent: 90, memoryMinFreeGiB: 2 },
    },
    work: [],
  })
}

describe('M107 W-history closure: delete count, current minute and daily rows', () => {
  it('names every resource entry in the Delete history prompt and removes them with it', async () => {
    const folder = await dataFolder()
    const writer = new ResourceJournal(new NodeUsageFs(folder), {
      writerId: 'window',
      now: Date.now,
      isEnabled: () => true,
    })
    await writer.append(reading(Date.now() - 120_000, 10))
    await writer.writeLive(reading(Date.now(), 20))
    const confirmDelete = vi.fn((_records: number, _resources: number) => Promise.resolve(true))
    const posted: unknown[] = []
    const connection = usage(folder).connect({
      post: (message) => {
        posted.push(message)
      },
      confirmDelete,
    })
    await connection.receive({ type: 'usage/deleteHistory', requestId: 'delete' })
    expect(confirmDelete).toHaveBeenCalledExactlyOnceWith(0, 2)
    expect(usageDeleteDetail(0, 2)).toBe(
      `${plural(USAGE_EN.deleteConfirm, 0)} ${plural(USAGE_EN.deleteConfirmResources, 2)}`,
    )
    expect(posted).toContainEqual(expect.objectContaining({ outcome: 'completed' }))
    await expect(readdir(path.join(folder, ...RESOURCE_JOURNAL_ROOT.split('/')))).rejects.toThrow()
    const reader = await resources(folder)
    const cleared = await reader.history()
    expect(cleared).toEqual({ minutes: [], events: [], counts: [], work: [] })
  })

  it('shows a running agent’s open minute to a separate reader, labelled as this minute so far', async () => {
    const folder = await dataFolder()
    const agent = await resources(folder, { isRecordingHistory: () => true })
    const status = await agent.status()
    // The agent keeps running: its open minute is only in its live file.
    const cli = await resources(folder)
    const history = await vi.waitFor(async () => {
      const read = await cli.history()
      expect(read.minutes).toHaveLength(1)
      return read
    })
    const atMs = status.sample?.atMs ?? 0
    expect(history.minutes[0]?.atMs).toBe(atMs)
    expect(resourceHistoryText(history, atMs)).toContain(UI_TEXT.resourceHistoryCurrentMinute)
    expect(resourceHistoryText(history, atMs + 60_000)).not.toContain(
      UI_TEXT.resourceHistoryCurrentMinute,
    )
    const state = await usage(folder).read(QUERY)
    expect(state.resources?.minutes.map((record) => record.atMs)).toEqual([atMs])
  })

  it('rolls completed days up for the page and text, beyond the seven-day detail', async () => {
    const folder = await dataFolder()
    const old = Date.now() - 20 * 24 * 3_600_000
    const writer = new ResourceJournal(new NodeUsageFs(folder), {
      writerId: 'window',
      now: () => old,
      isEnabled: () => true,
    })
    await writer.append(reading(old, 42))
    const state = await usage(folder).read(QUERY)
    const day = new Date(old).toISOString().slice(0, 10)
    expect(state.resources?.days).toEqual([
      expect.objectContaining({ day, minutes: 1, cpuPercent: 42, memoryUsedPercent: 50 }),
    ])
    expect(state.resources?.minutes).toEqual([])
    const cli = await resources(folder)
    const text = await cli.command('history', false)
    expect(text).toContain(UI_TEXT.resourceHistoryDaily)
    expect(text).toContain(`${UI_TEXT.resourceHistoryDay}: ${day}`)
  })
})
