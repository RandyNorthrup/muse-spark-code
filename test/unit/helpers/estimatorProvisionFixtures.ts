import { vi } from 'vitest'
import {
  brokeredEstimateProvider,
  type EstimateBrokerRequest,
  type EstimateProviderCodec,
} from '../../../src/core/estimator/provision/provider'
import { FakeEstimateProvider, FakeEstimateNode } from './estimator/fakes'

/** Fictional provider bodies only; not a captured service protocol. */
export function provisionProvider() {
  const fake = new FakeEstimateProvider()
  let isConnected = true
  const requests: EstimateBrokerRequest[] = []
  const codec: EstimateProviderCodec = {
    createBody: (size, image, cloudInit) => ({ size, image, cloudInit }),
    decode: (_operation, body) => body,
  }
  const request = vi.fn((input: EstimateBrokerRequest): Promise<unknown> => {
    requests.push(input)
    const path = new URL(input.url).pathname
    fake.request(input.method, path)
    return Promise.resolve({ url: input.url, status: 200, body: [] })
  })
  const broker = {
    isConnected: () => isConnected,
    request,
  }
  const provider = brokeredEstimateProvider(fake, broker, codec)
  return {
    fake,
    provider,
    broker,
    codec,
    requests,
    disconnect: () => {
      isConnected = false
    },
    node: new FakeEstimateNode(),
  }
}

export function pending<T>() {
  return Promise.withResolvers<T>()
}
