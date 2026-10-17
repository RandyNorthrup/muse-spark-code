import * as z from 'zod/mini'
import {
  HTTP_SUCCESS_MIN,
  HTTP_SUCCESS_MAX,
  HTTP_STATUS_MAX,
  ESTIMATE_MAX_ITEMS,
  UI_TEXT,
} from '../../../shared/constants'
import { fill } from '../../../shared/l10n/text'
import {
  providerSizeSchema,
  providerImageSchema,
  provisionedServerSchema,
  type EstimateProviderEndpoint,
  type EstimateProviderOperation,
  type EstimateProviderPort,
  type ProviderSize,
  type ProviderImage,
} from '../../../shared/estimate'

export interface EstimateBrokerRequest {
  readonly providerId: string
  readonly operation: EstimateProviderOperation
  readonly method: EstimateProviderEndpoint['method']
  readonly url: string
  readonly redirect: 'error'
  readonly body?: unknown
}

/** M109 owns the origin-bound credential. It MUST reject redirects before
 * dispatch, enforce this request's scope and scrub all returned bodies.
 * Neither a credential value nor a credential-bearing header crosses here.
 */
export interface EstimateProviderBroker {
  isConnected(providerId: string, apiOrigin: string): boolean
  request(request: EstimateBrokerRequest): Promise<unknown>
}

/** Concrete adapters supply captured-wire parsers/encoders. These are not
 * guessed HTTP response shapes: decode returns normalized application data.
 */
export interface EstimateProviderCodec {
  createBody(size: ProviderSize, image: ProviderImage, cloudInit: string): unknown
  decode(operation: EstimateProviderOperation, body: unknown): unknown
}

const METHODS: Record<EstimateProviderOperation, EstimateProviderEndpoint['method']> = {
  sizes: 'GET',
  images: 'GET',
  create: 'POST',
  status: 'GET',
  delete: 'DELETE',
}
const serverIdSchema = z.string().check(z.regex(/^[A-Za-z0-9_-]+$/))
const endpointSchema = z.strictObject({
  operation: z.enum(['sizes', 'images', 'create', 'status', 'delete']),
  method: z.enum(['GET', 'POST', 'DELETE']),
  path: z.string(),
})
const bindingSchema = z.strictObject({
  id: serverIdSchema,
  apiOrigin: z.url(),
  endpoints: z.array(endpointSchema),
})
// A normalized broker receipt, not a service-specific wire envelope.
const receiptSchema = z.strictObject({
  url: z.url(),
  status: z.number().check(z.int(), z.minimum(100), z.maximum(HTTP_STATUS_MAX)),
  body: z.unknown(),
})
const forbidden = new Set(['billing', 'payment', 'payments', 'signup', 'account', 'accounts'])
const paymentFields = new Set([
  'billing',
  'payment',
  'payments',
  'paymentmethod',
  'paymentmethodid',
  'creditcard',
  'cardnumber',
  'signup',
  'account',
  'accountid',
])

function hasPaymentField(body: unknown): boolean {
  return (
    body !== null &&
    typeof body === 'object' &&
    Object.entries(body).some(
      ([key, value]) =>
        paymentFields.has(key.toLowerCase().replaceAll(/[^a-z0-9]/g, '')) || hasPaymentField(value),
    )
  )
}

function refused(operation: string): never {
  throw new Error(fill(UI_TEXT.estimateEndpointRefused, { operation }))
}

function isSafePath(endpoint: EstimateProviderEndpoint): boolean {
  const segments = endpoint.path.split('/').slice(1)
  const hasId = endpoint.operation === 'status' || endpoint.operation === 'delete'
  return (
    endpoint.method === METHODS[endpoint.operation] &&
    endpoint.path.startsWith('/') &&
    segments.length > 0 &&
    segments.every((segment, index) =>
      segment === '{id}'
        ? hasId && index === segments.length - 1
        : /^[A-Za-z0-9_-]+$/.test(segment) &&
          !forbidden.has(segment.toLowerCase().replaceAll(/[-_]/g, '')),
    ) &&
    segments.filter((segment) => segment === '{id}').length === (hasId ? 1 : 0)
  )
}

/** The five methods are the only dispatch surface. Manifests/codecs are
 * trusted, captured adapter definitions, never supplied by a model or UI.
 */
