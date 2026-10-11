import { createHash } from 'node:crypto'
import { describe, expect, it, vi } from 'vitest'
import {
  LegalFixPreviews,
  type LegalFixHostState,
  type LegalFixApplier,
} from '../../src/host/legalFix'
import type { LegalFinding, LegalScanResult } from '../../src/shared/legal'
import { LEGAL_FIX_FILE_READ_MAX_BYTES } from '../../src/shared/constants'

const finding: LegalFinding = {
  id: 'header/1/1',
  severity: 'advice',
  category: 'codeQualityHeader',
  file: 'src/a.ts',
  evidenceSource: 'header reader',
  confidence: 1,
  explanation: 'Missing header',
  recommendation: 'Add verified header',
  fixable: true,
}
const hash = (text: string) => createHash('sha256').update(text).digest('hex')
const request = {
  type: 'requestLegalFix' as const,
  requestId: 'request-1',
  scan: { scanId: 'scan-1', ruleVersion: '1', dataVersion: 'data-1', scope: '' },
  findings: [finding],
  includeProjectLicense: false,
}

function setup() {
  const entries: Record<string, string> = {
    'src/a.ts': 'source',
    LICENSE: 'MIT License',
    NOTICE: 'Owner',
  }
  const result: LegalScanResult = {
    version: 1,
    ruleVersion: '1',
    dataVersion: 'data-1',
    scope: '',
    distribution: 'source checkout',
    exclusions: [],
    incompleteChecks: [],
    findings: [finding],
    evidenceFiles: Object.entries(entries).map(([path, text]) => ({ path, hash: hash(text) })),
  }
  const previews = new LegalFixPreviews()
  previews.setScan('scan-1', result, '/ws')
  let permissionMode: LegalFixHostState['permissionMode'] = 'manual'
  let isTrusted = true
  let workspacePath = '/ws'
  let wait: Promise<undefined> | undefined
  const apply = vi.fn<LegalFixApplier['apply']>(() =>
    Promise.resolve({ applied: ['src/a.ts'], failed: [] }),
  )
  const patch = {
    path: 'src/a.ts',
    diff: '--- a/src/a.ts\n+++ b/src/a.ts\n@@ -1 +1,2 @@\n+// verified header\n source',
  }
  const state: LegalFixHostState = {
    get permissionMode() {
      return permissionMode
    },
    get isTrusted() {
      return isTrusted
    },
    get workspacePath() {
      return workspacePath
    },
    files: {
      resolveRelativePath: (path) => Promise.resolve(`/ws/${path}`),
      readBytes: async (path) => {
        await wait
        const text = entries[path.slice('/ws/'.length)]
        return text === undefined ? undefined : new TextEncoder().encode(text)
      },
    },
    applier: { prepare: () => Promise.resolve([patch]), apply },
  }
  return {
    previews,
    state,
    entries,
    result,
    apply,
    patch,
    defer: (promise: Promise<undefined>) => {
      wait = promise
    },
    mode: () => {
      permissionMode = 'plan'
    },
    trust: () => {
      isTrusted = false
    },
    workspace: () => {
      workspacePath = '/other'
    },
  }
}

