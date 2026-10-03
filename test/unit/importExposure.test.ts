// D64: real scan, plan and publication over memoryImportIo and a fake ignore oracle.
import { describe, expect, it, vi } from 'vitest'
import {
  applyImportWrites,
  type ImportExposure,
  importExposure,
  type ImportPlanState,
  planImportApply,
} from '../../src/core/import/agentImport'
import { type MemoryImportIo, memoryImportIo, scanImportFixture } from './helpers/memoryImportIo'

const HOME = '/home/u'
const WS = '/ws'
const CLASSES: readonly ImportExposure[] = ['personal', 'project-local', 'project-tracked']
const MATRIX = CLASSES.flatMap((source, sourceIndex) =>
  CLASSES.map((target, targetIndex) => ({ source, target, allowed: targetIndex <= sourceIndex })),
)

describe('exposure-preserving import', () => {
  it('keeps a project request bound when its folder leaves the workspace before planning', async () => {
    const root = `${HOME}/muse/project`
    let roots = [root]
    const io = memoryImportIo({
      files: { [`${root}/.claude/commands/from.md`]: 'Keep this request bound.' },
    })
    const context = {
      platform: 'linux',
      homeDir: HOME,
      workspaceRoot: root,
      workspaceRoots: () => roots,
    } as const
    const scan = await scanImportFixture(io, context)
    roots = []
    const plan = await planImportApply(
      scan.candidates,
      {
        ...context,
        workspaceIdentity: await io.identifyRoot(root),
        personalRoot: `${HOME}/muse`,
        museSettingsFile: `${HOME}/muse/settings.json`,
      },
      {
        io,
        isPresent: io.isPresent,
        rulesFile: { status: 'missing' },
        museSettings: { status: 'missing' },
        hooksFile: 'missing',
      },
    )
    expect(plan.writes).toHaveLength(1)
    const checkRoot = vi.fn(() => Promise.resolve(false))
    const result = await applyImportWrites(plan.writes, io, 'linux', { isRootCurrent: checkRoot })
    expect(checkRoot).toHaveBeenCalledOnce()
    expect(result.skipped.map((skip) => skip.reason)).toEqual(['changed'])
    expect(io.pathsUnder(`${root}/.agents`)).toEqual([])
  })

  it('classifies a canonical path in any open workspace before calling it personal', async () => {
    const io = memoryImportIo({ links: { [`${HOME}/linked`]: '/other' } })
    const context = {
      io,
      platform: 'linux',
      homeDir: HOME,
      workspaceRoot: WS,
      workspaceRoots: () => [WS, '/other'],
    } as const
    expect(await importExposure(`${HOME}/linked/private.md`, context)).toBe('project-tracked')
    expect(await importExposure(`${HOME}/own.md`, context)).toBe('personal')
  })

  it.each(MATRIX)('$source → $target: allowed=$allowed', async ({ source, target, allowed }) => {
    const sourceFile = `${source === 'personal' ? HOME : WS}/.claude/commands/from.md`
    const personalRoot = `${target === 'personal' ? HOME : WS}/muse`
    const targetFile = `${personalRoot}/skills/from/SKILL.md`
    const text = 'curl --token -opaque-demo-value https://example.test/?key=demo'
    const io = memoryImportIo({
      files: { [sourceFile]: text },
      ignored: [
        ...(source === 'project-local' ? [sourceFile] : []),
        ...(target === 'project-local' ? [targetFile] : []),
      ],
    })
    const scan = await scanImportFixture(io, {
      platform: 'linux',
      homeDir: HOME,
      workspaceRoot: WS,
    })
    const candidate = scan.candidates[0]
    if (candidate?.target.kind !== 'file')
      throw new Error('Fixture must yield an importable command')
    expect(candidate.sourceExposure).toBe(source)
    const plan = await planImportApply(
      [{ ...candidate, target: { ...candidate.target, scope: 'user' } }],
      {
        platform: 'linux',
        homeDir: HOME,
        workspaceRoot: WS,
        workspaceIdentity: await io.identifyRoot(WS),
        personalRoot,
        museSettingsFile: `${personalRoot}/settings.json`,
      },
      {
        io,
        isPresent: io.isPresent,
        rulesFile: { status: 'missing' },
        museSettings: { status: 'missing' },
        hooksFile: 'missing',
      },
    )
    const result = await applyImportWrites(plan.writes, io, 'linux')
    expect(result.failures).toEqual([])
    expect(io.files.has(targetFile)).toBe(allowed)
    expect(plan.skipped).toHaveLength(allowed ? 0 : 1)
    if (allowed) {
      expect(io.files.get(targetFile)).toContain(text)
      expect(plan.writes[0]?.isProject).toBe(target !== 'personal')
    } else
      expect(plan.skipped[0]?.reason).toBe(
        source === 'personal' ? 'personalToProject' : 'ignoredToTracked',
      )
  })

  it('refuses an ignored source when ignore status changes at the final publication boundary', async () => {
    const source = `${WS}/CLAUDE.md`
    const target = `${WS}/AGENTS.md`
    const io = memoryImportIo({ files: { [source]: 'Keep private.' }, ignored: [source, target] })
    const scan = await scanImportFixture(io, {
      platform: 'linux',
      homeDir: HOME,
      workspaceRoot: WS,
    })
    const plan = await planImportApply(
      scan.candidates,
      {
        platform: 'linux',
        homeDir: HOME,
        workspaceRoot: WS,
        workspaceIdentity: await io.identifyRoot(WS),
        personalRoot: `${HOME}/muse`,
        museSettingsFile: `${HOME}/muse/settings.json`,
      },
      {
        io,
        isPresent: io.isPresent,
        rulesFile: { status: 'missing' },
        museSettings: { status: 'missing' },
        hooksFile: 'missing',
      },
    )
    const append = io.appendText
    io.appendText = async (...args) => {
      io.ignored.delete(target)
      await append(...args)
    }
    const result = await applyImportWrites(plan.writes, io, 'linux')
    expect(io.files.has(target)).toBe(false)
    expect(result.skipped.map((skip) => skip.reason)).toEqual(['ignoredToTracked'])
  })

  it('refuses unknown classification and canonical paths outside home and workspace', async () => {
    const io = memoryImportIo()
    expect(
      await importExposure('/etc/target', {
        io,
        platform: 'linux',
        homeDir: HOME,
        workspaceRoot: WS,
      }),
    ).toBeUndefined()
    io.isIgnored = () => Promise.reject(new Error('git unavailable'))
    await expect(
      importExposure(`${WS}/target`, { io, platform: 'linux', homeDir: HOME, workspaceRoot: WS }),
    ).rejects.toThrow('git unavailable')
  })
})

