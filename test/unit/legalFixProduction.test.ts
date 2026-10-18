import { describe, expect, it } from 'vitest'
import { prepareLegalHeaderPatches } from '../../src/core/legal/headerFix'
import {
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
})

it('scrubs confidential patch context and refuses dependency files', () => {
  const selected = [finding('src/a.py')]
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
