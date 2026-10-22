// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { EN } from '../../src/shared/l10n/en'
import { setUiText } from '../../src/shared/l10n/text'
import { NodeBrowserAuth } from '../../src/webview/node/auth/entry'
import { NodePairing } from '../../src/webview/node/auth/Pairing'
import { mountNodePairing } from '../../src/webview/node/auth/entry'
import { nodeAuthentication, nodeChallenge } from './helpers/node/records'
import { nodeStepUp } from './helpers/node/records'
import { startAuthentication, startRegistration } from '@simplewebauthn/browser'
import { nodeMethods } from '../../src/shared/hostApi/nodeMethods'
import { nodeWebAuthnCapture as capture } from './helpers/node/webAuthnCapture'

vi.mock('@simplewebauthn/browser', () => ({
  startRegistration: vi.fn(() => Promise.resolve(capture.sdkRegistration)),
  startAuthentication: vi.fn(() => Promise.resolve(capture.sdkAssertion)),
}))
beforeEach(() => {
  Object.defineProperty(window, 'isSecureContext', { value: true, configurable: true })
})
afterEach(() => {
  cleanup()
  setUiText(EN, 'en')
  vi.restoreAllMocks()
})

function fakeFetch() {
  return vi.fn<typeof fetch>(async (url, options) => {
    let target: string
    if (typeof url === 'string') target = url
    else if (url instanceof URL) target = url.href
    else target = url.url
    const method = target.split('/node/', 2)[1]
    const body = options?.body
    if (typeof body !== 'string') throw new Error('expected a JSON body')
    const request: unknown = JSON.parse(body)
    if (method === 'auth/begin') {
      const purpose =
        typeof request === 'object' && request !== null && 'purpose' in request
          ? request.purpose
          : undefined
      return Response.json({ ...nodeChallenge(), purpose })
    }
    return method === 'auth/enroll' || method === 'auth/signin'
      ? await Promise.resolve(Response.json(nodeAuthentication()))
      : await Promise.resolve(Response.json({ done: true }))
  })
}

