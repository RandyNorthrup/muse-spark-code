import { afterEach, describe, expect, it } from 'vitest'
import { locateMediaConverter } from '../../src/core/media/convert'

// AUDITSEC finding 1 (0.19.0): the environment assembled for a converter
// child must not carry credential-shaped variables of any shape (`*_TOKEN`,
// `*_PASSWORD`, …), not only the `*_API_KEY` key variables. The probe
// observer below only records what the real discovery path hands the child.
const HOSTILE = {
  AUDIT_CONVERTER_GITHUB_TOKEN: 'ghp_probe',
  AUDIT_CONVERTER_DB_PASSWORD: 'probe-password',
  AUDIT_CONVERTER_SIGNING_SECRET: 'probe-secret',
} as const
const BENIGN = {
  AUDIT_CONVERTER_LANG: 'C.UTF-8',
} as const

describe('media converter child environment', () => {
  afterEach(() => {
    delete process.env['AUDIT_CONVERTER_GITHUB_TOKEN']
    delete process.env['AUDIT_CONVERTER_DB_PASSWORD']
    delete process.env['AUDIT_CONVERTER_SIGNING_SECRET']
    delete process.env['AUDIT_CONVERTER_LANG']
  })

  it('strips every credential shape from the probe child environment', async () => {
    Object.assign(process.env, HOSTILE, BENIGN)
    let seen: NodeJS.ProcessEnv | undefined
    const found = await locateMediaConverter({
      platform: 'linux',
      configuredConverters: [{ kind: 'ffmpeg', command: '/usr/bin/ffmpeg' }],
      trustedPath: {
        verify: (command: string) => Promise.resolve({ ok: true as const, path: command }),
      },
      probeVersion: (command, args, options) => {
        expect(command).toBe('/usr/bin/ffmpeg')
        expect(args).toEqual(['-version'])
        seen = options.env
        return Promise.resolve('ffmpeg version 7.1 Copyright (c) 2000-2024 the FFmpeg developers')
      },
    })
    expect(found).toEqual({
      ok: true,
      converter: { kind: 'ffmpeg', command: '/usr/bin/ffmpeg' },
    })
    expect(seen).toBeDefined()
    for (const name of Object.keys(HOSTILE)) {
      expect(seen?.[name]).toBeUndefined()
    }
    for (const [name, value] of Object.entries(BENIGN)) {
      expect(seen?.[name]).toBe(value)
    }
  })
})
