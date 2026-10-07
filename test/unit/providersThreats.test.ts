// The M95-S threat-model tests (PLAN.md D74, M95 step 11): a provider's key
// or account id never reaches a log, a notice or a hook. Every case is
// written to fail without its guard in `src/core/redact.ts` or the
// credential-variable names in `src/shared/constants.ts`; the drills are in
// `docs/certification/m95-s.md`.
//
// Synthetic keys only, built here so the secret scanner never sees a whole
// token (the convention of `test/unit/redact.test.ts`).

import { describe, expect, it } from 'vitest'
import { buildSessionExport } from '../../src/core/export/sessionTransfer'
import { MAY_HOLD_SECRET, redactableSlices, redactSecrets } from '../../src/core/redact'
import { isCredentialVariable } from '../../src/core/credentialEnvironment'
import { hookEnvironment } from '../../src/host/backend/toolIo'

import { createLogger } from '../../src/host/logger'
import { withoutCredentials } from '../../src/runtime/credentialVariables'
import {
  HOOK_FORBIDDEN_ENV_NAMES,
  SESSION_EXPORT_SCRUB_SLICE_CHARS,
} from '../../src/shared/constants'
import { FakeLogOutputChannel } from './helpers/fakes'

const GROQ = `gsk_${'a'.repeat(24)}`
const XAI = `xai-${'b'.repeat(24)}`
const FIREWORKS = `fw_${'c'.repeat(24)}`
const HUGGING_FACE = `hf_${'d'.repeat(34)}`
const TOGETHER = `tgp_v1_${'e'.repeat(20)}`
const BEDROCK = `ABSK${'f'.repeat(16)}`
const BEDROCK_GATEWAY = `bedrock-api-key-${'g'.repeat(16)}`
const OPENROUTER = `sk-or-${'h'.repeat(24)}`
const ANTHROPIC = `sk-ant-${'i'.repeat(24)}`
// A prefix-less key (Mistral, Azure's 32 hex: research §3.3), caught by the
// header and field rules and by the exact value, never by a shape.
const PREFIX_LESS = '0123456789abcdef'.repeat(2)
// Z.ai's captured shape: 32 hex, a dot, then provider characters.
const ZAI = `${'a'.repeat(32)}.${'B'.repeat(16)}`
const UUID = '123e4567-e89b-12d3-a456-426614174000'

describe('provider key shapes', () => {
  it.each([
    ['Groq', GROQ],
    ['xAI', XAI],
    ['Fireworks', FIREWORKS],
    ['Hugging Face', HUGGING_FACE],
    ['Together', TOGETHER],
    ['Bedrock', BEDROCK],
    ['Bedrock gateway', BEDROCK_GATEWAY],
    ['OpenRouter', OPENROUTER],
    ['Anthropic', ANTHROPIC],
  ])('redacts %s keys in prose', (_name, key) => {
    expect(redactSecrets(`saw ${key} here`)).toBe('saw [redacted] here')
  })

  it.each([['gsk_short'], ['xai-s'], ['hf_x'], ['fw_short'], ['ABSK']])(
    'leaves a short %s lookalike alone',
    (lookalike) => {
      expect(redactSecrets(`saw ${lookalike} here`)).toBe(`saw ${lookalike} here`)
    },
  )

  it('redacts a key echoed in a header or an error envelope, keeping the name', () => {
    expect(redactSecrets(`x-api-key: ${GROQ}`)).toBe('x-api-key: [redacted]')
    const envelope = JSON.stringify({ error: { message: `bad key ${XAI}`, code: 401 } })
    expect(redactSecrets(envelope)).toBe(
      JSON.stringify({ error: { message: 'bad key [redacted]', code: 401 } }),
    )
  })

  it('redacts a key and an account id together in a hook payload', () => {
    const payload = JSON.stringify({ key: HUGGING_FACE, user_id: 'u_9', model: 'm' })
    expect(redactSecrets(payload)).toBe(
      JSON.stringify({ key: '[redacted]', user_id: '[redacted]', model: 'm' }),
    )
  })
})

describe('the prefilter', () => {
  it.each([
    'gsk_',
    'xai-',
    'fw_',
    'hf_',
    'tgp_v1_',
    'absk',
    'bedrock-api-key-',
    'user_id',
    'creator_user_id',
    'workspace_id',
    'openai-organization',
    'openai-project',
    'anthropic-organization-id',
    'anthropic-workspace-id',
    'team',
    'account',
    'organization',
    'project',
  ])('holds %s, so a line carrying one reaches the rules', (literal) => {
    expect(MAY_HOLD_SECRET.test(literal)).toBe(true)
  })
})