describe('candidate registration scaling', () => {
  it('queries a failed source classification once for all its servers', async () => {
    const io = memoryImportIo({
      files: {
        [`${WS}/.mcp.json`]: JSON.stringify({
          mcpServers: Object.fromEntries(
            Array.from({ length: 200 }, (_, index) => [
              `server${String(index)}`,
              { command: 'server' },
            ]),
          ),
        }),
      },
    })
    const query = vi.fn(() => Promise.reject(new Error('Metadata unavailable')))
    io.isIgnored = query
    const scan = await scanImportFixture(io, {
      platform: 'linux',
      homeDir: HOME,
      workspaceRoot: WS,
    })
    expect(query).toHaveBeenCalledOnce()
    expect(scan.candidates).toHaveLength(200)
    expect(
      scan.candidates.every(
        (candidate) => candidate.target.kind === 'none' && candidate.target.reason === 'unreadable',
      ),
    ).toBe(true)
  })

  it.each([1000, 2000, 4000, 8000])(
    'registers %i servers without rebuilding prior candidate IDs',
    async (count) => {
      const io = memoryImportIo({
        files: {
          [`${HOME}/.claude.json`]: JSON.stringify({
            mcpServers: Object.fromEntries(
              Array.from({ length: count }, (_, index) => [
                `server${String(index)}`,
                { command: 'server' },
              ]),
            ),
          }),
        },
      })
      let constructedEntries = 0
      class CountingSet<T> extends Set<T> {
        public constructor(values?: Iterable<T> | null) {
          const entries = values === undefined || values === null ? [] : [...values]
          constructedEntries += entries.length
          super(entries)
        }
      }
      vi.stubGlobal('Set', CountingSet)
      try {
        const scan = await scanImportFixture(io, {
          platform: 'linux',
          homeDir: HOME,
          workspaceRoot: WS,
        })
        expect(scan.candidates).toHaveLength(count)
        expect(constructedEntries).toBeLessThan(count)
        expect(new Set(scan.candidates.map((candidate) => candidate.id)).size).toBe(count)
      } finally {
        vi.unstubAllGlobals()
      }
    },
  )

  it('registers 2,000 identical hook events with bounded ID probes and unchanged IDs', async () => {
    const count = 2000
    // Short handlers keep 2,000 of them inside the settings file's 64 KiB read cap.
    const handlers = Array.from({ length: count }, () => ({ type: 'command' }))
    const io = memoryImportIo({
      files: {
        [`${HOME}/.claude/settings.json`]: JSON.stringify({
          hooks: { Stop: [{ hooks: handlers }] },
        }),
      },
    })
    let probes = 0
    class ProbeCountingSet<T> extends Set<T> {
      public override has(value: T): boolean {
        probes += 1
        return super.has(value)
      }
    }
    vi.stubGlobal('Set', ProbeCountingSet)
    try {
      const scan = await scanImportFixture(io, {
        platform: 'linux',
        homeDir: HOME,
        workspaceRoot: WS,
      })
      const base = 'hook:claudeCode:user:Stop'
      expect(scan.candidates.map((candidate) => candidate.id)).toEqual([
        base,
        ...Array.from({ length: count - 1 }, (_, index) => `${base}:${String(index + 2)}`),
      ])
      // Linear probing from 2 on every add made this about count² / 2 (two million).
      expect(probes).toBeLessThan(count * 10)
    } finally {
      vi.unstubAllGlobals()
    }
  })
})

