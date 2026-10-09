import { execFile } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { promisify } from 'node:util'
import { beforeAll, describe, expect, it } from 'vitest'
import * as z from 'zod/mini'
import { withoutCredentials } from '../../src/runtime/credentialVariables'
import {
  HOOK_FORBIDDEN_ENV_NAMES,
  MHP,
  XCODE_HOST,
  XCODE_MODEL_TEXT,
} from '../../src/shared/constants'
import { EN } from '../../src/shared/l10n/en'
import { startXcodeFakeRuntime } from '../hosts/xcode/fake-runtime'

describe('Xcode host shared boundary', () => {
  beforeAll(async () => {
    await promisify(execFile)(process.execPath, ['hosts/xcode/Scripts/generate.mjs'], {
      env: withoutCredentials(process.env),
    })
  })
  it('bundles the exact reviewed MHP 1.4 snapshot and refuses the earlier range', async () => {
    const snapshot = await readFile('src/shared/hostApi/mhp-v1.1.schema.json', 'utf8')
    expect(await readFile('hosts/xcode/Generated/mhp.json', 'utf8')).toBe(snapshot)
    const swift = await readFile('hosts/xcode/Generated/NativeMhp.swift', 'utf8')
    expect(MHP.version).toBe('mhp/1.4.0')
    expect(swift).toContain('static let version = "mhp/1.4.0"')
    expect(swift).toContain('static let maximumVersionExclusive = "mhp/1.5.0"')
  })
  it('ships current tunables and the credential exclusions to Swift', async () => {
    const swift = await readFile('hosts/xcode/Generated/NativeLimits.swift', 'utf8')
    for (const [key, value] of Object.entries(XCODE_HOST))
      expect(swift).toContain(`static let ${key} = ${String(value)}`)
    for (const name of HOOK_FORBIDDEN_ENV_NAMES) expect(swift).toContain(JSON.stringify(name))
  })
  it('ships the English native-only prompts without duplicating model text in Swift', async () => {
    const swift = await readFile('hosts/xcode/Generated/NativeModelText.swift', 'utf8')
    for (const [key, value] of Object.entries(XCODE_MODEL_TEXT))
      expect(swift).toContain(`static let ${key} = ${JSON.stringify(value)}`)
  })
  it('ships each native label in every installed-language table', async () => {
    const languages = [
      'en',
      'cs',
      'de',
      'es',
      'fr',
      'hu',
      'it',
      'ja',
      'ko',
      'pl',
      'pt-br',
      'ru',
      'tr',
      'zh-cn',
      'zh-tw',
    ]
    for (const language of languages) {
      const subset = z
        .record(z.string(), z.string())
        .parse(
          JSON.parse(
            await readFile(path.join('hosts/xcode/Generated', `ui.${language}.json`), 'utf8'),
          ),
        )
      const full: unknown =
        language === 'en'
          ? EN
          : JSON.parse(await readFile(path.join('l10n', `ui.${language}.json`), 'utf8'))
      expect(subset).toEqual(
        expect.objectContaining({
          xcodeOpenPanel: expect.any(String),
          xcodeUnavailable: expect.any(String),
          openFileFailed: expect.any(String),
        }),
      )
      expect(full).toEqual(expect.objectContaining(subset))
    }
  })
  it('uses the real companion bootstrap and admits the native selection payload through the shared parser', async () => {
    const server = await startXcodeFakeRuntime()
    try {
      const launch = new URL(server.launchUrl())
      const code = new URLSearchParams(launch.hash.slice(1)).get('k')
      const headers = {
        Origin: launch.origin,
        'X-Muse-Panel': '1',
        'Content-Type': 'application/json',
      }
      const response = await fetch(`${server.url}session`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ code }),
      })
      expect(response.status).toBe(200)
      expect(response.headers.get('set-cookie')).toBeNull()
      const authorization = response.headers.get('authorization')
      expect(/^Bearer [a-f\d]{64}$/u.test(authorization ?? '')).toBe(true)
      if (authorization === null) throw new Error('Missing test bearer')
      const prompt = await fetch(`${server.url}panel/message`, {
        method: 'POST',
        headers: { ...headers, Authorization: authorization },
        body: JSON.stringify({
          type: 'sendMessage',
          localId: 'xcode-selection',
          text: 'Explain this code\n\nlet value = 1',
          attachmentIds: [],
        }),
      })
      expect(prompt.status).toBe(204)
      const unauthenticated = await fetch(`${server.url}panel/message`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ type: 'ready' }),
      })
      expect(unauthenticated.status).toBe(401)
    } finally {
      await server.close()
    }
  })
})