describe('RVM97SW host authorization regressions', () => {
  it('F2 ignores forged browser findings and rejects unknown scan identity', async () => {
    const t = setup()
    const forged = await t.previews.preview(
      { ...request, findings: [{ ...finding, id: 'forged', file: 'src/a.ts' }] },
      t.state,
    )
    expect(forged.eligible).toEqual([])
    expect(forged.excluded).toContainEqual({ id: 'forged', reason: 'unknownFinding' })
    const wrongScan = await t.previews.preview(
      { ...request, scan: { ...request.scan, scanId: 'invented' } },
      t.state,
    )
    expect(wrongScan.refusal).toBe('staleEvidence')
    expect(t.apply).not.toHaveBeenCalled()
  })

  it.each(['LICENSE', 'NOTICE', 'src/a.ts'])(
    'F2 rejects changed supporting evidence %s after preview',
    async (path) => {
      const t = setup()
      const preview = await t.previews.preview(request, t.state)
      t.entries[path] = 'changed'
      expect(
        await t.previews.confirm(
          { type: 'confirmLegalFix', previewId: preview.previewId },
          t.state,
        ),
      ).toMatchObject({ refusal: 'staleEvidence' })
      expect(t.apply).not.toHaveBeenCalled()
    },
  )

  it('F2 source changes before preview never establish a new baseline', async () => {
    const t = setup()
    t.entries['src/a.ts'] = 'changed before preview'
    const preview = await t.previews.preview(request, t.state)
    expect(preview.refusal).toBe('staleEvidence')
  })

  it('F2 vendor paths stay unfixable even in an authoritative result', async () => {
    const t = setup()
    t.previews.setScan(
      'scan-1',
      { ...t.result, findings: [{ ...finding, file: 'vendor/a.ts' }] },
      '/ws',
    )
    const preview = await t.previews.preview(request, t.state)
    expect(preview.eligible).toEqual([])
    expect(preview.excluded).toContainEqual({ id: finding.id, reason: 'notFixable' })
  })

  it('F3 disposing during preview cannot repopulate the store', async () => {
    const t = setup()
    const gate = Promise.withResolvers<undefined>()
    t.defer(gate.promise)
    const pending = t.previews.preview(request, t.state)
    await Promise.resolve()
    t.previews.dispose()
    gate.resolve(undefined)
    const preview = await pending
    expect(preview.refusal).toBe('previewExpired')
    expect(t.previews.size).toBe(0)
  })

  it.each(['dispose', 'mode', 'trust', 'workspace'] as const)(
    'F3 %s during confirm prevents dispatch',
    async (change) => {
      const t = setup()
      const preview = await t.previews.preview(request, t.state)
      const gate = Promise.withResolvers<undefined>()
      t.defer(gate.promise)
      const pending = t.previews.confirm(
        { type: 'confirmLegalFix', previewId: preview.previewId },
        t.state,
      )
      await Promise.resolve()
      if (change === 'dispose') t.previews.dispose()
      else t[change]()
      gate.resolve(undefined)
      const result = await pending
      expect(result.outcome).toBe('refused')
      expect(t.apply).not.toHaveBeenCalled()
    },
  )

  it('F4 one preview dispatches only once under concurrent confirms', async () => {
    const t = setup()
    const preview = await t.previews.preview(request, t.state)
    const confirm = { type: 'confirmLegalFix' as const, previewId: preview.previewId }
    const results = await Promise.all([
      t.previews.confirm(confirm, t.state),
      t.previews.confirm(confirm, t.state),
    ])
    expect(t.apply).toHaveBeenCalledTimes(1)
    expect(results.filter((result) => result.outcome === 'applied')).toHaveLength(1)
  })

  it('F5 applies the exact reviewed patch and passes a live per-write guard', async () => {
    const t = setup()
    const preview = await t.previews.preview(request, t.state)
    expect(preview.patches).toEqual([t.patch])
    t.patch.diff = 'changed after prepare'
    await t.previews.confirm({ type: 'confirmLegalFix', previewId: preview.previewId }, t.state)
    expect(t.apply).toHaveBeenCalledWith(
      [finding],
      ['src/a.ts'],
      preview.patches,
      expect.any(Function),
    )
  })

  it('F5 refuses a writer with no exact patch preparation', async () => {
    const t = setup()
    const state = { ...t.state, applier: { apply: t.apply } }
    const preview = await t.previews.preview(request, state)
    expect(
      await t.previews.confirm({ type: 'confirmLegalFix', previewId: preview.previewId }, state),
    ).toMatchObject({ refusal: 'fixUnavailable' })
    expect(t.apply).not.toHaveBeenCalled()
  })

  it.each([
    { name: 'outside selection', patch: { path: 'vendor/a.ts', diff: '+// header' } },
    { name: 'empty diff', patch: { path: 'src/a.ts', diff: '' } },
    {
      name: 'oversized diff',
      patch: { path: 'src/a.ts', diff: 'x'.repeat(LEGAL_FIX_FILE_READ_MAX_BYTES + 1) },
    },
  ])('F5 refuses prepared patches with $name', async ({ patch }) => {
    const t = setup()
    const preview = await t.previews.preview(request, {
      ...t.state,
      applier: { prepare: () => Promise.resolve([patch]), apply: t.apply },
    })
    expect(preview.refusal).toBe('fixUnavailable')
    expect(t.apply).not.toHaveBeenCalled()
  })

  it.each(['dispose', 'mode', 'trust', 'workspace'] as const)(
    'F3 per-write guard refuses %s after dispatch',
    async (change) => {
      const t = setup()
      const writes: string[] = []
      t.apply.mockImplementation(async (_findings, _paths, _patches, isCurrent) => {
        expect(isCurrent()).toBe(true)
        await Promise.resolve()
        if (change === 'dispose') t.previews.dispose()
        else t[change]()
        if (isCurrent()) writes.push('src/a.ts')
        return { applied: writes, failed: [] }
      })
      const preview = await t.previews.preview(request, t.state)
      await t.previews.confirm({ type: 'confirmLegalFix', previewId: preview.previewId }, t.state)
      expect(writes).toEqual([])
    },
  )
})
