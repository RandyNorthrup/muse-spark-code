import { describe, expect, it } from 'vitest'
import {
  IDE_IMAGE_TOOLS,
  IDE_PAID_TOOLS,
  IDE_WEB_FETCH_TOOL,
  WEB_FETCH_TOOLS,
} from '../../src/shared/constants'

describe('train bundle diet', () => {
  it('keeps the literal tool sets in sync with their constants', () => {
    // Literal members so non-fetching bundles drop the sets (a template
    // over the constant pins them instead); this pins the sync.
    expect(WEB_FETCH_TOOLS).toEqual(new Set(['web_fetch', `mcp__ide__${IDE_WEB_FETCH_TOOL}`]))
    expect(IDE_PAID_TOOLS).toEqual(
      new Set([
        `mcp__ide__${IDE_IMAGE_TOOLS.generateImage}`,
        `mcp__ide__${IDE_IMAGE_TOOLS.editImage}`,
      ]),
    )
  })
})
