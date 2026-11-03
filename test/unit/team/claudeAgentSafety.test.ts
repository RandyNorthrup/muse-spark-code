// D262 (lane RLF-CLAUDESAFE): no Claude account is put at risk. Each case runs
// the real boundary: the child environments, the adapter's refusal as the
// SDK carries it, the version floor, the custom-entry warning and the
// Anthropic account policy.
import * as acp from '@agentclientprotocol/sdk'
import { describe, expect, it } from 'vitest'
import { withoutCredentials } from '../../../src/core/credentialEnvironment'
import { accountPolicyFor } from '../../../src/core/providers/accountPolicy'
import {
  ANTHROPIC_PLAN_LOGIN_QUOTE,
  CLAUDE_AGENT_ACP_MIN_VERSION,
  CLAUDE_AGENT_ACP_VERSION,
  CLAUDE_CONSOLE_LOGIN_COMMAND,
  claudeAdapterVersionRefusal,
  claudeAgentEnvironment,
  claudeNeedsKeySentence,
  externalAgentPickNotice,
  isClaudeKeyRefusal,
  isClaudeOnPlan,
} from '../../../src/core/team/claudeAgentSafety'
import { customExternalAgents, externalAgentPresets } from '../../../src/core/team/externalAgents'
import { AcpAuthRequiredError } from '../../../src/core/team/workers/acpWorker'
import { workerEnvironment } from '../../../src/core/team/workers/workerEnv'
import { vaultFenceEnvironment } from '../../../src/core/vault/exec/fence'
import { ACP_PRESET_INSTALLS, asAcpSdkError } from '../../../src/host/team/acpProcess'
import { CLAUDE_PLAN_ENV_NAMES, UI_TEXT } from '../../../src/shared/constants'
import { isCredentialVariable } from '../../../src/shared/credentialEnvironment'

const PLAN_ENV = Object.fromEntries([...CLAUDE_PLAN_ENV_NAMES].map((name) => [name, 'plan-value']))
const LISTED = [...CLAUDE_PLAN_ENV_NAMES]

describe('Claude plan routes never reach a child (D262)', () => {
  it('is a credential everywhere and stays out even where a setting or a profile lists it', () => {
    for (const name of LISTED) expect(isCredentialVariable(name)).toBe(true)
    const base = { ...PLAN_ENV, PATH: '/bin', ANTHROPIC_API_KEY: 'k' }
    expect(Object.keys(withoutCredentials(base, LISTED, 'linux'))).toEqual(['PATH'])
    expect(Object.keys(withoutCredentials(base, ['ANTHROPIC_API_KEY'], 'linux'))).toEqual([
      'PATH',
      'ANTHROPIC_API_KEY',
    ])
    const worker = workerEnvironment(base, 'linux', LISTED)
    for (const name of LISTED) expect(worker[name]).toBeUndefined()
    const fenced = vaultFenceEnvironment(base, { passNames: LISTED, platform: 'linux' })
    for (const name of LISTED) expect(fenced[name]).toBeUndefined()
    const museCode = vaultFenceEnvironment(base, { museCode: true, platform: 'linux' })
    for (const name of LISTED) expect(museCode[name]).toBeUndefined()
  })
})

describe("Claude's adapter version floor (D262)", () => {
  it('passes the floor and later, refuses older, prerelease-of-floor and unreadable versions in words', () => {
    expect(claudeAdapterVersionRefusal(CLAUDE_AGENT_ACP_MIN_VERSION)).toBeUndefined()
    expect(claudeAdapterVersionRefusal(CLAUDE_AGENT_ACP_VERSION)).toBeUndefined()
    expect(claudeAdapterVersionRefusal('1.0.0')).toBeUndefined()
    const old = claudeAdapterVersionRefusal('0.73.0')
    expect(old).toContain('0.73.0')
    expect(old).toContain(`@agentclientprotocol/claude-agent-acp@${CLAUDE_AGENT_ACP_VERSION}`)
    expect(claudeAdapterVersionRefusal('0.74.0-beta.1')).toContain(CLAUDE_AGENT_ACP_MIN_VERSION)
    expect(claudeAdapterVersionRefusal(undefined)).toContain(CLAUDE_AGENT_ACP_MIN_VERSION)
    expect(claudeAdapterVersionRefusal('unknown')).toContain(CLAUDE_AGENT_ACP_MIN_VERSION)
    expect(ACP_PRESET_INSTALLS.claude?.version).toBe(CLAUDE_AGENT_ACP_VERSION)
  })
})

