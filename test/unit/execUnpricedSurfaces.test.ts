// EXECPROV round 6 (R4): the unpriced sentence names the runner's own
// providers file on the terminal, where the person can act on it. ACP and
// the editor never see a path: their unpriced sentences carry the model
// alone, so no local path enters a report, a log line or a client-visible
// error field. Each test fails if its sentence gains (or loses) the path.
import { describe, expect, it } from 'vitest'
import { UI_TEXT } from '../../src/shared/constants'
import { fill } from '../../src/shared/l10n/text'

const MODEL = 'local/gpt-x'
const FILE = '/home/person/.config/muse-spark-code/providers.json'

describe('unpriced path surfaces', () => {
  it('the terminal provider sentence names the model and its file', () => {
    const message = fill(UI_TEXT.execUnpricedProvider, { model: MODEL, file: FILE })
    expect(message).toContain(MODEL)
    expect(message).toContain(FILE)
  })

  it('the terminal fallback sentence names no file', () => {
    expect(UI_TEXT.execUnpricedModel).not.toContain('providers.json')
    expect(UI_TEXT.execUnpricedModel).not.toContain('.config')
  })

  it.each([
    ['ACP catalogue', UI_TEXT.execProviderNotCatalogue],
    ['editor session', UI_TEXT.sessionBudgetUnpriced],
  ])('the %s sentence carries the model alone', (_surface, template) => {
    const message = fill(template, { model: MODEL })
    expect(message).toContain(MODEL)
    expect(message).not.toContain('providers.json')
    expect(message).not.toContain('.config')
    expect(message).not.toContain(FILE)
  })

  it('the generic tariff sentence names nothing local', () => {
    expect(UI_TEXT.execModelUnpriced).not.toContain('providers.json')
    expect(UI_TEXT.execModelUnpriced).not.toContain('.config')
  })
})
