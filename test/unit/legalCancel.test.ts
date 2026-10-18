// PR #214 review: the deadline-free legal scan stays cancellable. The
// walk and the scan used to run as one synchronous stretch on the calling
// thread, so a Stop/SIGINT abort (delivered through the event loop) could
// only have arrived before the scan started; the per-entry abort checks
// never saw one mid-run. Both now yield to the loop every
// LEGAL_SCAN_YIELD_EVERY entries, so an abort lands mid-walk and mid-scan.

import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { createLegalSnapshot } from '../../src/core/legal/workspace'
import { scanLegal } from '../../src/core/legal/scan'
import { LegalScanError } from '../../src/core/legal/files'
import { LEGAL_SCAN_YIELD_EVERY } from '../../src/shared/constants'
import { snapshotFrom } from './legal/helpers'

// More entries than one yield slice, so the run provably spans several
// event-loop turns: an abort scheduled before the first turn lands mid-run
// on any machine, however fast its syscalls are.
const TREE_FILES = LEGAL_SCAN_YIELD_EVERY * 40

function scratchTree(): string {
  // The lane's own gitignored temp/, never the OS tmpdir (rig quota).
  const root = path.join(
    process.cwd(),
    'temp',
    `legal-cancel-${String(process.pid)}-${String(Date.now())}`,
  )
  rmSync(root, { recursive: true, force: true })
  for (let index = 0; index < TREE_FILES; index += 1) {
    const dir = path.join(root, `dir${String(index % 40)}`)
    mkdirSync(dir, { recursive: true })
    writeFileSync(path.join(dir, `file${String(index)}.ts`), 'export const value = 1\n')
  }
  return root
}

describe('legal scan cancellation', () => {
  it('ends a filesystem walk at a mid-walk abort', async () => {
    const root = scratchTree()
    try {
      const controller = new AbortController()
      const walk = createLegalSnapshot(root, controller.signal)
      setTimeout(() => {
        controller.abort()
      }, 0)
      await expect(walk).rejects.toThrow(LegalScanError)
      await expect(walk).rejects.toThrow('Legal scan cancelled')
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('still walks the whole tree when nothing aborts', async () => {
    const root = scratchTree()
    try {
      const snapshot = await createLegalSnapshot(root)
      expect(snapshot.files).toHaveLength(TREE_FILES)
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('ends a scan at a mid-scan abort', async () => {
    const files: Record<string, string> = {}
    for (let index = 0; index < TREE_FILES; index += 1) {
      files[`src/file${String(index)}.ts`] = 'export const value = 1\n'
    }
    const controller = new AbortController()
    const scan = scanLegal(snapshotFrom(files), {
      headerPolicy: 'optional',
      signal: controller.signal,
    })
    setTimeout(() => {
      controller.abort()
    }, 0)
    await expect(scan).rejects.toThrow(LegalScanError)
    await expect(scan).rejects.toThrow('Legal scan cancelled')
  })

  it('still scans everything when nothing aborts', async () => {
    const result = await scanLegal(
      snapshotFrom({
        LICENSE: 'MIT License\n\nCopyright (c) 2026 Example Corp\n',
        'package.json': JSON.stringify({ name: 'example', version: '1.0.0', license: 'MIT' }),
        'src/ok.ts':
          '// Copyright (c) 2026 Example Corp\n// SPDX-License-Identifier: MIT\nexport const value = 1\n',
      }),
      { headerPolicy: 'optional' },
    )
    expect(result.findings).toEqual([])
  })
})