describe("Claude's refusal asks for a key, never a plan login (D262)", () => {
  const claude = externalAgentPresets().find((agent) => agent.preset === 'claude')
  if (claude === undefined) throw new Error('the Claude preset is missing')

  it('reads the adapter reason and its plain refusal from the wire error', () => {
    const plan = asAcpSdkError(
      acp.RequestError.authRequired(
        { reason: 'claude_subscription_not_supported' },
        'This integration does not support using claude.ai subscriptions.',
      ),
      'session/new',
      [],
    )
    if (!(plan instanceof AcpAuthRequiredError)) throw new Error('expected a sign-in refusal')
    expect(plan.reason).toBe('claude_subscription_not_supported')
    const plain = asAcpSdkError(
      acp.RequestError.authRequired(
        undefined,
        'Sign in with an API key or a Console account to use this integration.',
      ),
      'session/prompt',
      [],
    )
    if (!(plain instanceof AcpAuthRequiredError)) throw new Error('expected a sign-in refusal')
    const custom = { preset: undefined }
    expect(isClaudeKeyRefusal(custom, plan)).toBe(true)
    expect(isClaudeKeyRefusal(custom, plain)).toBe(true)
    expect(isClaudeKeyRefusal(custom, new AcpAuthRequiredError([]))).toBe(false)
    expect(isClaudeKeyRefusal(claude, new AcpAuthRequiredError([]))).toBe(true)
  })

  it('names the Console sign-in, the adapter’s own when it lists one, and never the plan’s', () => {
    expect(claude.label).toBe('Claude Agent')
    expect(claude.signInCommand).toBe(CLAUDE_CONSOLE_LOGIN_COMMAND)
    const sentence = claudeNeedsKeySentence(claude, [])
    expect(sentence).toContain('ANTHROPIC_API_KEY')
    expect(sentence).toContain(CLAUDE_CONSOLE_LOGIN_COMMAND)
    const listed = claudeNeedsKeySentence(claude, [
      {
        id: 'console-login',
        name: 'Anthropic Console',
        type: 'terminal',
        args: ['--cli', 'auth', 'login', '--console'],
      },
    ])
    expect(listed).toContain('claude-agent-acp --cli auth login --console')
    expect(listed).not.toContain('--claudeai')
  })
})

describe("Claude's preset with the person's key runs in its own empty configuration (D262)", () => {
  it('passes the key and our folder only for Claude with a key set', () => {
    const scrubbed = { PATH: '/bin', CLAUDE_CONFIG_DIR: '/home/p/.claude' }
    const keyed = claudeAgentEnvironment({
      agent: { preset: 'claude' },
      scrubbed,
      baseEnv: { ANTHROPIC_API_KEY: 'person-key' },
      configDir: '/store/claude-agent-config',
    })
    expect(keyed).toEqual({
      PATH: '/bin',
      ANTHROPIC_API_KEY: 'person-key',
      CLAUDE_CONFIG_DIR: '/store/claude-agent-config',
    })
    const unkeyed = { agent: { preset: 'claude' as const }, scrubbed, baseEnv: {}, configDir: '/s' }
    expect(claudeAgentEnvironment(unkeyed)).toBe(scrubbed)
    expect(
      claudeAgentEnvironment({
        ...unkeyed,
        agent: { preset: 'codex' },
        baseEnv: { ANTHROPIC_API_KEY: 'k' },
      }),
    ).toBe(scrubbed)
  })
})

describe('A custom entry that starts Claude on a plan is warned about before use (D262)', () => {
  it('detects by command and arguments alone and quotes Anthropic in the pick notice', () => {
    const [plain, hidden, npx, other] = customExternalAgents([
      { name: 'mine', command: 'C:\\tools\\claude-agent-acp.cmd' },
      { name: 'safe', command: 'claude-agent-acp', args: ['--hide-claude-auth'] },
      { name: 'npx', command: 'npx', args: ['-y', '@agentclientprotocol/claude-agent-acp'] },
      { name: 'other', command: 'codex-acp' },
    ])
    if (plain === undefined || hidden === undefined || npx === undefined || other === undefined)
      throw new Error('the custom agents did not parse')
    expect([plain, hidden, npx, other].map((agent) => isClaudeOnPlan(agent))).toEqual([
      true,
      false,
      true,
      false,
    ])
    const notice = externalAgentPickNotice(plain)
    expect(notice).toContain(ANTHROPIC_PLAN_LOGIN_QUOTE)
    expect(notice).toContain('https://code.claude.com/docs/en/legal-and-compliance')
    expect(externalAgentPickNotice(other)).not.toContain(ANTHROPIC_PLAN_LOGIN_QUOTE)
    const claude = externalAgentPresets()[0]
    if (claude === undefined) throw new Error('the Claude preset is missing')
    expect(externalAgentPickNotice(claude)).toBe(
      UI_TEXT.teamExternalSwitchNoticeClaude.replace('{agent}', 'Claude Agent'),
    )
  })
})

describe('Anthropic accounts (D262)', () => {
  it('asks before moving to another API account, with the AUP first, and never pools a plan', () => {
    const api = accountPolicyFor('anthropic', 'api')
    expect(api?.pooling).toBe('confirm')
    expect(api?.sources[0]?.url).toBe('https://www.anthropic.com/legal/aup')
    expect(api?.checkedAt).toBe('2026-11-02')
    expect(accountPolicyFor('anthropic', 'claude-plan')?.pooling).toBe('notOffered')
  })
})
