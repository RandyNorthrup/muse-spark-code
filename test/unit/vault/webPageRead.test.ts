/** @vitest-environment jsdom */
import { Buffer } from 'node:buffer'
import { describe, expect, it } from 'vitest'
import { VAULT_LIMITS } from '../../../src/shared/constants'
import { readWebPage } from '../../../src/core/vault/web/pageRead'
import { WEB_ORIGIN, webFixture } from './webFixture'

describe('vault masked page reads', () => {
  it('maps an invalid target URL to fixed words before reading or scrubbing', async () => {
    const f = await webFixture()
    f.browser.facts = { ...f.browser.facts, topUrl: 'private invalid target' }
    await expect(
      f.browser.withTarget(
        WEB_ORIGIN,
        null,
        async (target) => await readWebPage(target, () => Promise.resolve('unused')),
      ),
    ).rejects.toThrow(/^useChanged$/u)
    expect(f.browser.send).not.toHaveBeenCalled()
  })
  it('refuses malformed, exceptional or oversized CDP answers before scrub or return', async () => {
    for (const answer of [
      { result: { value: 1 } },
      { result: { value: 'text' }, exceptionDetails: {} },
      { result: { value: 'x'.repeat(VAULT_LIMITS.frameBytes + 1) } },
    ]) {
      const f = await webFixture()
      f.browser.send.mockResolvedValue(answer)
      let hasScrubbed = false
      await expect(
        f.browser.withTarget(
          WEB_ORIGIN,
          null,
          async (target) =>
            await readWebPage(target, (text) => {
              hasScrubbed = true
              return Promise.resolve(text)
            }),
        ),
      ).rejects.toThrow(/^useChanged$/u)
      expect(hasScrubbed).toBe(false)
    }
  })
  it('refuses a navigation during the scrub await', async () => {
    const f = await webFixture()
    f.browser.send.mockResolvedValue({ result: { value: 'page' } })
    await expect(
      f.browser.withTarget(
        WEB_ORIGIN,
        null,
        async (target) =>
          await readWebPage(target, (text) => {
            f.browser.facts = { ...f.browser.facts, frameUrl: 'https://other.test' }
            return Promise.resolve(text)
          }),
      ),
    ).rejects.toThrow(/^useChanged$/u)
  })
  it('never reads password fields and scrubs a value copied by the page into DOM text', async () => {
    const f = await webFixture()
    const canary = Buffer.from(
      f.item.material.kind === 'webLogin' ? f.item.material.password : [],
    ).toString('utf8')
    document.body.innerHTML =
      '<input type="password"><textarea>hidden</textarea><script>hidden</script><p></p>'

    const input = document.querySelector('input')
    Object.defineProperty(input, 'value', {
      get: () => {
        throw new Error('password read')
      },
    })
    const paragraph = document.querySelector('p')
    if (paragraph === null) throw new Error('bad fixture')
    paragraph.textContent = `copied ${canary}`
    f.browser.send.mockImplementation((_method, params) => {
      if (typeof params?.['expression'] !== 'string') throw new Error('bad expression')
      const value: unknown = globalThis.eval(params['expression'])
      return Promise.resolve({ result: { value } })
    })
    try {
      const output = await f.browser.withTarget(
        WEB_ORIGIN,
        null,
        async (target) =>
          await readWebPage(target, (text) =>
            Promise.resolve(text.replaceAll(canary, '[redacted]')),
          ),
      )
      expect(output).toBe('copied [redacted]')
      expect(f.browser.send).toHaveBeenCalledWith(
        'Runtime.evaluate',
        expect.objectContaining({ contextId: 1 }),
        'session-1',
      )
      await expect(
        f.browser.withTarget(
          WEB_ORIGIN,
          null,
          async (target) => await readWebPage(target, () => Promise.reject(new Error(canary))),
        ),
      ).rejects.toThrow(/^useChanged$/u)
    } finally {
      document.body.replaceChildren()
    }
  })
})
