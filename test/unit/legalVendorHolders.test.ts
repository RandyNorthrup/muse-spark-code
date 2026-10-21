import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { identifyLicenseText } from '../../src/core/legal/projectLicense'
import { RESTRICTION_SENTENCES } from './legal/templateSlots'

const ROOT = path.join(__dirname, '../..')
const VENDORS = [
  ['@muse-code/sdk', 'MIT'],
  ['highlight.js', 'BSD-3-Clause'],
  ['lz-string', 'MIT'],
  ['parse5', 'MIT'],
  ['react', 'MIT'],
  ['react-dom', 'MIT'],
  ['scheduler', 'MIT'],
  ['smol-toml', 'BSD-3-Clause'],
] as const
const FORMS = [
  {
    name: 'and affiliates.',
    package: 'react',
    holder: 'Meta Platforms, Inc.',
    suffix: ' and affiliates.',
  },
  { name: 'terminal name period', package: 'highlight.js', holder: 'Ivan Sagalaev', suffix: '.' },
  {
    name: 'parenthesized contact pair',
    package: 'parse5',
    holder: 'Ivan Nikulin',
    suffix: ' (ifaaan@gmail.com, https://github.com/inikulin)',
  },
  { name: 'et al.', package: 'smol-toml', holder: 'Squirrel Chat', suffix: ' et al.' },
]

function licence(name: string): string {
  return readFileSync(path.join(ROOT, 'node_modules', name, 'LICENSE'), 'utf8')
}

describe('real shipped vendor holder forms', () => {
  it.each(VENDORS)('reads the real %s text as %s with its strict holder result', (name, id) => {
    expect(identifyLicenseText(licence(name))).toMatchObject({ id, exact: name !== 'lz-string' })
  })

  it.each(FORMS)('keeps restrictions in the $name form under review', (form) => {
    const real = licence(form.package)
    for (const restriction of RESTRICTION_SENTENCES) {
      const changed = real.replace(form.holder, () => restriction)
      expect(identifyLicenseText(changed)?.exact, `${form.name}: ${restriction}`).not.toBe(true)
    }
  })

  it.each([
    'Example and selected beneficiaries.',
    'Example et selected parties.',
    'Example (Contact The Author For Permission)',
    'Example (ifaaan@gmail.com, https://github.com/inikulin) Restricted',
    'Example. A Further Condition Applies.',
    'Different Terms Govern This Work.',
    'Further Conditions Apply To Distribution.',
  ])('keeps an unlisted holder form under review: %s', (holder) => {
    const text = licence('react').replace('Meta Platforms, Inc. and affiliates.', () => holder)
    expect(identifyLicenseText(text)?.exact).not.toBe(true)
  })
})
