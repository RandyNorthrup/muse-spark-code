import { fingerprint } from '../../src/core/verify/fingerprint'
import { describe, expect, it, vi } from 'vitest'
import { prepareLegalHeaderPatches } from '../../src/core/legal/headerFix'
import { createLegalFixApplier } from '../../src/host/legalFixApplier'
import {
  UI_TEXT,
  LEGAL_ATTRIBUTION_STRESS_CHARS,
  LEGAL_ATTRIBUTION_PARSE_BUDGET_MS,
} from '../../src/shared/constants'
import type { LegalFinding } from '../../src/shared/legal'
import { snapshotFrom } from './legal/helpers'

const finding = (file: string): LegalFinding => ({
  id: `header/${file}`,
  severity: 'should-fix',
  category: 'codeQualityHeader',
  file,
  evidenceSource: 'header reader',
  confidence: 1,
  explanation: 'Missing header',
  recommendation: 'Add verified header',
  fixable: true,
})
const source = '\u{FEFF}#!/usr/bin/env python3\r\nprint("hello")\r\n'
const fixture = () =>
  snapshotFrom({
    LICENSE:
      'MIT License\nCopyright (c) 2020 Example Authors\nPermission is hereby granted, free of charge',
    'src/a.py': source,
    'src/b.py': 'print("other")\n',
    'vendor/a.py': source,
  })
function setup() {
  const write = vi
    .fn<Parameters<typeof createLegalFixApplier>[0]['write']>()
    .mockResolvedValue(true)
  const approveOwnership = vi
    .fn<(paths: readonly string[]) => Promise<boolean>>()
    .mockResolvedValue(true)
  const readHash = vi
    .fn<(path: string) => Promise<string | undefined>>()
    .mockImplementation((path) => Promise.resolve(fingerprint(fixture().readFile(path) ?? '')))
  const applier = createLegalFixApplier({
    prepare: (findings) => Promise.resolve(prepareLegalHeaderPatches(fixture(), findings)),
    approveOwnership,
    readHash,
    write,
  })
  return { applier, write, approveOwnership, readHash }
}

describe('production selected header fixes', () => {
  it('prepares an actual patch from project evidence, retaining BOM, shebang, EOL and old year', () => {
    const [entry] = prepareLegalHeaderPatches(fixture(), [finding('src/a.py')])
    expect(entry?.before).toBe(source)
    expect(entry?.after).toBe(
      '\u{FEFF}#!/usr/bin/env python3\r\n# Copyright (c) 2020 Example Authors\r\n# SPDX-License-Identifier: MIT\r\nprint("hello")\r\n',
    )
    expect(entry?.patch.diff).toContain('+# SPDX-License-Identifier: MIT')
    expect(entry?.patch.diff).toContain('+# Copyright (c) 2020 Example Authors')
  })
  it('refuses unsupported syntax, dependency material, existing foreign headers and unknown ownership', () => {
    const snapshot = snapshotFrom({
      LICENSE: 'MIT License',
      'src/a.py': source,
      'src/b.py': '# Copyright (c) 2018 Someone Else\nprint("other")',
      'src/x.css': 'body {}',
    })
    expect(prepareLegalHeaderPatches(snapshot, [finding('src/a.py')])).toEqual([])
    expect(
      prepareLegalHeaderPatches(fixture(), [{ ...finding('src/a.py'), packageName: 'dependency' }]),
    ).toEqual([])
    expect(
      prepareLegalHeaderPatches(
        snapshotFrom({
          ...Object.fromEntries(fixture().files.map((file) => [file, fixture().readFile(file)])),
          'src/b.py': '# Copyright (c) 2018 Someone Else\nprint("other")',
        }),
        [finding('src/b.py')],
      ),
    ).toEqual([])
    const knownProject = snapshotFrom({
      LICENSE: fixture().readFile('LICENSE') ?? '',
      'src/x.css': 'body {}',
      'src/x.ts': 'export const value = 1\n',
    })
    expect(prepareLegalHeaderPatches(knownProject, [finding('src/x.css')])).toEqual([])
    expect(prepareLegalHeaderPatches(knownProject, [finding('src/x.ts')])[0]?.after).toContain(
      '// SPDX-License-Identifier: MIT',
    )
  })
  it('writes only the exact prepared selection after explicit ownership approval', async () => {
    const { applier, write, approveOwnership } = setup()
    const selected = [finding('src/a.py')]
    const patches = (await applier.prepare?.(selected, ['src/a.py'])) ?? []
    const result = await applier.apply(selected, ['src/a.py'], patches, () => true)
    expect(approveOwnership).toHaveBeenCalledWith(['src/a.py'])
    expect(write).toHaveBeenCalledOnce()
    expect(write.mock.calls[0]?.slice(0, 2)).toEqual(['src/a.py', source])
    expect(result).toEqual({ applied: ['src/a.py'], failed: [] })
  })
  it('denial, changed preview and live admission loss each prevent publication', async () => {
    for (const scenario of ['denied', 'stale', 'expired']) {
      const { applier, write, approveOwnership } = setup()
      const selected = [finding('src/a.py')]
      const patches = (await applier.prepare?.(selected, ['src/a.py'])) ?? []
      if (scenario === 'denied') approveOwnership.mockResolvedValue(false)
      const shown =
        scenario === 'stale' ? patches.map((patch) => ({ ...patch, diff: 'forged' })) : patches
      const result = await applier.apply(
        selected,
        ['src/a.py'],
        shown,
        () => scenario !== 'expired',
      )
      expect(write).not.toHaveBeenCalled()
      expect(result.failed).toHaveLength(1)
    }
  })
  it('rechecks admission between patches and reports per-file failures', async () => {
    const { applier, write } = setup()
    const selected = [finding('src/a.py'), finding('src/b.py')]
    const paths = ['src/a.py', 'src/b.py']
    const patches = (await applier.prepare?.(selected, paths)) ?? []
    let isCurrent = true
    write.mockImplementation(() => {
      isCurrent = false
      return Promise.resolve(true)
    })
    const result = await applier.apply(selected, paths, patches, () => isCurrent)
    expect(write).toHaveBeenCalledOnce()
    expect(result).toEqual({
      applied: ['src/a.py'],
      failed: [{ path: 'src/b.py', reason: UI_TEXT.legalFixRefusedExpired }],
    })
  })
})

