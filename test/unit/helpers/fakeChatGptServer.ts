// Synthetic OAuth grants and success events over real loopback HTTP. The
// catalogue and nested plan-limit framing follow the owner's supplied capture.
import { createServer } from 'node:http'
import { generateKeyPairSync, sign } from 'node:crypto'
import { once } from 'node:events'
import { SUBSCRIPTION_STREAM_MAX_BYTES } from '../../../src/shared/constants'

const ISSUER = 'https://auth.openai.com'
const CLIENT = 'synthetic-issued-client'
const SCOPE = 'openid chatgpt.tokens.use.direct'
// One synthetic signing identity; each server still owns fresh OAuth/turn state.
const pair = generateKeyPairSync('rsa', { modulusLength: 2048 })

export async function fakeChatGptServer() {
  let nonce = ''
  let subject = 'synthetic-account-A'
  let responseCount = 0
  let isLimit = false
  let isOverflow = false
  let reportedOutput = 5
  const requests: { path: string; body: unknown; authorization: string | undefined }[] = []
  const server = createServer((request, response) => {
    const chunks: Buffer[] = []
    request.on('data', (chunk: Buffer) => {
      chunks.push(chunk)
    })
    request.on('end', () => {
      const bodyText = Buffer.concat(chunks).toString()
      const url = new URL(request.url ?? '/', 'http://127.0.0.1')
      const body: unknown =
        request.headers['content-type'] === 'application/json' ? JSON.parse(bodyText) : bodyText
      requests.push({ path: url.pathname, body, authorization: request.headers.authorization })
      const json = (value: unknown) => {
        response.setHeader('Content-Type', 'application/json')
        response.end(JSON.stringify(value))
      }
      switch (url.pathname) {
        case '/.well-known/openid-configuration': {
          json({
            issuer: ISSUER,
            authorization_endpoint: `${ISSUER}/api/accounts/authorize`,
            token_endpoint: `${ISSUER}/api/accounts/oauth/token`,
            revocation_endpoint: `${ISSUER}/api/accounts/oauth/revoke`,
            jwks_uri: `${ISSUER}/synthetic-jwks`,
          })

          break
        }
        case '/synthetic-jwks': {
          json({ keys: [{ ...pair.publicKey.export({ format: 'jwk' }), kid: 'synthetic' }] })

          break
        }
        case '/api/accounts/oauth/token': {
          const unsigned = [
            { alg: 'RS256', kid: 'synthetic' },
            { iss: ISSUER, aud: CLIENT, nonce, sub: subject, exp: Date.now() / 1000 + 3600 },
          ]
            .map((part) => Buffer.from(JSON.stringify(part)).toString('base64url'))
            .join('.')
          json({
            access_token: 'synthetic-plan-access',
            refresh_token: 'synthetic-plan-refresh',
            token_type: 'Bearer',
            expires_in: 3600,
            scope: SCOPE,
            id_token: `${unsigned}.${sign('RSA-SHA256', Buffer.from(unsigned), pair.privateKey).toString('base64url')}`,
          })

          break
        }
        case '/api/accounts/oauth/revoke': {
          response.end()

          break
        }
        case '/v1/models': {
          json({
            models: [
              {
                slug: 'gpt-6-astra',
                display_name: 'GPT-6 Astra',
                visibility: 'list',
                supported_in_api: true,
              },
              {
                slug: 'gpt-reserve',
                display_name: 'Reserve',
                visibility: 'hide',
                supported_in_api: true,
              },
              {
                slug: 'unavailable',
                display_name: 'Unavailable',
                visibility: 'list',
                supported_in_api: false,
              },
            ],
          })

          break
        }
        case '/v1/responses': {
          // No Content-Type, as captured on the plan endpoint.
          const event = (value: unknown): void => {
            response.write(`data: ${JSON.stringify(value)}\n\n`)
          }
          responseCount += 1
          if (isOverflow) {
            // Keep each comment small so this exercises the total transport cap,
            // rather than quadratic buffering of one unterminated 16 MiB line.
            const comment = `:${'x'.repeat(1024)}\n\n`
            response.write(
              comment.repeat(Math.ceil(SUBSCRIPTION_STREAM_MAX_BYTES / comment.length)),
            )
          }
          event({
            type: 'response.created',
            response: {
              id: 'synthetic-response',
              status: 'in_progress',
              output: [],
              prompt_cache_key: 'server-rewritten-identity',
            },
          })
          if (isLimit) {
            event({
              type: 'error',
              error: {
                type: 'invalid_request_error',
                code: 'subscription_sharing_usage_limit_exceeded',
                message:
                  'The ChatGPT user has reached their Subscription Sharing usage limit. Ask the user to try again after their usage limit resets or use an API key instead.',
              },
            })
          } else {
            const item =
              responseCount === 1
                ? {
                    type: 'function_call',
                    id: 'synthetic-call',
                    call_id: 'synthetic-call',
                    name: 'read_file',
                    arguments: '{"path":"example.txt"}',
                  }
                : {
                    type: 'message',
                    id: 'synthetic-message',
                    role: 'assistant',
                    content: [{ type: 'output_text', text: 'Read the example.' }],
                  }
            event({ type: 'response.output_item.done', item })
            event({
              type: 'response.completed',
              response: {
                id: 'synthetic-response',
                status: 'completed',
                output: [item],
                usage: {
                  input_tokens: 10,
                  output_tokens: reportedOutput,
                  input_tokens_details: { cached_tokens: 2 },
                },
              },
            })
          }
          response.end()

          break
        }
        default: {
          response.statusCode = 404
          response.end()
        }
      }
    })
  })
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  const address = server.address()
  if (address === null || typeof address === 'string') throw new Error('No fake server address')
  const base = `http://127.0.0.1:${String(address.port)}`
  const fetcher: typeof fetch = (input, init) => {
    let address: string
    if (typeof input === 'string') address = input
    else address = input instanceof URL ? input.href : input.url
    const url = new URL(address)
    if (!['auth.openai.com', 'api.openai.com'].includes(url.hostname))
      throw new Error('External traffic refused by fake server')
    return fetch(`${base}${url.pathname}${url.search}`, init)
  }
  return {
    requests,
    account: (value: string) => {
      subject = value
    },
    fetch: fetcher,
    cap: () => {
      reportedOutput = 32_769
    },
    limit: () => {
      isLimit = true
    },
    overflow: () => {
      isOverflow = true
      isLimit = false
      reportedOutput = 5
    },
    openBrowser: async (authorizeUrl: string) => {
      const authorize = new URL(authorizeUrl)
      nonce = authorize.searchParams.get('nonce') ?? ''
      const callback = new URL(authorize.searchParams.get('redirect_uri') ?? '')
      callback.search = new URLSearchParams({
        state: authorize.searchParams.get('state') ?? '',
        code: 'synthetic-code',
        scope: SCOPE,
        client_id: CLIENT,
      }).toString()
      await fetch(callback)
    },
    close: async () => {
      server.closeAllConnections()
      await new Promise<void>((resolve, reject) =>
        server.close((error) => {
          if (error === undefined) resolve()
          else reject(error)
        }),
      )
    },
  }
}
