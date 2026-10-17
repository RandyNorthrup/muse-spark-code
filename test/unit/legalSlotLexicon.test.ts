import { describe, expect, it } from 'vitest'
import { identifyLicenseText } from '../../src/core/legal/projectLicense'
import { FULL_MIT_LICENSE } from './legal/helpers'
import { RESTRICTION_WORD_FIXTURE } from './legal/restrictionWords'

describe('packed multilingual slot lexicon', () => {
  it.each(RESTRICTION_WORD_FIXTURE)(
    'keeps restriction word %s under review without punctuation',
    (word) => {
      const holder = `Example ${word.toUpperCase()}`
      const text = FULL_MIT_LICENSE.replace(
        'Copyright (c) 2026 Example Corp',
        () => `Copyright 2026 ${holder}`,
      )
      expect(identifyLicenseText(text)?.exact, holder).toBe(false)
    },
  )
})
