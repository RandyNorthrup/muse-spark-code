import { afterEach, describe, expect, it, vi } from 'vitest'
import type * as SharedConstants from '../../src/shared/constants'
import { scanLegal } from '../../src/core/legal/scan'
import { snapshotFrom } from './legal/helpers'

vi.mock('../../src/shared/constants', async (original) => ({
  ...(await original<typeof SharedConstants>()),
  LEGAL_FILE_MAX_BYTES: 100,
  LEGAL_TOTAL_MAX_BYTES: 200,
  LEGAL_FILES_SCANNED_MAX: 5,
  LEGAL_FINDINGS_PER_RULE_MAX: 2,
  LEGAL_SCAN_TIMEOUT_MS: 10,
}))
afterEach(() => vi.restoreAllMocks())
const options = { headerPolicy: 'off' } as const
function scanned(files: Record<string, string>) {
  return scanLegal(snapshotFrom(files), options)
}

describe('legal matching admission boundaries', () => {
  it('admits exactly the file byte cap and refuses one UTF-8 byte beyond it', () => {
    const exact = scanned({ LICENSE: 'é'.repeat(50) })
    expect(exact.evidenceFiles?.map((entry) => entry.path)).toContain('LICENSE')
    const over = scanned({ LICENSE: `${'é'.repeat(50)}x` })
    expect(over.evidenceFiles).toEqual([])
    expect(over.incompleteChecks.join(' ')).toContain('scan stopped at limit')
  })
  it('counts total UTF-8 bytes once per file and admits the exact total cap', () => {
    const exact = scanned({ LICENSE: 'é'.repeat(50), COPYING: 'é'.repeat(50) })
    expect(exact.evidenceFiles).toHaveLength(2)
    expect(exact.incompleteChecks.join(' ')).not.toContain('bounded text read budget')
    const over = scanned({ LICENSE: 'é'.repeat(50), COPYING: 'é'.repeat(50), 'a.ts': 'x' })
    expect(over.evidenceFiles).toHaveLength(2)
    expect(over.incompleteChecks.join(' ')).toContain('bounded text read budget')
  })
  it('admits exactly the file count cap and names the stopped scan beyond it', () => {
    const files = Object.fromEntries(Array.from({ length: 5 }, (_, i) => [`${String(i)}.ts`, 'x']))
    expect(scanned(files).incompleteChecks.join(' ')).not.toContain('after reading')
    const over = scanned({ ...files, 'extra.ts': 'x' })
    expect(over.evidenceFiles?.length).toBeLessThanOrEqual(5)
    expect(over.incompleteChecks.join(' ')).toContain('after reading 5 files')
  })
  it('keeps exactly the per-rule cap and reports omitted findings', () => {
    const result = scanLegal(snapshotFrom({ 'a.ts': 'x', 'b.ts': 'x', 'c.ts': 'x' }), {
      headerPolicy: 'required',
    })
    expect(result.findings.filter((entry) => entry.id.startsWith('header/'))).toHaveLength(2)
    expect(result.incompleteChecks.join(' ')).toContain('report truncated for header')
  })
  it('stops at the exact time boundary before reading and keeps an honest report', () => {
    const readFile = vi.fn(() => 'x')
    vi.spyOn(Date, 'now').mockReturnValue(10)
    const result = scanLegal({ files: ['a.ts'], readFile }, { ...options, deadline: 10 })
    expect(readFile).not.toHaveBeenCalled()
    expect(result.incompleteChecks.join(' ')).toContain('scan stopped at limit: elapsed time')
    expect(result.evidenceFiles).toEqual([])
  })
  it('admits reads immediately before the time boundary', () => {
    vi.spyOn(Date, 'now').mockReturnValue(9)
    expect(
      scanLegal(snapshotFrom({ LICENSE: 'MIT License' }), { ...options, deadline: 10 })
        .evidenceFiles,
    ).toHaveLength(1)
  })
})
