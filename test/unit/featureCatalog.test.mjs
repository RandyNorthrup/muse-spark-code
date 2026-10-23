import { describe, expect, it } from 'vitest'
import { renderDeviceReference } from '../../scripts/lib/deviceReference.mjs'

const table = { devices: { title: 'Devices', offHelp: 'Off by default' } }
const feature = {
  id: 'devices.setup',
  titleKey: 'title',
  detailKey: 'offHelp',
  availability: 'unshipped',
}
describe('Devices help inventory', () => {
  it('states actual unshipped availability and shared editor limitations', () => {
    expect(renderDeviceReference([feature], table)).toContain(
      '| devices.setup | Devices | Unshipped | Off by default |',
    )
    expect(renderDeviceReference([feature], table)).toContain(
      'remote and headless receivers remain unqualified',
    )
  })
  it.each([
    { ...feature, titleKey: 'missing' },
    { ...feature, detailKey: 'missing' },
    { ...feature, availability: 'supported' },
  ])('refuses an inaccurate or missing catalog fact', (invalid) => {
    expect(() => renderDeviceReference([invalid], table)).toThrow('Invalid Devices catalog entry')
  })
  it('refuses duplicate ids and escapes Markdown table cells', () => {
    expect(() => renderDeviceReference([feature, feature], table)).toThrow(
      'Invalid Devices catalog entry',
    )
    expect(
      renderDeviceReference([feature], { devices: { title: 'A | B', offHelp: 'First\nSecond' } }),
    ).toContain(String.raw`A \| B | Unshipped | First Second`)
  })
})
