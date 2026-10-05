// M97 lane S: the project's own license declarations. LICENSE files,
// manifest fields and README sections that agree stay silent; evidence
// that disagrees becomes a conflict, and missing or unrecognized
// declarations stay visible, never clean.

import { describe, expect, it } from 'vitest'
import type { ManifestLicenseDeclaration } from '../../src/core/legal/dependencies'
import { scanProjectLicense } from '../../src/core/legal/projectLicense'
import { snapshotFrom } from './legal/helpers'

const MIT_TEXT = `MIT License

Copyright (c) 2026 Example Corp

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND.`

const APACHE_TEXT = `Apache License
Version 2.0, January 2004
http://www.apache.org/licenses/

Licensed under the Apache License, Version 2.0 (the "License");
you may not use this file except in compliance with the License.`

function manifest(raw: string, file = 'package.json'): ManifestLicenseDeclaration {
  return { raw, file }
}

describe('scanProjectLicense', () => {
  it('stays silent when the license file and manifest agree', () => {
    const result = scanProjectLicense(
      snapshotFrom({
        LICENSE: MIT_TEXT,
        'package.json': JSON.stringify({ name: 'example', license: 'MIT' }),
      }),
      [manifest('MIT')],
    )
    expect(result.findings).toEqual([])
    expect(result.licenses).toEqual(['MIT'])
  })

  it('reports a manifest against file conflict without resolving it', () => {
    const result = scanProjectLicense(
      snapshotFrom({
        LICENSE: APACHE_TEXT,
        'package.json': JSON.stringify({ name: 'example', license: 'MIT' }),
      }),
      [manifest('MIT')],
    )
    const conflict = result.findings.find((finding) => finding.severity === 'should-fix')
    expect(conflict?.category).toBe('license')
    expect(conflict?.explanation).toContain('package.json declares MIT')
    expect(conflict?.explanation).toContain('Apache-2.0')
    expect(conflict?.fixable).toBe(false)
  })

  it('flags malformed manifest expressions', () => {
    const result = scanProjectLicense(snapshotFrom({}), [manifest('MIT or')])
    expect(result.findings).toHaveLength(1)
    expect(result.findings[0]?.severity).toBe('should-fix')
    expect(result.findings[0]?.explanation).toContain('not a well-formed SPDX expression')
  })

  it('reports missing declarations as advice, never as clean', () => {
    const result = scanProjectLicense(snapshotFrom({ 'index.js': 'export default 1' }), [])
    expect(result.findings).toHaveLength(1)
    expect(result.findings[0]?.severity).toBe('advice')
    expect(result.findings[0]?.explanation).toContain('No LICENSE file')
  })

  it('keeps unrecognized license text visible with its excerpt', () => {
    const result = scanProjectLicense(snapshotFrom({ LICENSE: 'The Example License grants nothing yet.' }), [])
    expect(result.findings).toHaveLength(1)
    expect(result.findings[0]?.severity).toBe('advice')
    expect(result.findings[0]?.evidenceExcerpt).toContain('Example License')
  })

  it('treats UNLICENSED as a proprietary declaration, not a gap', () => {
    const result = scanProjectLicense(snapshotFrom({}), [manifest('UNLICENSED')])
    expect(result.findings).toHaveLength(1)
    expect(result.findings[0]?.explanation).toContain('UNLICENSED')
    expect(result.findings.some((finding) => finding.explanation.includes('No LICENSE file'))).toBe(false)
  })

  it('reports a license pointer at an absent file', () => {
    const result = scanProjectLicense(snapshotFrom({}), [manifest('SEE LICENSE IN LICENSE.txt')])
    expect(result.findings).toHaveLength(1)
    expect(result.findings[0]?.severity).toBe('should-fix')
    expect(result.findings[0]?.explanation).toContain('absent from the workspace')
  })

  it('accepts a license pointer at a present file', () => {
    const result = scanProjectLicense(
      snapshotFrom({ 'LICENSE.txt': MIT_TEXT }),
      [manifest('SEE LICENSE IN LICENSE.txt')],
    )
    expect(result.findings).toEqual([])
  })

  it('reads GPL versions and or-later clauses from the text', () => {
    const only = scanProjectLicense(
      snapshotFrom({
        COPYING: 'GNU GENERAL PUBLIC LICENSE\nVersion 2, June 1991\nEveryone is permitted to copy.',
      }),
      [],
    )
    expect(only.licenses).toEqual(['GPL-2.0-only'])
    const later = scanProjectLicense(
      snapshotFrom({
        COPYING:
          'GNU GENERAL PUBLIC LICENSE\nVersion 3, 29 June 2007\nor (at your option) any later version.',
      }),
      [],
    )
    expect(later.licenses).toEqual(['GPL-3.0-or-later'])
  })

  it('reports manifests that disagree with no file to settle it', () => {
    const result = scanProjectLicense(snapshotFrom({}), [manifest('MIT'), manifest('Apache-2.0', 'pyproject.toml')])
    const conflict = result.findings.find((finding) => finding.severity === 'should-fix')
    expect(conflict?.explanation).toContain('disagree')
    expect(conflict?.explanation).toContain('pyproject.toml')
  })

  it('flags a README that contradicts the declarations', () => {
    const result = scanProjectLicense(
      snapshotFrom({
        LICENSE: MIT_TEXT,
        'README.md': '# Example\n\n## License\n\nApache-2.0\n',
      }),
      [manifest('MIT')],
    )
    const conflict = result.findings.find((finding) => finding.file === 'README.md')
    expect(conflict?.severity).toBe('should-fix')
  })

  it('notes a README-only declaration instead of calling it clean', () => {
    const result = scanProjectLicense(
      snapshotFrom({ 'README.md': '# Example\n\n## License\n\nMIT\n' }),
      [],
    )
    expect(result.findings).toHaveLength(1)
    expect(result.findings[0]?.explanation).toContain('only in the README')
  })

  it('attributes nested license files as vendored code', () => {
    const result = scanProjectLicense(
      snapshotFrom({
        LICENSE: MIT_TEXT,
        'vendor/acme/LICENSE': MIT_TEXT,
      }),
      [manifest('MIT')],
    )
    const vendored = result.findings.find((finding) => finding.file === 'vendor/acme/LICENSE')
    expect(vendored?.category).toBe('noticeFile')
    expect(vendored?.explanation).toContain('vendored code needs attribution')
  })

  it('reads an invalid manifest as no declaration, not a crash', () => {
    const result = scanProjectLicense(snapshotFrom({ 'package.json': '{oops' }), [])
    expect(result.findings).toHaveLength(1)
    expect(result.findings[0]?.explanation).toContain('No LICENSE file')
  })
})
