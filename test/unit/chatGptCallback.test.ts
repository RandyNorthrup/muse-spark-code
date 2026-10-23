// The callback flow's failure rules, driven through the real loopback
// listener: a probing request gets a fixed page and never settles the flow,
// while the waiter's error is always this app's validated failure.
import { get } from 'node:http'
import { connect } from 'node:net'
import { describe, expect, it } from 'vitest'
import { ChatGptSignInError } from '../../src/core/providers/subscriptions/chatgpt'
import { startChatGptCallback } from '../../src/runtime/subscriptionCallback'

const STATE = 'abcdefghijklmnopqrst'
const pageText = () => 'callback page'

function getStatus(url: string): Promise<number> {
  return new Promise((resolve, reject) => {
    get(url, (response) => {
      response.resume()
      response.on('end', () => {
        resolve(response.statusCode ?? 0)
      })
    }).on('error', reject)
  })
}

/** A request-target the HTTP parser accepts but the URL parser cannot take. */
function getGarbage(port: number): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const socket = connect(port, '127.0.0.1', () => {
      socket.write(
        `GET //not-a-port:80:80/x HTTP/1.1\r\nHost: 127.0.0.1:${String(port)}\r\nConnection: close\r\n\r\n`,
      )
    })
    let text = ''
    socket.on('data', (chunk: Buffer) => {
      text += chunk.toString('utf8')
    })
    socket.on('end', () => {
      resolve({ status: Number(text.split(' ', 2)[1] ?? 0), body: text })
    })
    socket.on('error', reject)
  })
}

async function signInError(promise: Promise<unknown>): Promise<ChatGptSignInError> {
  let failure: unknown
  let isFailed = false
  try {
    await promise
  } catch (error) {
    failure = error
    isFailed = true
  }
  expect(isFailed).toBe(true)
  expect(failure).toBeInstanceOf(ChatGptSignInError)
  if (!(failure instanceof ChatGptSignInError)) throw new Error('the waiter should have failed')
  return failure
}

type CallbackFlow = Awaited<ReturnType<typeof startChatGptCallback>>

/**
A callback for another attempt answers 400 and settles nothing: whoever
sent it (another local process, a stray browser tab, a probe) cannot end
this sign-in. The flow is still waiting for its own callback.
*/
async function expectForeignIgnored(flow: CallbackFlow): Promise<void> {
  const status = await getStatus(`${flow.redirectUri}?code=x&client_id=y&state=wrong-state-is-here`)
  expect(status).toBe(400)
  const own = await getStatus(`${flow.redirectUri}?code=auth-code&client_id=y&state=${STATE}`)
  expect(own).toBe(200)
  await expect(flow.waitForCallback()).resolves.toContain('code=auth-code')
}

describe('chatGptCallback failure rules', () => {
  it('answers an unparseable request-target with the fixed page and keeps the flow', async () => {
    const flow = await startChatGptCallback(STATE, 10_000, pageText)
    try {
      const port = new URL(flow.redirectUri).port
      const garbage = await getGarbage(Number(port))
      expect(garbage.status).toBe(400)
      expect(garbage.body).toContain('callback page')
      // The flow is still waiting: the probe settled nothing.
      await expectForeignIgnored(flow)
    } finally {
      flow.close()
    }
  })

  it('ignores a mismatched state and still takes its own callback', async () => {
    const flow = await startChatGptCallback(STATE, 10_000, pageText)
    try {
      await expectForeignIgnored(flow)
    } finally {
      flow.close()
    }
  })

  it('still reports the timeout to a waiter that attaches late', async () => {
    const flow = await startChatGptCallback(STATE, 50, pageText)
    try {
      await new Promise((resolve) => setTimeout(resolve, 300))
      const failure = await signInError(flow.waitForCallback())
      expect(failure.code).toBe('callback-timeout')
    } finally {
      flow.close()
    }
  })
})