describe('account ids', () => {
  it.each([true, false])(
    'redacts the team id newline export boundary with redaction %s',
    async (redact) => {
      const prefix = `${'x'.repeat(SESSION_EXPORT_SCRUB_SLICE_CHARS)} failed for team id\n`
      const text = `${prefix}${UUID} end`
      const built = await buildSessionExport(
        {
          backend: 'modelApi',
          modelId: 'muse-spark-1.3',
          exportedAt: '2026-10-05T12:00:00.000Z',
          items: [{ itemId: 'message', kind: 'agentMessage', status: 'completed', text }],
        },
        { redact, localRoots: [] },
      )
      expect(built.doc.transcript[0]?.text).toBe(`${prefix}[redacted] end`)
      expect(built.doc.redacted).toBe(redact)
      expect(built.secrets).toBe(1)
      expect(JSON.stringify(built.doc)).not.toContain(UUID)
    },
  )

  it.each(['team id', 'account id', 'organization id', 'organisation id', 'project id'])(
    'keeps the whole %s match across whitespace slice boundaries',
    (lead) => {
      const prefix = `${'x'.repeat(100)} failed for ${lead}\r\n \n`
      const text = `${prefix}${UUID} end\n${'ordinary line\n'.repeat(100)}`
      const slices = redactableSlices(text, 100)
      expect(slices.length).toBeGreaterThan(1)
      expect(slices.join('')).toBe(text)
      expect(slices.map((slice) => redactSecrets(slice)).join('')).toBe(redactSecrets(text))
      expect(slices.find((slice) => slice.includes(UUID))).toContain(`${lead}\r\n \n${UUID}`)
    },
  )

  it('redacts the review JSON header repro through the real logger', () => {
    const channel = new FakeLogOutputChannel()
    const headers = { 'openai-organization': 'org_fixture', 'anthropic-workspace-id': UUID }
    createLogger(channel).error(JSON.stringify(headers))
    expect(channel.error).toHaveBeenCalledWith(
      JSON.stringify({
        'openai-organization': '[redacted]',
        'anthropic-workspace-id': '[redacted]',
      }),
    )
  })

  it('tracks safe cuts after earlier redactions shrink the whole string', () => {
    const text = `${GROQ}\n${'x'.repeat(100)} failed for team id\n${UUID} end\n${'line\n'.repeat(100)}`
    const slices = redactableSlices(text, 100)
    expect(slices.length).toBeGreaterThan(1)
    expect(slices.map((slice) => redactSecrets(slice)).join('')).toBe(redactSecrets(text))
    expect(slices.find((slice) => slice.includes(UUID))).toContain(`team id\n${UUID}`)
  })

  it.each([
    'openai-organization',
    'openai-project',
    'anthropic-organization-id',
    'anthropic-workspace-id',
  ])('redacts JSON-serialized %s headers while preserving names and quotes', (header) => {
    const text = JSON.stringify({ [header]: UUID, ordinary: 'kept' })
    expect(redactSecrets(text)).toBe(JSON.stringify({ [header]: '[redacted]', ordinary: 'kept' }))
    expect(redactSecrets(`'${header}': '${UUID}'`)).toBe(`'${header}': '[redacted]'`)
    expect(redactSecrets(`"${header.toUpperCase()}" : "${UUID}"`)).toBe(
      `"${header.toUpperCase()}" : "[redacted]"`,
    )
  })

  it("redacts OpenRouter's user id at top level and keeps the message", () => {
    const body = '{"error": {"message": "m", "code": 400}, "user_id": "u_123"}'
    expect(redactSecrets(body)).toBe(
      '{"error": {"message": "m", "code": 400}, "user_id": "[redacted]"}',
    )
  })

  it("redacts the /key body's creator and workspace ids", () => {
    const body = `{"creator_user_id": "c_1", "workspace_id": "w_2", "limit": 10}`
    expect(redactSecrets(body)).toBe(
      `{"creator_user_id": "[redacted]", "workspace_id": "[redacted]", "limit": 10}`,
    )
    expect(redactSecrets('creator_user_id=c_1')).toBe('creator_user_id=[redacted]')
  })

  it.each([
    ['openai-organization', 'org_abc'],
    ['openai-project', 'proj_def'],
    ['anthropic-organization-id', 'org_ghi'],
    ['anthropic-workspace-id', 'ws_jkl'],
  ])('redacts the %s header value and keeps the name', (header, id) => {
    expect(redactSecrets(`${header}: ${id}`)).toBe(`${header}: [redacted]`)
  })

  it.each([
    ['team', 'team'],
    ['account id', 'account id'],
    ['organization', 'organization:'],
    ['project', 'project #'],
  ])('redacts a UUID after %s in prose and keeps the word', (_name, lead) => {
    expect(redactSecrets(`failed for ${lead} ${UUID} end`)).toBe(
      `failed for ${lead} [redacted] end`,
    )
  })

  it('leaves prose without a UUID, and unrelated fields, alone', () => {
    expect(redactSecrets('the project plan for the team of six')).toBe(
      'the project plan for the team of six',
    )
    expect(redactSecrets('account 5, project v2')).toBe('account 5, project v2')
    expect(redactSecrets(UUID)).toBe(UUID)
    expect(redactSecrets('{"expires_in": 3600, "limit_remaining": 7}')).toBe(
      '{"expires_in": 3600, "limit_remaining": 7}',
    )
  })
})

