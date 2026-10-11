import { Buffer } from 'node:buffer'
import { afterEach, describe, expect, it } from 'vitest'
import { type VaultBroker } from '../../../src/core/vault/broker/broker'
import { vaultUseDigest } from '../../../src/core/vault/useDigest'
import { WebLoginFill } from '../../../src/core/vault/web/webFill'
import { webOrigin } from '../../../src/core/vault/web/origin'
import { totpCode } from '../../../src/core/vault/web/totp'
import { type WebUseBrokerPort } from '../../../src/core/vault/web/ports'
import { brokerFixture, cleanTaint } from './brokerFixture'
import {
  WEB_ORIGIN,
  webFixture,
  TestWebBrowser,
  webItem,
  privateBytes,
  observeByteOwners,
} from './webFixture'

const httpPage = new URL(WEB_ORIGIN)
httpPage.protocol = 'http:'

const brokers: VaultBroker[] = []
afterEach(async () => {
  for (const broker of brokers.splice(0)) await broker.dispose()
})

describe('vault web fill boundaries', () => {
  it('W-L1 closes a browser when fill starts with an already-aborted signal', async () => {
    const f = await webFixture()
    f.controller.abort()
    await expect(f.fill.fill(f.approved, f.use, f.controller.signal)).rejects.toThrow('useChanged')
    expect(f.browser.close).toHaveBeenCalledOnce()
    expect(f.browser.send).not.toHaveBeenCalled()
  })
  it.each(['certificate error', { valid: true }, 1])(
    'W-L2 refuses a truthy nonboolean certificate observation: %s',
    async (certificateValid) => {
      const f = await webFixture()
      Object.assign(f.browser.facts, { certificateValid })
      await expect(f.fill.describe(WEB_ORIGIN, 'password')).rejects.toThrow('useChanged')
      expect(f.browser.send).not.toHaveBeenCalled()
    },
  )

  it('erases every owned fill buffer after both insertion and a CDP failure', async () => {
    for (const shouldFail of [false, true]) {
      const f = await webFixture()
      const owners = observeByteOwners()
      try {
        if (shouldFail) f.browser.send.mockRejectedValue(new Error('failed insert'))
        const run = f.fill.fill(f.approved, f.use, f.controller.signal)
        if (shouldFail) await expect(run).rejects.toThrow('useChanged')
        else await run
        expect(owners.buffers.length).toBeGreaterThan(0)
        expect(owners.buffers.every((bytes) => bytes.every((byte) => byte === 0))).toBe(true)
      } finally {
        owners.restore()
      }
    }
  })
  it('fills a standalone TOTP item using its algorithm, digits and period', async () => {
    const f = await webFixture()
    f.browser.facts = {
      ...f.browser.facts,
      input: {
        tag: 'INPUT',
        type: 'tel',
        autocomplete: 'one-time-code',
        disabled: false,
        readOnly: false,
      },
    }
    const seed = privateBytes('runtime-generated-test-seed')
    f.item.metadata.kind = 'totp'
    f.item.material = { kind: 'totp', seed, algorithm: 'sha512', digits: 8, periodSeconds: 60 }
    const use = await f.fill.describe(WEB_ORIGIN, 'totp')
    const expected = totpCode(seed, 59_000, f.item.material)
    await f.fill.fill({ ...f.approved, digest: vaultUseDigest(use) }, use, f.controller.signal)
    expect(f.browser.send).toHaveBeenCalledWith(
      'Input.insertText',
      { text: expected.toString() },
      'session-1',
    )
    seed.fill(0)
    expected.fill(0)
  })
  it('refuses incorrect username/code field kinds and missing code autocomplete', async () => {
    for (const field of ['username', 'totp'] as const) {
      const f = await webFixture()
      await expect(f.fill.describe(WEB_ORIGIN, field)).rejects.toThrow('useChanged')
    }
    const f = await webFixture()
    f.browser.facts = {
      ...f.browser.facts,
      input: { tag: 'INPUT', type: 'text', autocomplete: '', disabled: false, readOnly: false },
    }
    await expect(f.fill.describe(WEB_ORIGIN, 'totp')).rejects.toThrow('useChanged')
  })
  it('refuses malformed UTF-8 without silently changing the password', async () => {
    const f = await webFixture()
    if (f.item.material.kind !== 'webLogin') throw new Error('bad fixture')
    f.item.material.password = Buffer.alloc(1, 0xff)
    await expect(f.fill.fill(f.approved, f.use, f.controller.signal)).rejects.toThrow('useChanged')
    expect(f.browser.send).not.toHaveBeenCalled()
  })
  it('returns fixed words even when finish or browser cleanup fails', async () => {
    for (const stage of ['finish', 'close']) {
      const f = await webFixture()
      if (stage === 'finish') f.finish.mockRejectedValue(new Error('private finish detail'))
      else {
        f.browser.close.mockRejectedValue(new Error('private cleanup detail'))
        f.read.mockImplementation(async (_id, _use, run) => {
          f.controller.abort()
          await run(f.item)
        })
      }
      await expect(f.fill.fill(f.approved, f.use, f.controller.signal)).rejects.toThrow(
        /^useChanged$/u,
      )
      expect(f.browser.close).toHaveBeenCalledOnce()
    }
  })
  it('uses only Input.insertText, returns no value and finishes success', async () => {
    const f = await webFixture()
    f.item.material = {
      kind: 'webLogin',
      origins: [WEB_ORIGIN],
      username: privateBytes('generated-user'),
      password: privateBytes('generated-at-runtime'),
      totpSeed: null,
    }
    await f.fill.fill(f.approved, f.use, f.controller.signal)
    expect(f.browser.send).toHaveBeenCalledExactlyOnceWith(
      'Input.insertText',
      { text: 'generated-at-runtime' },
      'session-1',
    )
    expect(f.finish).toHaveBeenCalledWith(f.approved.id, true)
    expect(f.browser.close).not.toHaveBeenCalled()
  })
  it('normalizes Unicode IDNA, case and default ports; preserves exact nondefault ports', () => {
    expect(webOrigin('https://BÜCHER.example:443/path')).toBe('https://xn--bcher-kva.example')
    expect(webOrigin('https://example.test:8443/a')).toBe('https://example.test:8443')
    for (const url of [httpPage.href, 'file:///path', 'https://user:pass@example.test'])
      expect(() => webOrigin(url)).toThrow()
  })
  for (const [name, change] of [
    ['top-level look-alike', { topUrl: 'https://logіn.example.test/login' }],
    ['cross-origin frame', { frameUrl: 'https://other.example.test/login' }],
    ['plain HTTP', { topUrl: `${httpPage.origin}/login` }],
    ['certificate error', { certificateValid: false }],
    ['changed frame id', { frameId: 'frame-2' }],
    ['different port', { frameUrl: 'https://login.example.test:8443/login' }],
    ['no focused input', { input: null }],
    [
      'wrong input kind',
      { input: { tag: 'INPUT', type: 'text', autocomplete: '', disabled: false, readOnly: false } },
    ],
    [
      'disabled input',
      {
        input: {
          tag: 'INPUT',
          type: 'password',
          autocomplete: '',
          disabled: true,
          readOnly: false,
        },
      },
    ],
    [
      'readonly input',
      {
        input: {
          tag: 'INPUT',
          type: 'password',
          autocomplete: '',
          disabled: false,
          readOnly: true,
        },
      },
    ],
    [
      'textarea',
      {
        input: {
          tag: 'TEXTAREA',
          type: 'password',
          autocomplete: '',
          disabled: false,
          readOnly: false,
        },
      },
    ],
  ] as const) {
    it(`refuses ${name} before inserting or reading material`, async () => {
      const f = await webFixture()
      f.browser.facts = { ...f.browser.facts, ...change }
      await expect(f.fill.fill(f.approved, f.use, f.controller.signal)).rejects.toThrow(
        'useChanged',
      )
      expect(f.browser.send).not.toHaveBeenCalled()
      expect(f.read).not.toHaveBeenCalled()
      expect(f.finish).toHaveBeenCalledWith(f.approved.id, false)
    })
  }
  it('checks ticket digest and registered browser identity before redemption', async () => {
    for (const mutate of [() => ({ digest: '0'.repeat(64) }), () => ({})]) {
      const f = await webFixture()
      const approved = { ...f.approved, ...mutate() }
      if (approved.digest === f.approved.digest)
        Object.defineProperty(f.browser, 'browserId', { value: 'e'.repeat(32) })
      await expect(f.fill.fill(approved, f.use, f.controller.signal)).rejects.toThrow('useChanged')
      expect(f.redeem).not.toHaveBeenCalled()
      expect(f.browser.send).not.toHaveBeenCalled()
    }
  })
  it('rechecks live facts after redemption and immediately before insertion', async () => {
    for (const stage of ['redeem', 'material']) {
      const f = await webFixture()
      const change = (): void => {
        f.browser.facts = { ...f.browser.facts, certificateValid: false }
      }
      if (stage === 'redeem')
        f.redeem.mockImplementation((ticket) => {
          change()
          return Promise.resolve({ kind: 'ticket', ticket, authority: { kind: 'user' } })
        })
      else
        f.read.mockImplementation(async (_id, _use, run) => {
          change()
          await run(f.item)
        })
      await expect(f.fill.fill(f.approved, f.use, f.controller.signal)).rejects.toThrow(
        'useChanged',
      )
      expect(f.browser.send).not.toHaveBeenCalled()
      expect(f.finish).toHaveBeenCalledWith(f.approved.id, false)
    }
  })
  it.each(['denied', 'ticket', 'kind', 'origin', 'missing-seed'])(
    'rejects %s redemption or material',
    async (failure) => {
      const f = await webFixture()
      switch (failure) {
        case 'denied': {
          f.redeem.mockResolvedValue({ kind: 'denied', reason: 'locked' })
          break
        }
        case 'ticket': {
          f.redeem.mockResolvedValue({
            kind: 'ticket',
            ticket: { ...f.approved, id: 'f'.repeat(32) },
            authority: { kind: 'user' },
          })
          break
        }
        case 'kind': {
          {
            f.item.material = { kind: 'secret', value: privateBytes('runtime-only') }
            // No default
          }
          break
        }
      }
      if (failure === 'origin' && f.item.material.kind === 'webLogin')
        f.item.material.origins = ['https://elsewhere.test']
      else if (failure === 'missing-seed' && f.item.material.kind === 'webLogin') {
        f.item.material.totpSeed = null
        f.browser.facts = {
          ...f.browser.facts,
          input: {
            tag: 'INPUT',
            type: 'text',
            autocomplete: 'one-time-code',
            disabled: false,
            readOnly: false,
          },
        }
        f.use = await f.fill.describe(WEB_ORIGIN, 'totp')
        f.approved.digest = vaultUseDigest(f.use)
      }
      await expect(f.fill.fill(f.approved, f.use, f.controller.signal)).rejects.toThrow(
        'useChanged',
      )
      expect(f.browser.send).not.toHaveBeenCalled()
    },
  )
  it('fills username and current TOTP while leaving the seed inside material', async () => {
    for (const field of ['username', 'totp'] as const) {
      const f = await webFixture()
      f.browser.facts = {
        ...f.browser.facts,
        input: {
          tag: 'INPUT',
          type: 'text',
          autocomplete: field === 'totp' ? 'one-time-code' : 'username',
          disabled: false,
          readOnly: false,
        },
      }
      const use = await f.fill.describe(WEB_ORIGIN, field)
      if (f.item.material.kind !== 'webLogin' || f.item.material.totpSeed === null)
        throw new Error('bad fixture')
      const seed = Buffer.from(f.item.material.totpSeed)
      const expected =
        field === 'totp'
          ? totpCode(seed, 59_000, { algorithm: 'sha1', digits: 6, periodSeconds: 30 }).toString()
          : Buffer.from(f.item.material.username).toString()
      await f.fill.fill({ ...f.approved, digest: vaultUseDigest(use) }, use, f.controller.signal)
      expect(f.browser.send).toHaveBeenCalledWith(
        'Input.insertText',
        { text: expected },
        'session-1',
      )
      expect(f.item.material.totpSeed).toEqual(seed)
      seed.fill(0)
    }
  })
  it('cancel and broker revoke close the browser before a delayed material callback can dispatch', async () => {
    for (const action of ['cancel', 'revoke']) {
      const f = await webFixture()
      let lifetime: Parameters<WebUseBrokerPort['redeem']>[2] | undefined
      f.broker.redeem = (ticket, _use, owned) => {
        lifetime = owned
        return f.redeem(ticket)
      }
      f.read.mockImplementation(async (_id, _use, run) => {
        if (action === 'cancel') f.controller.abort()
        else lifetime?.close()
        await run(f.item)
      })
      await expect(f.fill.fill(f.approved, f.use, f.controller.signal)).rejects.toThrow(
        'useChanged',
      )
      expect(f.browser.close).toHaveBeenCalledOnce()
      expect(f.browser.send).not.toHaveBeenCalled()
      expect(f.finish).toHaveBeenCalledWith(f.approved.id, false)
    }
  })
  it('returns fixed failure words for CDP and scrub errors rather than their secret-bearing text', async () => {
    const f = await webFixture()
    f.browser.send.mockRejectedValue(new Error('private canary from CDP'))
    await expect(f.fill.fill(f.approved, f.use, f.controller.signal)).rejects.toThrow(
      /^useChanged$/u,
    )
    expect(f.finish).toHaveBeenCalledWith(f.approved.id, false)
  })
  it('real broker approval is single-use, audited, and taint overrides a standing grant', async () => {
    const f = await brokerFixture()
    brokers.push(f.broker)
    const item = webItem()
    item.metadata.id = f.stored.metadata.id
    f.items.set(item.metadata.id, item)
    await f.broker.lock()
    await f.broker.unlock()
    const browser = new TestWebBrowser()
    const port: WebUseBrokerPort = {
      redeem: async (ticket, use, lifetime) =>
        await f.broker.redeem(f.identity.id, ticket, use, lifetime),
      withApprovedMaterial: async (id, use, run) => {
        await f.broker.withApprovedMaterial(id, f.identity.id, use, run)
      },
      finish: async (id, hasSucceeded) => {
        await f.broker.finish(id, hasSucceeded)
      },
    }
    const fill = new WebLoginFill(browser, port, () => f.clock.now())
    const use = await fill.describe(WEB_ORIGIN, 'password')
    const approval = await f.broker.request(f.identity, item.metadata.handle, use, cleanTaint)
    if (approval.kind !== 'approval') throw new Error('no approval')
    const allowed = await f.broker.answer(f.peer, {
      requestId: approval.request.id,
      digest: approval.request.digest,
      decision: 'allowOnce',
    })
    if (allowed.kind !== 'ticket') throw new Error('no ticket')
    await fill.fill(allowed.ticket, use, new AbortController().signal)
    await expect(fill.fill(allowed.ticket, use, new AbortController().signal)).rejects.toThrow()
    expect(browser.send).toHaveBeenCalledOnce()
    const audit = JSON.stringify(f.records)
    expect(audit).not.toContain(
      Buffer.from(item.material.kind === 'webLogin' ? item.material.password : []).toString('utf8'),
    )
    item.metadata.policy.mode = 'alwaysAllow'
    const standing = f.standing()
    standing.target = { kind: 'origin', origin: WEB_ORIGIN }
    await f.broker.lock()
    await f.broker.unlock()
    const tainted = await f.broker.request(f.identity, item.metadata.handle, use, {
      tainted: true,
      reasons: [{ source: 'browser', label: 'page' }],
    })
    expect(tainted.kind).toBe('approval')
  })
})