describe('H03/H06 browser memory sign-in', () => {
  it('requests resident UV enrollment and fresh payload-bound UV for every action', async () => {
    const fetcher = fakeFetch()
    const auth = new NodeBrowserAuth('https://home.local:7443', fetcher)
    await auth.enroll('x'.repeat(43))
    const enrollmentBody = fetcher.mock.calls.at(-1)?.[1]?.body
    if (typeof enrollmentBody !== 'string') throw new Error('expected enrollment body')
    const enrollment = nodeMethods['node/auth/enroll'].params.parse(JSON.parse(enrollmentBody))
    expect(enrollment.credential.response).toEqual({
      attestationObject: capture.sdkRegistration.response.attestationObject,
      clientDataJSON: capture.sdkRegistration.response.clientDataJSON,
      transports: capture.sdkRegistration.response.transports,
    })
    expect(enrollment.credential.response).not.toHaveProperty('publicKey')
    expect(vi.mocked(startRegistration).mock.calls.at(-1)?.[0]).toMatchObject({
      optionsJSON: {
        attestation: 'none',
        authenticatorSelection: { residentKey: 'required', userVerification: 'required' },
      },
    })
    const actionDigest = 'a'.repeat(64)
    const challenge = {
      ...nodeChallenge(),
      purpose: 'stepUp',
      sessionId: nodeAuthentication().session.id,
      action: 'maker.action',
      actionDigest,
    }
    const proof = { ...nodeStepUp(), action: 'maker.action', actionDigest }
    fetcher
      .mockResolvedValueOnce(Response.json(challenge))
      .mockResolvedValueOnce(Response.json(proof))
    expect(await auth.stepUp('maker.action', actionDigest)).toEqual(proof)
    expect(vi.mocked(startAuthentication).mock.calls.at(-1)?.[0]).toMatchObject({
      optionsJSON: { userVerification: 'required' },
    })
    const calls = vi.mocked(startAuthentication).mock.calls.length
    for (const changed of [
      { ...challenge, action: 'terminal.open' },
      { ...challenge, actionDigest: 'b'.repeat(64) },
    ]) {
      fetcher.mockResolvedValueOnce(Response.json(changed))
      await expect(auth.stepUp('maker.action', actionDigest)).rejects.toThrow()
    }
    expect(vi.mocked(startAuthentication).mock.calls).toHaveLength(calls)
  })
  it('sends privileged credentials in headers only and starts a reload signed out', async () => {
    const fetcher = fakeFetch()
    const storage = vi.spyOn(Storage.prototype, 'setItem')
    const auth = new NodeBrowserAuth('https://home.local:7443', fetcher)
    await auth.signIn()
    expect(JSON.stringify(auth)).not.toContain(nodeAuthentication().bearer)
    await auth.request('node/stop', {})
    const [url, options] = fetcher.mock.calls.at(-1) ?? []
    expect(url).toBe('https://home.local:7443/node/stop')
    expect(options).toMatchObject({
      credentials: 'omit',
      cache: 'no-store',
      redirect: 'error',
      mode: 'same-origin',
      headers: { Authorization: `Bearer ${nodeAuthentication().bearer}` },
    })
    expect(url).not.toContain(nodeAuthentication().bearer)
    expect(options?.body).not.toContain(nodeAuthentication().bearer)
    expect(document.cookie).not.toContain(nodeAuthentication().bearer)
    expect(storage).not.toHaveBeenCalled()
    await expect(
      new NodeBrowserAuth('https://home.local:7443', fetcher).request('node/stop', {}),
    ).rejects.toThrow('Sign in')
    await auth.signOut()
    await expect(auth.request('node/stop', {})).rejects.toThrow('Sign in')
  })
  it('uses exactly one first-frame bearer only on the node terminal socket', async () => {
    const auth = new NodeBrowserAuth('https://home.local:7443', fakeFetch())
    await auth.signIn()
    const socket = {
      url: 'wss://home.local:7443/node/terminal/stream',
      readyState: WebSocket.OPEN,
      send: vi.fn(),
    }
    auth.authenticateSocket(socket, 'terminal-1')
    expect(JSON.parse(String(socket.send.mock.calls[0]?.[0]))).toEqual({
      type: 'auth',
      bearer: nodeAuthentication().bearer,
      terminalId: 'terminal-1',
    })
    expect(() => {
      auth.authenticateSocket(socket, 'terminal-1')
    }).toThrow()
    for (const url of [
      'wss://evil.local/node/terminal/stream',
      'ws://home.local:7443/node/terminal/stream',
      'wss://home.local:7443/node/terminal/stream?token=planted',
      'wss://home.local:7443/other',
    ]) {
      const changed = { ...socket, url, send: vi.fn() }
      expect(() => {
        auth.authenticateSocket(changed, 'terminal-1')
      }).toThrow()
      expect(changed.send).not.toHaveBeenCalled()
    }
  })
  it('refuses insecure context, IP RP names and a swapped origin before authenticator use', async () => {
    Object.defineProperty(window, 'isSecureContext', { value: false, configurable: true })
    const auth = new NodeBrowserAuth('https://home.local:7443', fakeFetch())
    await expect(auth.signIn()).rejects.toThrow('Install')
    expect(() => new NodeBrowserAuth('https://127.0.0.1', fakeFetch())).toThrow()
    expect(() => new NodeBrowserAuth(['http:', '//home.local'].join(''), fakeFetch())).toThrow()
    Object.defineProperty(window, 'isSecureContext', { value: true, configurable: true })
    const fetcher = vi.fn<typeof fetch>(() =>
      Promise.resolve(
        Response.json({
          ...nodeChallenge(),
          origin: 'https://other.local',
          rpId: 'other.local',
        }),
      ),
    )
    await expect(new NodeBrowserAuth('https://home.local:7443', fetcher).signIn()).rejects.toThrow(
      'Install',
    )
  })
  it('validates replies, refuses redirects and clears a rejected session', async () => {
    const fetcher = fakeFetch()
    const auth = new NodeBrowserAuth('https://home.local:7443', fetcher)
    await auth.enroll('x'.repeat(43))
    fetcher.mockResolvedValueOnce(Response.json({ code: 'expired' }, { status: 401 }))
    await expect(auth.request('node/stop', {})).rejects.toThrow('expired')
    await expect(auth.request('node/stop', {})).rejects.toThrow('Sign in')
    fetcher.mockResolvedValueOnce(Response.json({ purpose: 'signin', bearer: 'planted' }))
    await expect(auth.signIn()).rejects.toThrow()
  })
})

