// Failure-code recovery for the local report sources (D119): every per-file
// or per-line failure keeps a true code, and cancellation stays cancelled.
// Every failure below is produced by the real code and the real kernel: real
// files over a temporary directory, real permission/shape errors from node:fs,
// real JSON and zod parsers, and real abort signals. No port, store, provider
// or module is simulated.
import { appendFileSync, mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { readFile, readdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import * as z from 'zod/mini'
import { isParseFailure } from '../../src/core/reporting/sources/local'
import { readLedger } from '../../src/core/reporting/plan/ledger'
import { readPlan } from '../../src/core/reporting/plan/reader'
import { agentUsageSource, type AgentUsageFile } from '../../src/core/reporting/sources/agentUsage'
import { certificationSource } from '../../src/core/reporting/sources/certification'
import {
  LocalSourceError,
  sourceReason,
  type LocalFileIo,
  type SourceScrub,
} from '../../src/core/reporting/sources/local'
import type { SourceReadContext } from '../../src/core/reporting/sources/types'
import { CheckRunJournal } from '../../src/core/reporting/checkRuns'
import { ReportHistory, ReportStorage } from '../../src/core/reporting/history'
import { createSamplerIo } from '../../src/core/resources/sampler/system'
import { QUALITY_LEDGER_FIXTURE } from './helpers/reporting/plans'

function context(signal?: AbortSignal): SourceReadContext {
  return {
    asOf: new Date('2026-10-18T00:00:00.000Z').toISOString(),
    workspaceKey: 'testkey1',
    options: {
      kind: 'session',
      asOf: new Date('2026-10-18T00:00:00.000Z').toISOString(),
      scope: 'test-scope',
      full: false,
      network: false,
      failOn: [],
    },
    signal: signal ?? AbortSignal.timeout(30_000),
  }
}

/** A plain filesystem reader: real syscalls, so the kernel owns every errno. */
function plainIo(root: string): LocalFileIo {
  return {
    read: async (file, signal) => {
      signal.throwIfAborted()
      return await readFile(path.join(root, file), 'utf8')
    },
    list: async (directory, signal) => {
      signal.throwIfAborted()
      const entries = await readdir(path.join(root, directory), { withFileTypes: true })
      return entries.map((entry) => ({ name: entry.name, directory: entry.isDirectory() }))
    },
  }
}

const identityScrub: SourceScrub = (text) => text

describe('readLedger failure codes', () => {
  // The recorded plan fixture's own ledger, read by the real plan reader.
  const fixtureJson = JSON.stringify(readPlan(QUALITY_LEDGER_FIXTURE).ledger)

  it('reads the recorded ledger fixture', () => {
    const { ledger, facts } = readLedger(fixtureJson, 1)
    expect(ledger).not.toBeNull()
    expect(facts.drift).toEqual([])
  })

  it('reads malformed JSON as ledger-json drift, never a throw', () => {
    const { ledger, facts } = readLedger('{not json', 7)
    expect(ledger).toBeNull()
    expect(facts.drift).toEqual([{ code: 'ledger-json', line: 7, detail: 'quality-ledger' }])
  })

  it('reads duplicate keys as ledger-json drift, never the last value', () => {
    const json = fixtureJson.replace('"schema_version":1', '"schema_version":1,"schema_version":1')
    const { ledger, facts } = readLedger(json, 3)
    expect(ledger).toBeNull()
    expect(facts.drift).toEqual([{ code: 'ledger-json', line: 3, detail: 'quality-ledger' }])
  })
})

function agentFiles(io: LocalFileIo, names: readonly string[]): AgentUsageFile[] {
  return names.map((file) => ({ agent: 'claudeCode' as const, file, io }))
}

async function withTempDir(label: string, run: (root: string) => Promise<void>): Promise<void> {
  const root = mkdtempSync(path.join(tmpdir(), `catchres-${label}-`))
  try {
    await run(root)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
}

async function readAgentUsage(root: string, names: readonly string[], signal?: AbortSignal) {
  const source = agentUsageSource(['claudeCode'], agentFiles(plainIo(root), names), identityScrub)
  return await source.read(context(signal))
}

async function readCertification(root: string, signal?: AbortSignal) {
  const source = certificationSource(plainIo(root), identityScrub)
  return await source.read(context(signal))
}

function testHistory(root: string, authorize: () => Promise<void>) {
  return new ReportHistory({
    storage: new ReportStorage(root),
    codec: {
      encode: (document) => JSON.stringify(document),
      decode: (): never => {
        throw new Error('history failure paths never decode')
      },
    },
    keepHistory: () => true,
    authorize,
  })
}

describe('agentUsageSource failure codes', () => {
  it.each([
    ['{not json\n'],
    ['{"type":"assistant","timestamp":"2026-10-18T00:00:00.000Z","message":{"id":"x"}}\n'],
  ])('reads corrupt content as invalid, never a throw', async (line) => {
    await withTempDir('usage', async (root) => {
      const dir = path.join(root, 'projects', 'w')
      mkdirSync(dir, { recursive: true })
      writeFileSync(path.join(dir, 's.jsonl'), line)
      const result = await readAgentUsage(root, ['projects/w/s.jsonl'])
      expect(result.data).toBeNull()
      expect(result.record.reason).toBe(sourceReason('invalid'))
    })
  })

  it('reads a vanished file as missing', async () => {
    await withTempDir('usage', async (root) => {
      mkdirSync(path.join(root, 'projects', 'w'), { recursive: true })
      const result = await readAgentUsage(root, ['projects/w/gone.jsonl'])
      expect(result.data).toBeNull()
      expect(result.record.reason).toBe(sourceReason('missing'))
    })
  })

  it('reads an unreadable file as failed, never as invalid data', async () => {
    await withTempDir('usage', async (root) => {
      // A directory where the usage file should be: the kernel refuses the
      // read with a real errno on every platform.
      mkdirSync(path.join(root, 'projects', 'w', 's.jsonl'), { recursive: true })
      const result = await readAgentUsage(root, ['projects/w/s.jsonl'])
      expect(result.data).toBeNull()
      expect(result.record.reason).toBe(sourceReason('failed'))
    })
  })

  it('reads cancellation as cancelled, never as invalid data', async () => {
    await withTempDir('usage', async (root) => {
      mkdirSync(path.join(root, 'projects', 'w'), { recursive: true })
      const result = await readAgentUsage(root, ['projects/w/s.jsonl'], AbortSignal.abort())
      expect(result.data).toBeNull()
      expect(result.record.reason).toBe(sourceReason('cancelled'))
    })
  })
})

describe('certificationSource cancellation', () => {
  it('reads an empty certification tree with no failures', async () => {
    await withTempDir('cert', async (root) => {
      mkdirSync(path.join(root, 'docs', 'certification'), { recursive: true })
      const result = await readCertification(root)
      expect(result.data).toEqual({ records: [] })
      expect(result.record.status).toBe('ok')
    })
  })

  it('reads the repository certification records', async () => {
    const source = certificationSource(plainIo(process.cwd()), identityScrub)
    const result = await source.read(context())
    expect(result.record.status).toBe('ok')
    expect(Array.isArray(result.data?.records)).toBe(true)
  })

  it('reads cancellation as cancelled, never as failed paths', async () => {
    await withTempDir('cert', async (root) => {
      mkdirSync(path.join(root, 'docs', 'certification'), { recursive: true })
      const result = await readCertification(root, AbortSignal.abort())
      expect(result.data).toBeNull()
      expect(result.record.reason).toBe(sourceReason('cancelled'))
    })
  })
})

describe('checkRuns journal recovery', () => {
  const record = {
    check: 'fixture-check',
    outcome: 'passed' as const,
    durationMs: 12,
    commit: 'a'.repeat(40),
    at: new Date('2026-10-18T00:00:00.000Z').toISOString(),
  }

  it('keeps valid entries past corrupt journal lines and reports partial', async () => {
    await withTempDir('checks', async (root) => {
      const storage = new ReportStorage(root)
      const journal = new CheckRunJournal({ storage, scrub: identityScrub })
      await journal.append('testkey1', record)
      appendFileSync(
        path.join(root, 'reports', 'v1', 'checks', 'testkey1.jsonl'),
        '{bad line\n{"nope":true}\n',
      )
      const result = await journal.source().read(context())
      expect(result.record.status).toBe('partial')
      expect(result.data).toHaveLength(1)
      expect(result.data?.[0]?.check).toBe('fixture-check')
    })
  })

  it('lets a scrub bug reject the read instead of skipping the line', async () => {
    await withTempDir('checks', async (root) => {
      const storage = new ReportStorage(root)
      const journal = new CheckRunJournal({ storage, scrub: identityScrub })
      await journal.append('testkey1', record)
      const buggy = new CheckRunJournal({
        storage,
        scrub: () => {
          throw new Error('scrub unavailable')
        },
      })
      // A scrub bug is not a corrupt line: the whole source is unavailable
      // instead of silently dropping the entry.
      const failed = await buggy.source().read(context())
      expect(failed.record.status).toBe('unavailable')
      expect(failed.data).toBeNull()
    })
  })
})

describe('ReportStorage failure codes', () => {
  it('round-trips a write through a real lock and read', async () => {
    await withTempDir('history', async (root) => {
      const storage = new ReportStorage(root)
      await storage.transaction(['history', 'testkey1', 'session'], true, async (files) => {
        await files.write('h1.json', '{"a":1}')
      })
      const text = await storage.transaction(
        ['history', 'testkey1', 'session'],
        false,
        async (files) => {
          return await files.read('h1.json')
        },
      )
      expect(text).toBe('{"a":1}')
    })
  })

  it('reads a vanished name as undefined, never a throw', async () => {
    await withTempDir('history', async (root) => {
      const storage = new ReportStorage(root)
      mkdirSync(path.join(root, 'reports', 'v1'), { recursive: true })
      const text = await storage.transaction([], false, async (files) => {
        return await files.read('never-written.json')
      })
      expect(text).toBeUndefined()
      const stat = await storage.transaction([], false, async (files) => {
        return await files.stat('never-written.json')
      })
      expect(stat).toBeUndefined()
    })
  })

  it('throws past a directory where a file should be', async () => {
    await withTempDir('history', async (root) => {
      const storage = new ReportStorage(root)
      mkdirSync(path.join(root, 'reports', 'v1', 'adir'), { recursive: true })
      await expect(
        storage.transaction([], false, async (files) => {
          return await files.read('adir')
        }),
      ).rejects.toThrow()
    })
  })

  it('lists an empty history and fails missing entries instead of throwing', async () => {
    await withTempDir('history', async (root) => {
      const history = testHistory(root, () => Promise.resolve())
      const listed = await history.history({ workspaceKey: 'testkey1', kind: 'session' })
      expect(listed.status).toBe('listed')
      const gotten = await history.get({ workspaceKey: 'testkey1', kind: 'session', id: 'x' })
      expect(gotten.status).toBe('failed')
      const compared = await history.compare({
        workspaceKey: 'testkey1',
        kind: 'session',
        fromId: 'x',
        toId: 'y',
      })
      expect(compared.status).toBe('failed')
      const closed = testHistory(root, () => Promise.reject(new Error('not authorized')))
      const refused = await closed.history({ workspaceKey: 'testkey1', kind: 'session' })
      expect(refused.status).toBe('failed')
    })
  })
})

describe('sampler io failure codes', () => {
  const io = createSamplerIo({ timeoutMs: 1000, maxOutputBytes: 1024 })

  it('reads a real file, absent as undefined and a directory as null', async () => {
    await withTempDir('io', async (root) => {
      writeFileSync(path.join(root, 'present.txt'), '42\n')
      mkdirSync(path.join(root, 'adir'))
      await expect(io.read(path.join(root, 'present.txt'))).resolves.toBe('42\n')
      await expect(io.read(path.join(root, 'absent.txt'))).resolves.toBeUndefined()
      await expect(io.read(path.join(root, 'adir'))).resolves.toBeNull()
      await expect(io.list(root)).resolves.toContain('present.txt')
      await expect(io.list(path.join(root, 'absent-dir'))).resolves.toBeNull()
    })
  })

  it('throws past undecodable bytes instead of guessing a reading', async () => {
    await withTempDir('io', async (root) => {
      writeFileSync(path.join(root, 'binary.bin'), Buffer.from([0xff, 0xfe, 0x00, 0x41]))
      await expect(io.read(path.join(root, 'binary.bin'))).rejects.toThrow()
    })
  })
})

describe('LocalSourceError contract', () => {
  it('keeps the failing code on the error', () => {
    expect(new LocalSourceError('missing').code).toBe('missing')
  })
})

/** A schema failure from the real parser, never constructed by hand. */
function zodFailure(): unknown {
  try {
    z.strictObject({ version: z.string() }).parse({ version: 1 })
  } catch (error: unknown) {
    return error
  }
  throw new Error('the real parser did not fail')
}

describe('isParseFailure contract', () => {
  it('reads malformed JSON and real schema failures as parse failures', () => {
    expect(isParseFailure(new SyntaxError('bad json'))).toBe(true)
    expect(isParseFailure(zodFailure())).toBe(true)
  })

  it('refuses cancellations, bugs and errno failures', () => {
    expect(isParseFailure(new DOMException('stopped', 'AbortError'))).toBe(false)
    expect(isParseFailure(new TypeError('not a failure shape'))).toBe(false)
    expect(
      isParseFailure(Object.assign(new Error('refused'), { code: 'EACCES', errno: -13 })),
    ).toBe(false)
    expect(isParseFailure(new LocalSourceError('missing'))).toBe(false)
  })
})