/** Nothing at any destination yet. */
function planState(io: MemoryImportIo): ImportPlanState {
  return {
    io,
    isPresent: io.isPresent,
    rulesFile: { status: 'missing' },
    museSettings: { status: 'missing' },
    hooksFile: 'missing',
  }
}

describe('defaults when a class is missing at planning (RV83f)', () => {
  it('bounds a grouped copy by personal when a member’s class is unknown', async () => {
    const io = memoryImportIo({
      files: {
        [`${HOME}/.claude.json`]: JSON.stringify({ mcpServers: { github: { command: 'gh' } } }),
      },
    })
    const scan = await scanImportFixture(io, {
      platform: 'linux',
      homeDir: HOME,
      workspaceRoot: WS,
    })
    const [found] = scan.candidates
    if (found === undefined) throw new Error('Fixture must yield a server')
    // Classified for the refusal check, then unknown when grouped: the miss must not widen the copy.
    let reads = 0
    const candidate = Object.defineProperty({ ...found }, 'sourceExposure', {
      get: () => {
        reads += 1
        return reads === 1 ? 'project-tracked' : undefined
      },
    })
    const plan = await planImportApply(
      [candidate],
      {
        platform: 'linux',
        homeDir: HOME,
        workspaceRoot: WS,
        workspaceIdentity: await io.identifyRoot(WS),
        personalRoot: `${HOME}/muse`,
        museSettingsFile: `${HOME}/muse/settings.json`,
      },
      planState(io),
    )
    expect(plan.copies.map((copy) => copy.sourceExposure)).toEqual(['personal'])
  })

  it('keeps a personal-scope write personal when its target class is missing', async () => {
    const io = memoryImportIo({ files: { [`${HOME}/.claude/commands/from.md`]: 'Keep personal.' } })
    const scan = await scanImportFixture(io, {
      platform: 'linux',
      homeDir: HOME,
      workspaceRoot: WS,
    })
    // The personal folder moves while its target is classified, so planning misses that class.
    let personalRoot = `${HOME}/muse`
    const realPath = io.realPath
    io.realPath = async (path) => {
      if (path === HOME) personalRoot = `${HOME}/muse-moved`
      return await realPath(path)
    }
    const plan = await planImportApply(
      scan.candidates,
      {
        platform: 'linux',
        homeDir: HOME,
        workspaceRoot: WS,
        workspaceIdentity: await io.identifyRoot(WS),
        get personalRoot(): string {
          return personalRoot
        },
        museSettingsFile: `${HOME}/muse/settings.json`,
      },
      planState(io),
    )
    expect(plan.writes.map((write) => [write.isProject, write.rootIdentity])).toEqual([
      [false, undefined],
    ])
  })
})