function view() {
  const auth = new NodeBrowserAuth('https://home.local:7443', fakeFetch())
  const signin = vi.spyOn(auth, 'signIn').mockResolvedValue()
  const enroll = vi.spyOn(auth, 'enroll').mockResolvedValue()
  const signedIn = vi.fn()
  render(
    <NodePairing
      name="home.local"
      fingerprint={'a'.repeat(64)}
      certificateUrl="/node-certificate.pem"
      auth={auth}
      signedIn={signedIn}
    />,
  )
  return { auth, signin, enroll, signedIn }
}

describe('browser certificate pairing page', () => {
  it('shows the full pin and OS instructions and waits for comparison', async () => {
    const f = view()
    expect(screen.getByText(new RegExp(`${'AA:'.repeat(31)}AA`, 'u'))).toBeTruthy()
    for (const os of ['Windows:', 'macOS:', 'Linux:', 'Firefox'])
      expect(screen.getByText(new RegExp(os, 'u'))).toBeTruthy()
    expect(
      screen.getByRole('button', { name: EN.nodeLabels.signin }).hasAttribute('disabled'),
    ).toBe(true)
    fireEvent.submit(screen.getByLabelText(EN.nodeLabels.setupCode).closest('form')!)
    expect(f.enroll).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('checkbox'))
    fireEvent.click(screen.getByRole('button', { name: EN.nodeLabels.signin }))
    await waitFor(() => {
      expect(f.signedIn).toHaveBeenCalledWith(f.auth)
    })
    expect(f.signin).toHaveBeenCalledOnce()
  })
  it('mounts the lazy page with the caller language before render', async () => {
    const element = document.createElement('div')
    document.body.append(element)
    const auth = new NodeBrowserAuth('https://home.local:7443', fakeFetch())
    const table = { ...EN, nodeLabels: { ...EN.nodeLabels, pairBrowser: 'Associer ce navigateur' } }
    const root = mountNodePairing(
      element,
      {
        name: 'home.local',
        fingerprint: 'a'.repeat(64),
        certificateUrl: '/node-certificate.pem',
        auth,
        signedIn: () => undefined,
      },
      table,
      'fr',
    )
    await waitFor(() => {
      expect(element.textContent).toContain('Associer ce navigateur')
    })
    act(() => {
      root.unmount()
    })
    element.remove()
  })
  it('clears the setup field and shows an installation hint on WebAuthn refusal', async () => {
    const f = view()
    f.enroll.mockRejectedValueOnce(new Error('TLS untrusted'))
    fireEvent.click(screen.getByRole('checkbox'))
    fireEvent.change(screen.getByLabelText(EN.nodeLabels.setupCode), {
      target: { value: 'x'.repeat(43) },
    })
    fireEvent.click(screen.getByRole('button', { name: EN.nodeLabels.enroll }))
    await waitFor(() => {
      expect(screen.getByRole('alert').textContent).toBe(EN.nodeAuth.trustRequired)
    })
    expect(screen.getByLabelText(EN.nodeLabels.setupCode)).toHaveProperty('value', '')
    expect(f.signedIn).not.toHaveBeenCalled()
  })
  it('reads installed-language text at render time and rejects cross-origin certificate assets', () => {
    setUiText({ ...EN, nodeAuth: { ...EN.nodeAuth, download: 'Certificat du nœud' } }, 'fr')
    view()
    expect(
      screen.getByRole('link', { name: 'Certificat du nœud' }).getAttribute('href'),
    ).not.toContain('x'.repeat(43))
    const auth = new NodeBrowserAuth('https://home.local:7443', fakeFetch())
    expect(() =>
      render(
        <NodePairing
          name="home.local"
          fingerprint={'a'.repeat(64)}
          certificateUrl="https://evil.local/cert.pem"
          auth={auth}
          signedIn={() => undefined}
        />,
      ),
    ).toThrow()
  })
})
