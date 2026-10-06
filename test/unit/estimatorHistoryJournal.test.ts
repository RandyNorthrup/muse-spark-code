import { constants } from 'node:fs'
import * as fs from 'node:fs/promises'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { EstimateHistoryJournal } from '../../src/core/estimator/calibration/journal'
import { fakeHistoryRecord } from './helpers/estimator/fixtures'

vi.mock('node:fs/promises', async (importOriginal) => ({
  ...(await importOriginal<typeof fs>()),
}))

describe('M117 durable metadata-only history journal', () => {
  let directory: string
  let journal: EstimateHistoryJournal
  beforeEach(async () => {
    await fs.mkdir(path.resolve('temp/m117-c'), { recursive: true })
    directory = await fs.mkdtemp(path.resolve('temp/m117-c/journal-'))
    journal = new EstimateHistoryJournal(path.join(directory, 'history'))
  })
  afterEach(async () => {
    vi.restoreAllMocks()
    await fs.rm(directory, { recursive: true, force: true })
  })

  async function publishedFile(): Promise<string> {
    const files = await fs.readdir(path.join(directory, 'history'))
    return path.join(
      directory,
      'history',
      files.find((file) => file.endsWith('.json'))!,
    )
  }

  it('returns an empty history only for storage that does not exist', async () => {
    expect(await journal.list()).toEqual([])
    await fs.writeFile(path.join(directory, 'history'), 'not a directory')
    await expect(journal.list()).rejects.toMatchObject({ code: 'historyReadFailed' })
  })

  it('persists metadata across journal instances with private permissions and no staging files', async () => {
    const record = fakeHistoryRecord()
    await journal.append(record)
    expect(await new EstimateHistoryJournal(path.join(directory, 'history')).list()).toEqual([
      record,
    ])
    const file = await publishedFile()
    const text = await fs.readFile(file, 'utf8')
    expect(JSON.parse(text)).toEqual({ version: 1, durationBasis: record.durationBasis, record })
    expect(path.basename(file)).toMatch(/^[a-f\d]{64}\.json$/)
    expect(await fs.readdir(path.dirname(file))).toHaveLength(2)
    if (process.platform === 'win32') {
      return
    }

    const fileStat = await fs.stat(file)
    const dirStat = await fs.stat(path.dirname(file))
    expect(fileStat.mode & 0o777).toBe(0o600)
    expect(dirStat.mode & 0o777).toBe(0o700)
  })

  it('publishes concurrent appends without losing lanes or exposing partially written files', async () => {
    const other = new EstimateHistoryJournal(path.join(directory, 'history'))
    const records = Array.from({ length: 12 }, (_, index) =>
      fakeHistoryRecord(`M117:lane-${String(index).padStart(2, '0')}`),
    )
    await Promise.all(
      records.map(async (record, index) => {
        await (index % 2 === 0 ? journal : other).append(record)
      }),
    )
    expect(await journal.list()).toEqual(records)
    expect(await fs.readdir(path.join(directory, 'history'))).toHaveLength(24)
  })

  it('makes a concurrent replay idempotent and refuses a conflicting completed observation', async () => {
    const record = fakeHistoryRecord()
    await Promise.all([
      journal.append(record),
      new EstimateHistoryJournal(path.join(directory, 'history')).append(record),
    ])
    const file = await publishedFile()
    const bytes = await fs.readFile(file)
    expect(await journal.list()).toEqual([record])
    await expect(journal.append({ ...record, actualHours: 5 })).rejects.toMatchObject({
      code: 'conflictingHistory',
    })
    expect(await fs.readFile(file)).toEqual(bytes)
    expect(await fs.readdir(path.dirname(file))).toHaveLength(2)
  })

  it('refuses cross-basis class and kind conflicts while preserving unrelated history', async () => {
    const record = fakeHistoryRecord('M117:cross-basis')
    const unrelated = fakeHistoryRecord('M117:unrelated')
    await journal.append(record)
    await journal.append(unrelated)
    for (const change of [{ machineClassId: 'macos-arm64-builder' }, { kind: 'ui' }]) {
      await expect(
        journal.append({ ...record, ...change, durationBasis: 'gitElapsed', source: 'git' }),
      ).rejects.toMatchObject({ code: 'conflictingHistory' })
      expect(await journal.list()).toEqual([record, unrelated])
    }
  })

  it('admits only one identity when independent journals concurrently append different bases', async () => {
    const record = fakeHistoryRecord('M117:cross-basis')
    const other = new EstimateHistoryJournal(path.join(directory, 'history'))
    const results = await Promise.allSettled([
      journal.append(record),
      other.append({ ...record, kind: 'ui', durationBasis: 'gitElapsed', source: 'git' }),
    ])
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1)
    expect(results.filter((result) => result.status === 'rejected')).toEqual([
      { status: 'rejected', reason: expect.objectContaining({ code: 'conflictingHistory' }) },
    ])
    expect(await journal.list()).toHaveLength(1)
    await journal.append(fakeHistoryRecord('M117:unrelated'))
    expect(await journal.list()).toHaveLength(2)
  })

  it('versions and retains both bases separately while accepting legacy records', async () => {
    const agent = fakeHistoryRecord('M117:cross-basis')
    await journal.append(agent)
    const firstFile = await publishedFile()
    // Simulate the prior journal format, which has no envelope or lane claim.
    await fs.writeFile(firstFile, JSON.stringify(agent))
    const files = await fs.readdir(path.dirname(firstFile))
    await fs.rm(
      path.join(
        path.dirname(firstFile),
        files.find((file) => file.endsWith('.identity'))!,
      ),
    )
    await expect(journal.append({ ...agent, kind: 'ui' })).rejects.toMatchObject({
      code: 'conflictingHistory',
    })
    await expect(
      journal.append({ ...agent, kind: 'ui', durationBasis: 'gitElapsed', source: 'git' }),
    ).rejects.toMatchObject({ code: 'conflictingHistory' })
    const git = {
      ...agent,
      durationBasis: 'gitElapsed',
      source: 'git',
      actualHours: 5,
    } satisfies typeof agent
    await journal.append(git)
    await Promise.all([journal.append(agent), journal.append(git)])
    expect(await new EstimateHistoryJournal(path.dirname(firstFile)).list()).toEqual([agent, git])
    const allFiles = await fs.readdir(path.dirname(firstFile))
    const published = allFiles.filter((file) => file.endsWith('.json'))
    expect(published).toHaveLength(2)
    const secondFile = published.find((file) => file !== path.basename(firstFile))!
    expect(
      JSON.parse(await fs.readFile(path.join(path.dirname(firstFile), secondFile), 'utf8')),
    ).toEqual({ version: 1, durationBasis: 'gitElapsed', record: git })
    expect(await fs.readFile(firstFile, 'utf8')).toBe(JSON.stringify(agent))
    expect(journal.skippedRecords).toEqual([])
  })

  it('skips and reports unknown versions, unknown bases and mixed basis tags without hiding good lanes', async () => {
    const first = fakeHistoryRecord('M117:first')
    await journal.append(first)
    const file = await publishedFile()
    const unrelated = fakeHistoryRecord('M117:unrelated')
    await journal.append(unrelated)
    const envelope = { version: 1, durationBasis: first.durationBasis, record: first }
    for (const [value, code] of [
      [{ ...envelope, version: 2 }, 'unknownHistoryVersion'],
      [{ ...envelope, durationBasis: 'futureBasis' }, 'unknownHistoryBasis'],
      [{ ...first, durationBasis: 'futureBasis' }, 'unknownHistoryBasis'],
      [{ ...envelope, record: { ...first, durationBasis: 'futureBasis' } }, 'unknownHistoryBasis'],
      [{ ...envelope, durationBasis: 'gitElapsed' }, 'mixedHistoryBasis'],
    ]) {
      const bytes = JSON.stringify(value)
      await fs.writeFile(file, bytes)
      expect(await journal.list()).toEqual([unrelated])
      expect(journal.skippedRecords).toEqual([
        { recordId: expect.stringMatching(/^[a-f\d]{64}$/), code },
      ])
      expect(await fs.readFile(file, 'utf8')).toBe(bytes)
    }
    await fs.writeFile(file, JSON.stringify(envelope))
    expect(await journal.list()).toEqual([first, unrelated])
    expect(journal.skippedRecords).toEqual([])
  })

  it('skips and reports a conflicting legacy cross-basis identity instead of poisoning all lanes', async () => {
    const first = fakeHistoryRecord('M117:cross-basis')
    await journal.append(first)
    const file = await publishedFile()
    await journal.append({ ...first, durationBasis: 'gitElapsed', source: 'git' })
    const bytes = JSON.stringify({ ...first, machineClassId: 'macos-arm64-builder' })
    await fs.writeFile(file, bytes)
    const unrelated = fakeHistoryRecord('M117:unrelated')
    await journal.append(unrelated)
    const listed = await journal.list()
    expect(listed).toHaveLength(2)
    expect(listed).toContainEqual(unrelated)
    expect(journal.skippedRecords).toEqual([
      { recordId: expect.stringMatching(/^[a-f\d]{64}$/), code: 'conflictingLaneIdentity' },
    ])
    expect(await fs.readFile(file, 'utf8')).toBe(bytes)
  })

  it('keeps history readable during a torn staging write and publishes nothing from that write', async () => {
    const record = fakeHistoryRecord('M117:first')
    await journal.append(record)
    const file = await publishedFile()
    const original = await fs.readFile(file)
    const realOpen = fs.open
    vi.spyOn(fs, 'open').mockImplementation(async (...args) => {
      const handle = await realOpen(...args)
      if (args[1] === 'wx') {
        const write = handle.writeFile.bind(handle)
        vi.spyOn(handle, 'writeFile').mockImplementationOnce(async () => {
          await write('{torn')
          expect(await journal.list()).toEqual([record])
          throw new Error('PRIVATE-TORN-WRITE')
        })
      }
      return handle
    })
    await expect(journal.append(fakeHistoryRecord('M117:second'))).rejects.toMatchObject({
      code: 'historyWriteFailed',
    })
    expect(await journal.list()).toEqual([record])
    expect(await fs.readFile(file)).toEqual(original)
    const remaining = await fs.readdir(path.dirname(file))
    expect(remaining.some((name) => name.endsWith('.tmp'))).toBe(false)
    vi.restoreAllMocks()
    await journal.append(fakeHistoryRecord('M117:second'))
    expect(await journal.list()).toHaveLength(2)
  })

  it('canonicalizes dates and module/class order before comparing replays', async () => {
    const record = fakeHistoryRecord()
    if (record.review.status !== 'known') throw new Error('expected known review')
    record.review.rounds = 2
    const family = record.review.modules[0]!
    family.familyId = 'z'
    family.strikes = 2
    family.classes.push({ class: 'testsGates', strikes: 2 })
    record.review.modules.push({ familyId: 'a', strikes: 1, classes: [] })
    const reversed = structuredClone(record)
    if (reversed.review.status === 'known') {
      reversed.review.modules.reverse()
      for (const module of reversed.review.modules) module.classes.reverse()
    }
    reversed.startedAt = '2026-10-05T10:00:00Z'
    await journal.append(record)
    await journal.append(reversed)
    expect(await journal.list()).toHaveLength(1)
    const listed = await journal.list()
    expect(listed[0]!.review).toMatchObject({
      modules: [{ familyId: 'a' }, { familyId: 'z' }],
    })
  })

  it('refuses extra fields before writing and never stores conversation content', async () => {
    const record = { ...fakeHistoryRecord(), content: 'PRIVATE-CONVERSATION-CONTENT' }
    await expect(journal.append(record)).rejects.toMatchObject({ code: 'invalidHistory' })
    expect(await fs.readdir(directory)).toEqual([])
  })

  it('refuses a corrupt, oversized or invalid-UTF8 published file without changing it', async () => {
    await journal.append(fakeHistoryRecord())
    const file = await publishedFile()
    for (const bytes of [
      Buffer.from('{torn'),
      Buffer.from(JSON.stringify({ ...fakeHistoryRecord(), content: 'PRIVATE-CONTENT' })),
      Buffer.alloc(131_073),
      Buffer.from([0xff]),
    ]) {
      await fs.writeFile(file, bytes)
      await expect(journal.list()).rejects.toMatchObject({
        code: 'historyReadFailed',
        message: 'Estimate failed: historyReadFailed',
      })
      expect(await fs.readFile(file)).toEqual(bytes)
    }
  })

  it('refuses metadata filed under a different lane identity', async () => {
    await journal.append(fakeHistoryRecord())
    await fs.writeFile(await publishedFile(), JSON.stringify(fakeHistoryRecord('M117:different')))
    await expect(journal.list()).rejects.toMatchObject({ code: 'historyReadFailed' })
  })

  it('decodes published metadata with fatal UTF-8', async () => {
    const record = fakeHistoryRecord()
    await journal.append(record)
    const decode = TextDecoder.prototype.decode
    vi.spyOn(TextDecoder.prototype, 'decode').mockImplementation(function (
      this: TextDecoder,
      input,
      options,
    ) {
      expect(this.fatal).toBe(true)
      return decode.call(this, input, options)
    })
    expect(await journal.list()).toEqual([record])
  })

  it('ignores interrupted staging bytes but rejects unexpected published JSON', async () => {
    await fs.mkdir(path.join(directory, 'history'))
    await fs.writeFile(path.join(directory, 'history', 'interrupted.tmp'), 'PRIVATE-UNPUBLISHED')
    expect(await journal.list()).toEqual([])
    await fs.writeFile(
      path.join(directory, 'history', 'unexpected.json'),
      JSON.stringify(fakeHistoryRecord()),
    )
    await expect(journal.list()).rejects.toMatchObject({ code: 'historyReadFailed' })
  })

  it('refuses filesystem failures without echoing storage paths or low-level messages', async () => {
    const secretPath = path.join(directory, 'PRIVATE-PATH')
    await fs.writeFile(secretPath, 'blocking parent')
    const blocked = new EstimateHistoryJournal(path.join(secretPath, 'history'))
    await expect(blocked.append(fakeHistoryRecord())).rejects.toMatchObject({
      code: 'historyWriteFailed',
      message: 'Estimate failed: historyWriteFailed',
    })
    expect(await fs.readFile(secretPath, 'utf8')).toBe('blocking parent')
  })

  it('does not publish when a file flush fails, cleans staging bytes, and allows a safe retry', async () => {
    const realOpen = fs.open
    vi.spyOn(fs, 'open').mockImplementation(async (...args) => {
      const handle = await realOpen(...args)
      if (args[1] === 'wx')
        vi.spyOn(handle, 'sync').mockRejectedValueOnce(new Error('PRIVATE-FLUSH-FAILURE'))
      return handle
    })
    await expect(journal.append(fakeHistoryRecord())).rejects.toMatchObject({
      code: 'historyWriteFailed',
    })
    expect(await journal.list()).toEqual([])
    expect(await fs.readdir(path.join(directory, 'history'))).toEqual([])
    vi.restoreAllMocks()
    await journal.append(fakeHistoryRecord())
    expect(await journal.list()).toHaveLength(1)
  })

  it('refuses failed atomic publication without disturbing existing records', async () => {
    const first = fakeHistoryRecord('M117:first')
    await journal.append(first)
    vi.spyOn(fs, 'link').mockRejectedValueOnce(
      Object.assign(new Error('PRIVATE-LINK-FAILURE'), { code: 'ENOSPC' }),
    )
    await expect(journal.append(fakeHistoryRecord('M117:second'))).rejects.toMatchObject({
      code: 'historyWriteFailed',
    })
    expect(await journal.list()).toEqual([first])
    expect(await fs.readdir(path.join(directory, 'history'))).toHaveLength(2)
  })

  it('never reads a symlink as a published record', async () => {
    await journal.append(fakeHistoryRecord())
    const file = await publishedFile()
    const outside = path.join(directory, 'outside')
    await fs.writeFile(outside, JSON.stringify(fakeHistoryRecord()))
    await fs.rm(file)
    await fs.symlink(outside, file)
    const openSpy = vi.spyOn(fs, 'open')
    await expect(journal.list()).rejects.toMatchObject({ code: 'historyReadFailed' })
    expect(openSpy).not.toHaveBeenCalled()
    expect(await fs.readFile(outside, 'utf8')).toBe(JSON.stringify(fakeHistoryRecord()))
  })

  it('bounds reads when the file grows after its stat', async () => {
    await journal.append(fakeHistoryRecord())
    const decode = vi.spyOn(TextDecoder.prototype, 'decode')
    const realOpen = fs.open
    vi.spyOn(fs, 'open').mockImplementation(async (...args) => {
      const handle = await realOpen(...args)
      if (args[1] === (constants.O_RDONLY | constants.O_NOFOLLOW)) {
        vi.spyOn(handle, 'read').mockResolvedValueOnce({
          bytesRead: 131_073,
          buffer: Buffer.alloc(0),
        })
      }
      return handle
    })
    await expect(journal.list()).rejects.toMatchObject({ code: 'historyReadFailed' })
    expect(decode).not.toHaveBeenCalled()
  })

  it('uses native nofollow where available when a link replaces an observed regular file', async () => {
    const record = fakeHistoryRecord()
    await journal.append(record)
    const file = await publishedFile()
    const regularStat = await fs.lstat(file)
    const outside = path.join(directory, 'outside')
    await fs.writeFile(outside, JSON.stringify(record))
    await fs.rm(file)
    await fs.symlink(outside, file)
    vi.spyOn(fs, 'lstat').mockResolvedValueOnce(regularStat)
    const opened = vi.spyOn(fs, 'open')
    if (constants.O_NOFOLLOW)
      await expect(journal.list()).rejects.toMatchObject({ code: 'historyReadFailed' })
    else expect(await journal.list()).toEqual([record])
    expect(opened).toHaveBeenCalledWith(file, constants.O_RDONLY | constants.O_NOFOLLOW)
  })

  it('refuses oversized observations before creating storage', async () => {
    const record = fakeHistoryRecord()
    record.review = {
      status: 'known',
      rounds: 1,
      modules: Array.from({ length: 4000 }, (_, index) => ({
        familyId: `family-${String(index)}`,
        strikes: 0,
        classes: [],
      })),
      redesigns: [],
    }
    await expect(journal.append(record)).rejects.toMatchObject({ code: 'historyRecordTooLarge' })
    expect(await fs.readdir(directory)).toEqual([])
  })

  it('rejects an oversized file or a directory before attempting to read its bytes', async () => {
    await journal.append(fakeHistoryRecord())
    const file = await publishedFile()
    await fs.writeFile(file, Buffer.alloc(131_073))
    const reads = vi.fn()
    const realOpen = fs.open
    vi.spyOn(fs, 'open').mockImplementation(async (...args) => {
      const handle = await realOpen(...args)
      vi.spyOn(handle, 'read').mockImplementation(() => {
        reads()
        return Promise.reject(new Error('forbidden read'))
      })
      return handle
    })
    await expect(journal.list()).rejects.toMatchObject({ code: 'historyReadFailed' })
    expect(reads).not.toHaveBeenCalled()
    await fs.rm(file)
    await fs.mkdir(file)
    await expect(journal.list()).rejects.toMatchObject({ code: 'historyReadFailed' })
    expect(reads).not.toHaveBeenCalled()
  })

  it('reports a failed directory flush after publication and keeps a complete retryable record', async () => {
    const realOpen = fs.open
    vi.spyOn(fs, 'open').mockImplementation(async (...args) => {
      const handle = await realOpen(...args)
      if (args[1] === constants.O_RDONLY)
        vi.spyOn(handle, 'sync').mockRejectedValueOnce(new Error('PRIVATE-DIRECTORY-FLUSH'))
      return handle
    })
    const record = fakeHistoryRecord()
    if (process.platform === 'win32') await journal.append(record)
    else await expect(journal.append(record)).rejects.toMatchObject({ code: 'historyWriteFailed' })
    expect(await journal.list()).toEqual([record])
    vi.restoreAllMocks()
    await journal.append(record)
    expect(await journal.list()).toHaveLength(1)
  })

  it('sanitizes cleanup failure and retains an earlier publication failure', async () => {
    vi.spyOn(fs, 'rm').mockRejectedValueOnce(new Error('PRIVATE-CLEANUP'))
    await expect(journal.append(fakeHistoryRecord('M117:first'))).rejects.toMatchObject({
      code: 'historyCleanupFailed',
      message: 'Estimate failed: historyCleanupFailed',
    })
    expect(await journal.list()).toHaveLength(1)
    vi.spyOn(fs, 'link').mockRejectedValueOnce(
      Object.assign(new Error('PRIVATE-PUBLICATION'), { code: 'ENOSPC' }),
    )
    vi.mocked(fs.rm).mockRejectedValueOnce(new Error('PRIVATE-CLEANUP'))
    await expect(journal.append(fakeHistoryRecord('M117:second'))).rejects.toMatchObject({
      code: 'historyWriteFailed',
    })
    expect(await journal.list()).toHaveLength(1)
  })
})