it('refuses evidence changes during ownership approval and scrubs confidential patch context', async () => {
  const { applier, readHash, write } = setup()
  const selected = [finding('src/a.py')]
  const patches = (await applier.prepare?.(selected, ['src/a.py'])) ?? []
  readHash.mockResolvedValue('changed')
  const result = await applier.apply(selected, ['src/a.py'], patches, () => true)
  expect(result.failed).toHaveLength(1)
  expect(write).not.toHaveBeenCalled()
  const snapshot = fixture()
  expect(
    prepareLegalHeaderPatches(
      snapshotFrom({
        LICENSE: snapshot.readFile('LICENSE') ?? '',
        'src/a.py': 'contact = "person@example.invalid"\n',
      }),
      selected,
    ),
  ).toEqual([])
  expect(
    prepareLegalHeaderPatches(snapshot, [{ ...finding('src/a.py'), file: 'vendor/a.py' }]),
  ).toEqual([])
})

it('keeps a Python encoding cookie in its required position', () => {
  const [entry] = prepareLegalHeaderPatches(
    snapshotFrom({
      LICENSE: fixture().readFile('LICENSE') ?? '',
      'src/a.py': '#!/usr/bin/env python3\n# coding: utf-8\nprint("hello")\n',
    }),
    [finding('src/a.py')],
  )
  expect(entry?.after.startsWith('#!/usr/bin/env python3\n# coding: utf-8\n# Copyright')).toBe(true)
})

it('does not turn untrusted copyright metadata into source syntax', () => {
  for (const holder of ['2020 Owner\u{2028}injected()', String.raw`2020 Owner\u000ainjected()`]) {
    expect(
      prepareLegalHeaderPatches(
        snapshotFrom({
          LICENSE: `MIT License\nCopyright (c) ${holder}`,
          'src/a.java': 'class Example {}\n',
        }),
        [finding('src/a.java')],
      ),
    ).toEqual([])
  }
})

it('keeps protected instructions and hooks outside header batch authorization', () => {
  expect(
    prepareLegalHeaderPatches(
      snapshotFrom({
        LICENSE: fixture().readFile('LICENSE') ?? '',
        '.agents/hooks/check.py': 'print("hook")\n',
      }),
      [finding('.agents/hooks/check.py')],
    ),
  ).toEqual([])
})

it('bounds malformed attribution whitespace in both license and source headers', () => {
  const malformed = `Copyright${' '.repeat(LEGAL_ATTRIBUTION_STRESS_CHARS)}not-a-year`
  const started = performance.now()
  expect(
    prepareLegalHeaderPatches(
      snapshotFrom({
        LICENSE: `MIT License\n${malformed}`,
        'src/a.py': source,
      }),
      [finding('src/a.py')],
    ),
  ).toEqual([])
  expect(
    prepareLegalHeaderPatches(
      snapshotFrom({
        LICENSE: fixture().readFile('LICENSE') ?? '',
        'src/a.py': `# ${malformed}\nprint("hello")\n`,
      }),
      [finding('src/a.py')],
    ),
  ).toHaveLength(1)
  expect(performance.now() - started).toBeLessThan(LEGAL_ATTRIBUTION_PARSE_BUDGET_MS)
})