describe('prefix-less keys', () => {
  it('catches one by the header and field rules', () => {
    expect(redactSecrets(`Authorization: Bearer ${PREFIX_LESS}`)).toBe(
      'Authorization: Bearer [redacted]',
    )
    expect(redactSecrets(`{"api_key": "${PREFIX_LESS}"}`)).toBe('{"api_key": "[redacted]"}')
  })

  it('catches one by the exact value the transport registers for the request', () => {
    expect(redactSecrets(`echo ${PREFIX_LESS} done`, [PREFIX_LESS])).toBe('echo [redacted] done')
    expect(redactSecrets(`echo ${ZAI} done`, [ZAI])).toBe('echo [redacted] done')
  })

  it('does not shape-redact a prefix-less key standing alone (the residual)', () => {
    expect(redactSecrets(`echo ${PREFIX_LESS} done`)).toBe(`echo ${PREFIX_LESS} done`)
  })
})

describe('credential variables', () => {
  it.each(['AWS_BEARER_TOKEN_BEDROCK', 'ANTHROPIC_AUTH_TOKEN', 'HF_TOKEN'])(
    'strips %s, in any case',
    (name) => {
      expect(HOOK_FORBIDDEN_ENV_NAMES.has(name)).toBe(true)
      expect(isCredentialVariable(name)).toBe(true)
      expect(isCredentialVariable(name.toLowerCase())).toBe(true)
    },
  )

  it.each([
    'OPENAI_API_KEY',
    'ANTHROPIC_API_KEY',
    'XAI_API_KEY',
    'GROQ_API_KEY',
    'DEEPSEEK_API_KEY',
    'MISTRAL_API_KEY',
    'TOGETHER_API_KEY',
    'FIREWORKS_API_KEY',
    'OPENROUTER_API_KEY',
    'GEMINI_API_KEY',
  ])('strips %s by the _API_KEY suffix rule', (name) => {
    expect(isCredentialVariable(name)).toBe(true)
  })

  it('removes CI_TOKEN under the shared process credential fence', () => {
    expect(isCredentialVariable('CI_TOKEN')).toBe(true)
  })

  it('keeps non-credential variables', () => {
    for (const name of ['PATH', 'HOME', 'OLLAMA_HOST']) {
      expect(isCredentialVariable(name)).toBe(false)
    }
    expect(isCredentialVariable('CI_TOKEN')).toBe(true)
    expect(isCredentialVariable('ci_token')).toBe(true)
    expect(withoutCredentials({ PATH: '/bin', CI_TOKEN: 'synthetic' })).toEqual({ PATH: '/bin' })
    expect(hookEnvironment({ CI_TOKEN: 'synthetic' }, 'linux', ['CI_TOKEN'])).toEqual({})
  })

  it('withholds a provider credential from hooks even when granted', () => {
    expect(
      hookEnvironment({ HF_TOKEN: 'h', ANTHROPIC_AUTH_TOKEN: 'a', LANG: 'en' }, 'linux', [
        'HF_TOKEN',
        'ANTHROPIC_AUTH_TOKEN',
        'LANG',
      ]),
    ).toEqual({ LANG: 'en' })
  })

  it("strips the agent's own provider credentials before a child starts", () => {
    const env = {
      PATH: '/usr/bin',
      HF_TOKEN: 'h',
      AWS_BEARER_TOKEN_BEDROCK: 'b',
      OPENAI_API_KEY: 'k',
    }
    expect(withoutCredentials(env)).toEqual({ PATH: '/usr/bin' })
    expect(env).toEqual({
      PATH: '/usr/bin',
      HF_TOKEN: 'h',
      AWS_BEARER_TOKEN_BEDROCK: 'b',
      OPENAI_API_KEY: 'k',
    })
  })
})