export function brokeredEstimateProvider(
  binding: Pick<EstimateProviderPort, 'id' | 'apiOrigin' | 'endpoints'>,
  broker: EstimateProviderBroker,
  codec: EstimateProviderCodec,
): EstimateProviderPort {
  const parsed = bindingSchema.parse({
    id: binding.id,
    apiOrigin: binding.apiOrigin,
    endpoints: binding.endpoints,
  })
  const origin = new URL(parsed.apiOrigin)
  if (origin.protocol !== 'https:' || parsed.apiOrigin !== origin.origin) refused('origin')
  if (
    parsed.endpoints.length !== Object.keys(METHODS).length ||
    new Set(parsed.endpoints.map((endpoint) => endpoint.operation)).size !==
      parsed.endpoints.length ||
    parsed.endpoints.some((endpoint) => !isSafePath(endpoint))
  )
    refused('allow-list')
  const endpoints = parsed.endpoints.map((endpoint) => Object.freeze(endpoint))
  Object.freeze(endpoints)

  async function dispatch(operation: EstimateProviderOperation, id?: string, body?: unknown) {
    if (!broker.isConnected(parsed.id, origin.origin)) refused('disconnected')
    const endpoint = endpoints.find((endpoint) => endpoint.operation === operation)
    if (!endpoint) refused(operation)
    const path = endpoint.path.replace('{id}', () =>
      id === undefined ? '' : serverIdSchema.parse(id),
    )
    const url = `${origin.origin}${path}`
    try {
      const receipt = receiptSchema.parse(
        await broker.request({
          providerId: parsed.id,
          operation,
          method: endpoint.method,
          url,
          redirect: 'error',
          ...(body !== undefined && { body }),
        }),
      )
      if (
        receipt.url !== url ||
        receipt.status < HTTP_SUCCESS_MIN ||
        receipt.status > HTTP_SUCCESS_MAX
      )
        refused(operation)
      return codec.decode(operation, receipt.body)
    } catch {
      // No raw broker/codec error, path, account detail or secret is rethrown.
      return refused(operation)
    }
  }

  async function guarded<T>(
    operation: EstimateProviderOperation,
    action: () => Promise<T>,
  ): Promise<T> {
    try {
      return await action()
    } catch {
      return refused(operation)
    }
  }

  const provider: EstimateProviderPort = {
    id: parsed.id,
    apiOrigin: origin.origin,
    endpoints,
    sizes() {
      return guarded('sizes', async () =>
        z
          .array(providerSizeSchema)
          .check(
            z.maxLength(ESTIMATE_MAX_ITEMS),
            z.refine((sizes) => new Set(sizes.map((size) => size.id)).size === sizes.length),
          )
          .parse(await dispatch('sizes')),
      )
    },
    images() {
      return guarded('images', async () =>
        z
          .array(providerImageSchema)
          .check(
            z.maxLength(ESTIMATE_MAX_ITEMS),
            z.refine((images) => new Set(images.map((image) => image.id)).size === images.length),
          )
          .parse(await dispatch('images')),
      )
    },
    create(size, image, cloudInit) {
      return guarded('create', async () => {
        const selectedSize = providerSizeSchema.parse(size)
        const selectedImage = providerImageSchema.parse(image)
        if (cloudInit.trim().length === 0) refused('create')
        const body = codec.createBody(selectedSize, selectedImage, cloudInit)
        if (hasPaymentField(body)) refused('create')
        const server = provisionedServerSchema.parse(await dispatch('create', undefined, body))
        if (
          server.sizeId !== selectedSize.id ||
          server.imageId !== selectedImage.id ||
          (server.state !== 'creating' && server.state !== 'running')
        )
          refused('create')
        serverIdSchema.parse(server.id)
        return server
      })
    },
    status(id) {
      return guarded('status', async () => {
        const server = provisionedServerSchema.parse(await dispatch('status', id))
        if (server.id !== id) refused('status')
        return server
      })
    },
    delete(id) {
      return guarded('delete', async () => {
        // The captured codec must validate the provider's deletion response.
        // A subsequent status receipt proves deletion; no empty-success parser.
        const response = await dispatch('delete', id)
        z.strictObject({ accepted: z.literal(true) }).parse(response)
      })
    },
  }
  return Object.freeze(provider)
}
