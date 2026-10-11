import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
import { describe, expect, it } from 'vitest'
import { SETTING_DEFAULTS } from '../../src/shared/constants'
import { parseHostToWebviewMessage } from '../../src/shared/protocol'

describe('shared webview harness init', () => {
  it('supplies every required setting to the production message validator', () => {
    const html = readFileSync(new URL('../harness/index.html', import.meta.url), 'utf8')
    const literal = /const settings = (\{[\s\S]*?\n {6}\})/.exec(html)?.[1]
    expect(literal).toBeDefined()
    if (literal === undefined) throw new Error('Harness settings fixture is missing')
    const settings: unknown = runInNewContext(`(${literal})`)
    const parsed = parseHostToWebviewMessage({
      type: 'init',
      emptyStateHint: 'Harness empty state',
      composerPlaceholder: 'Harness composer',
      settings,
    })
    expect(parsed.ok).toBe(true)
    if (!parsed.ok || parsed.message.type !== 'init') throw new Error('Harness init was rejected')
    expect(parsed.message.settings['estimator.optimize']).toBe(
      SETTING_DEFAULTS['estimator.optimize'],
    )
  })
})
