import { describe, expect, it } from 'vitest'
import { brokeredEstimateProvider } from '../../src/core/estimator/provision/provider'
import { compareEstimateIds } from '../../src/core/estimator/goal'
import { provisionProvider } from './helpers/estimatorProvisionFixtures'

function insecureOrigin(): string {
  const origin = new URL('https://provider.invalid')
  origin.protocol = 'http:'
  return origin.origin
}

describe('M117 connected vault-brokered provider operations', () => {
  it('exposes exactly five operations and pins the origin before broker dispatch', async () => {
    const fixture = provisionProvider()
    await fixture.provider.sizes()
    await fixture.provider.images()
    expect(Object.keys(fixture.provider).toSorted(compareEstimateIds)).toEqual([
      'apiOrigin',
      'create',
      'delete',
      'endpoints',
      'id',
      'images',
      'sizes',
      'status',
    ])
    expect(
      fixture.requests.map(({ operation, method, url, redirect }) => ({
        operation,
        method,
        url,
        redirect,
      })),
    ).toEqual([
      {
        operation: 'sizes',
        method: 'GET',
        url: `${fixture.fake.apiOrigin}/sizes`,
        redirect: 'error',
      },
      {
        operation: 'images',
        method: 'GET',
        url: `${fixture.fake.apiOrigin}/images`,
        redirect: 'error',
      },
    ])
    expect(
      fixture.requests.every((request) => !('headers' in request) && !('credential' in request)),
    ).toBe(true)
  })

  it.each([
    '/billing',
    '/payments',
    '/sign-up',
    '/accounts',
    '/v1/payment',
    '/v1/account',
    '/SIGN_UP',
  ])('refuses forbidden allow-list path %s before any request', (path) => {
    const fixture = provisionProvider()
    const endpoints = fixture.fake.endpoints.map((entry) =>
      entry.operation === 'create' ? { ...entry, path } : entry,
    )
    expect(() =>
      brokeredEstimateProvider(
        { id: fixture.fake.id, apiOrigin: fixture.fake.apiOrigin, endpoints },
        fixture.broker,
        fixture.codec,
      ),
    ).toThrow()
    expect(fixture.requests).toEqual([])
  })

  it.each([
    '/servers/../billing',
    '/servers/%62illing',
    '//servers',
    '/servers?payment=1',
    '/servers#billing',
    String.raw`/servers\billing`,
    'https://other.invalid/servers',
    '/servers/{id}/extra',
  ])('refuses noncanonical endpoint %s', (path) => {
    const fixture = provisionProvider()
    const endpoints = fixture.fake.endpoints.map((entry) =>
      entry.operation === 'create' ? { ...entry, path } : entry,
    )
    expect(() =>
      brokeredEstimateProvider(
        { id: fixture.fake.id, apiOrigin: fixture.fake.apiOrigin, endpoints },
        fixture.broker,
        fixture.codec,
      ),
    ).toThrow()
    expect(fixture.requests).toEqual([])
  })

  it.each([
    insecureOrigin(),
    'https://user:pass@provider.invalid',
    'https://provider.invalid/path',
    'https://provider.invalid?token=x',
    'https://provider.invalid#fragment',
  ])('refuses unpinned origin %s', (apiOrigin) => {
    const fixture = provisionProvider()
    expect(() =>
      brokeredEstimateProvider(
        { id: fixture.fake.id, apiOrigin, endpoints: fixture.fake.endpoints },
        fixture.broker,
        fixture.codec,
      ),
    ).toThrow()
  })

  it('requires every operation exactly once with its prescribed method', () => {
    const fixture = provisionProvider()
    const binding = { id: fixture.fake.id, apiOrigin: fixture.fake.apiOrigin }
    for (const endpoints of [
      fixture.fake.endpoints.slice(1),
      [...fixture.fake.endpoints, ...fixture.fake.endpoints],
      fixture.fake.endpoints.map((entry) => ({ ...entry, method: 'GET' as const })),
    ]) {
      expect(() =>
        brokeredEstimateProvider({ ...binding, endpoints }, fixture.broker, fixture.codec),
      ).toThrow()
    }
  })

  it('refuses repeated operations even when the allow-list length is correct', () => {
    const fixture = provisionProvider()
    const endpoints = fixture.fake.endpoints.map((entry) =>
      entry.operation === 'images' ? { ...entry, operation: 'sizes' as const } : entry,
    )
    expect(() =>
      brokeredEstimateProvider(
        { id: fixture.fake.id, apiOrigin: fixture.fake.apiOrigin, endpoints },
        fixture.broker,
        fixture.codec,
      ),
    ).toThrow('allow-list')
  })

  it('requires the server ID as exactly one final status/delete segment', () => {
    const fixture = provisionProvider()
    for (const path of ['/servers', '/servers/{id}/{id}', '/servers/{id}/extra']) {
      const endpoints = fixture.fake.endpoints.map((entry) =>
        entry.operation === 'status' ? { ...entry, path } : entry,
      )
      expect(() =>
        brokeredEstimateProvider(
          { id: fixture.fake.id, apiOrigin: fixture.fake.apiOrigin, endpoints },
          fixture.broker,
          fixture.codec,
        ),
      ).toThrow('allow-list')
    }
  })

  it('rejects malformed and duplicate sizes/images after the captured codec projection', async () => {
    const fixture = provisionProvider()
    fixture.broker.request.mockResolvedValueOnce({
      url: `${fixture.fake.apiOrigin}/sizes`,
      status: 200,
      body: [fixture.fake.size, fixture.fake.size],
    })
    await expect(fixture.provider.sizes()).rejects.toThrow('sizes')
    fixture.broker.request.mockResolvedValueOnce({
      url: `${fixture.fake.apiOrigin}/images`,
      status: 200,
      body: [fixture.fake.image, fixture.fake.image],
    })
    await expect(fixture.provider.images()).rejects.toThrow('images')
    fixture.broker.request.mockResolvedValueOnce({
      url: `${fixture.fake.apiOrigin}/images`,
      status: 200,
      body: [{ ...fixture.fake.image, architecture: 'unknown' }],
    })
    await expect(fixture.provider.images()).rejects.toThrow('images')
    fixture.broker.request.mockResolvedValueOnce({
      url: `${fixture.fake.apiOrigin}/sizes`,
      status: 200,
      body: 'private body',
    })
    await expect(fixture.provider.sizes()).rejects.toThrow('Provider operation refused: sizes')
  })

  it('rechecks connection at every request and never reads a credential', async () => {
    const fixture = provisionProvider()
    await fixture.provider.sizes()
    fixture.disconnect()
    await expect(fixture.provider.images()).rejects.toThrow('images')
    expect(fixture.requests).toHaveLength(1)
  })

  it.each(['../billing', '%2faccounts', 'x/y', String.raw`x\y`, 'https://evil.invalid'])(
    'refuses an injected server ID %s before broker dispatch',
    async (id) => {
      const fixture = provisionProvider()
      await expect(fixture.provider.status(id)).rejects.toThrow()
      await expect(fixture.provider.delete(id)).rejects.toThrow()
      expect(fixture.requests).toEqual([])
    },
  )

  it.each([
    { status: 302, url: 'https://other.invalid/billing' },
    { status: 200, url: 'https://other.invalid/sizes' },
    { status: 200, url: 'https://estimator-provider.invalid/accounts' },
    { status: 401, url: 'https://estimator-provider.invalid/sizes' },
  ])('refuses redirect or failed receipt $status $url', async (receipt) => {
    const fixture = provisionProvider()
    fixture.broker.request.mockResolvedValue({ ...receipt, body: [] })
    await expect(fixture.provider.sizes()).rejects.toThrow('sizes')
  })

  it('suppresses raw broker errors and validates normalized response boundaries', async () => {
    const fixture = provisionProvider()
    fixture.broker.request.mockRejectedValueOnce(new Error('private account /user/profile'))
    await expect(fixture.provider.sizes()).rejects.toThrow('Provider operation refused: sizes')
    fixture.broker.request.mockResolvedValue({
      url: `${fixture.fake.apiOrigin}/sizes`,
      status: 200,
      body: [{ id: 'size', classId: 'class', hourlyUsd: -1 }],
    })
    await expect(fixture.provider.sizes()).rejects.toThrow()
  })

  it('validates create, identity-matched status and deletion acceptance', async () => {
    const fixture = provisionProvider()
    const server = { id: 'server-1', sizeId: 'small', imageId: 'container', state: 'running' }
    fixture.broker.request.mockResolvedValueOnce({
      url: `${fixture.fake.apiOrigin}/servers`,
      status: 201,
      body: server,
    })
    expect(
      await fixture.provider.create(fixture.fake.size, fixture.fake.image, '#cloud-config'),
    ).toEqual(server)
    expect(fixture.requests).toEqual([]) // The mock replaces recording; inspect its exact request instead.
    expect(fixture.broker.request).toHaveBeenLastCalledWith({
      providerId: 'fake-provider',
      operation: 'create',
      method: 'POST',
      url: `${fixture.fake.apiOrigin}/servers`,
      redirect: 'error',
      body: { size: fixture.fake.size, image: fixture.fake.image, cloudInit: '#cloud-config' },
    })
    fixture.broker.request.mockResolvedValueOnce({
      url: `${fixture.fake.apiOrigin}/servers/server-1`,
      status: 200,
      body: server,
    })
    expect(await fixture.provider.status('server-1')).toEqual(server)
    fixture.broker.request.mockResolvedValueOnce({
      url: `${fixture.fake.apiOrigin}/servers/server-1`,
      status: 200,
      body: { ...server, id: 'other' },
    })
    await expect(fixture.provider.status('server-1')).rejects.toThrow('status')
    fixture.broker.request.mockResolvedValueOnce({
      url: `${fixture.fake.apiOrigin}/servers/server-1`,
      status: 200,
      body: { accepted: true },
    })
    await fixture.provider.delete('server-1')
    fixture.broker.request.mockResolvedValueOnce({
      url: `${fixture.fake.apiOrigin}/servers/server-1`,
      status: 200,
      body: {},
    })
    await expect(fixture.provider.delete('server-1')).rejects.toThrow('delete')
  })

  it('rejects wrong create identities, invalid states and empty installation data', async () => {
    const fixture = provisionProvider()
    const server = { id: 'server-1', sizeId: 'small', imageId: 'container', state: 'running' }
    for (const body of [
      { ...server, sizeId: 'other' },
      { ...server, imageId: 'other' },
      { ...server, state: 'deleted' },
      { ...server, id: '../billing' },
      { ...server, id: 'server.1' },
      { ...server, id: 'server:1' },
    ]) {
      fixture.broker.request.mockResolvedValueOnce({
        url: `${fixture.fake.apiOrigin}/servers`,
        status: 201,
        body,
      })
      await expect(
        fixture.provider.create(fixture.fake.size, fixture.fake.image, '#cloud-config'),
      ).rejects.toThrow('create')
    }
    const calls = fixture.broker.request.mock.calls.length
    await expect(
      fixture.provider.create(fixture.fake.size, fixture.fake.image, ' '),
    ).rejects.toThrow('create')
    expect(fixture.broker.request).toHaveBeenCalledTimes(calls)
  })

  it.each(['payment_method', 'creditCard', 'card_number', 'billing', 'accountId'])(
    'never sends payment or account field %s',
    async (key) => {
      const fixture = provisionProvider()
      fixture.codec.createBody = () => ({ server: { [key]: 'fictional-value' } })
      await expect(
        fixture.provider.create(fixture.fake.size, fixture.fake.image, '#cloud-config'),
      ).rejects.toThrow('create')
      expect(fixture.broker.request).not.toHaveBeenCalled()
    },
  )
})
