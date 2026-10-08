import { afterEach, describe, expect, it } from 'vitest'
import { SCHEDULE_DELIVERIES, SCHEDULE_FIRE_OUTCOMES } from '../../src/shared/constants'
import { SCHEDULE_EVENT_KINDS } from '../../src/shared/scheduleEvents'
import { EN } from '../../src/shared/l10n/en'
import { fill, plural, setUiText, UI_TEXT } from '../../src/shared/l10n/text'
import { formatUsd } from '../../src/shared/l10n/exactUsd'
import { installGerman } from './helpers/germanTable'
import { FakeLogOutputChannel } from './helpers/fakes'

afterEach(() => {
  setUiText(EN, 'en')
})

describe('schedule text contract', () => {
  it('names every delivery, outcome and event kind for the consuming lanes', () => {
    expect(
      Object.keys(UI_TEXT.scheduleV2.delivery).toSorted((left, right) => left.localeCompare(right)),
    ).toEqual([...SCHEDULE_DELIVERIES].toSorted((left, right) => left.localeCompare(right)))
    expect(
      Object.keys(UI_TEXT.scheduleV2.outcomes).toSorted((left, right) => left.localeCompare(right)),
    ).toEqual([...SCHEDULE_FIRE_OUTCOMES].toSorted((left, right) => left.localeCompare(right)))
    expect(
      Object.keys(UI_TEXT.scheduleV2.events).toSorted((left, right) => left.localeCompare(right)),
    ).toEqual([...SCHEDULE_EVENT_KINDS].toSorted((left, right) => left.localeCompare(right)))
  })

  it('reads the installed language at use time and names price, cap and shared budget', async () => {
    expect(await installGerman(new FakeLogOutputChannel())).toBe('de')
    expect(UI_TEXT.scheduleV2.delivery.whenIdle).toBe('Neuer Durchgang bei Leerlauf')
    const consent = fill(UI_TEXT.scheduleV2.messages.paidConsent, {
      prompt: 'Check',
      model: 'model-1',
      price: 'rate-1',
      cadence: 'weekly',
      cap: formatUsd(1, 2),
      budget: formatUsd(2, 2),
    })
    for (const value of ['Check', 'model-1', 'rate-1', 'weekly', formatUsd(1, 2), formatUsd(2, 2)])
      expect(consent).toContain(value)
    expect(consent).not.toMatch(/\{\w+\}/)
    expect(plural(UI_TEXT.scheduleV2.endAfterRuns, 2)).toBe('Nach 2 Ausführungen beenden')
    expect(plural(UI_TEXT.scheduleV2.historyPreview, 2, { days: 7 })).toBe(
      'Wäre 2 Mal in 7 Tagen gelaufen',
    )
    expect(fill(UI_TEXT.scheduleV2.messages.setBy, { agent: 'lead', session: 'session-1' })).toBe(
      'Von lead in session-1 eingerichtet',
    )
  })
})
