import { describe, expect, it } from 'vitest'
import { buildChatShare, renderChatShare } from '../../src/core/sharing/chatShare'
import { createChatSharePrivacy } from '../../src/core/sharing/privacy'
import type { ItemSnapshot } from '../../src/shared/agentEvents'
import { shareJsonSchema } from '../../src/shared/share'
import { snapshotKindFixtures } from './helpers/sharingFixtures'

const privacy = createChatSharePrivacy({
  workspaceRoots: [],
  home: '',
  userName: '',
  redactRegisteredSecrets: (text) => text,
})
const source = {
  sessionId: 's1',
  title: '<img src="https://attacker.invalid/x" onerror="alert(1)">',
  exportedAt: '2026-10-05T12:00:00Z',
  items: [
    ...snapshotKindFixtures,
    {
      itemId: 'injection',
      kind: 'agentMessage',
      status: 'completed',
      text: '<script>alert(1)</script>\n<img src="https://attacker.invalid/pixel">\n[x](javascript:alert(1))\n<img src="file:///etc/passwd">',
    },
  ],
}
function build() {
  return buildChatShare(
    source,
    { target: 'chat', sessionId: 's1', mode: 'full', format: 'json', destination: 'copy' },
    privacy,
  )
}

describe('M118 deterministic local formats', () => {
  it.each([true, false])(
    'preserves displayed failed test results, verification, status, exit codes and citations only in full mode (codeBlocks=%s)',
    (codeBlocks) => {
      const items: readonly ItemSnapshot[] = [
        {
          itemId: 'edit',
          kind: 'toolCall',
          tool: 'edit_file',
          status: 'failed',
          text: 'Edit applied',
          thenRun: {
            command: 'npm test',
            outcome: 'failed',
            output: 'PLANTED_TEST_RESULT',
            exitCode: 17,
          },
          verifySummary: {
            files: ['src/a.ts'],
            errors: 1,
            warnings: 0,
            checks: [{ name: 'PLANTED_VERIFICATION', outcome: 'failed' }],
          },
        },
        {
          itemId: 'shell',
          kind: 'userShell',
          status: 'failed',
          commandText: 'npm test',
          exitCode: 19,
          exitSignal: 15,
        },
        {
          itemId: 'answer',
          kind: 'agentMessage',
          status: 'completed',
          text: 'Human answer\n\n```ts\nPLANTED_CODE_BLOCK\n```',
          citations: [{ title: 'PLANTED_CITATION', url: 'https://example.com/source' }],
          thenRun: {
            command: 'private-command',
            outcome: 'failed',
            output: 'PLANTED_MESSAGE_ACTIVITY',
          },
        },
      ]
      const request = {
        target: 'chat',
        sessionId: 's1',
        mode: 'full',
        format: 'json',
        destination: 'copy',
        options: { codeBlocks },
      }
      const full = buildChatShare({ ...source, items }, request, privacy)
      expect(full.items[2]?.text?.includes('PLANTED_CODE_BLOCK')).toBe(codeBlocks)
      for (const format of ['md', 'html', 'json'] as const) {
        const bytes = renderChatShare(full, format)
        for (const text of [
          'PLANTED_TEST_RESULT',
          'PLANTED_VERIFICATION',
          'PLANTED_CITATION',
          'https://example.com/source',
          'failed',
          '17',
          '19',
          '15',
        ]) {
          expect(bytes, `${format}: ${text}`).toContain(text)
        }
      }
      const conversation = buildChatShare(
        { ...source, items },
        { ...request, mode: 'conversation' },
        privacy,
      )
      expect(conversation.items).toEqual([
        {
          id: 'answer',
          kind: 'agentMessage',
          text: codeBlocks ? items[2]?.text : 'Human answer\n\n',
        },
      ])
      for (const format of ['md', 'html', 'json'] as const) {
        const bytes = renderChatShare(conversation, format)
        expect(bytes).not.toMatch(
          /PLANTED_TEST_RESULT|PLANTED_VERIFICATION|PLANTED_CITATION|PLANTED_MESSAGE_ACTIVITY|private-command|example\.com|failed|exit/,
        )
      }
    },
  )
  it('returns identical bytes for identical snapshots, options and export times, in all formats', () => {
    for (const format of ['md', 'html', 'json'] as const)
      expect(renderChatShare(build(), format)).toBe(renderChatShare(build(), format))
    const doc = JSON.parse(renderChatShare(build(), 'json'))
    expect(shareJsonSchema.safeParse(doc).success).toBe(true)
    expect(doc).toMatchObject({
      target: 'chat',
      schemaVersion: 1,
      scrubbed: true,
      createdAt: source.exportedAt,
    })
    expect(doc).not.toHaveProperty('sourceBackend')
  })
  it('escapes all HTML text and creates no active markup, links, scripts or remote assets', () => {
    const html = renderChatShare(build(), 'html')
    expect(html).toContain('&lt;script&gt;')
    expect(html).not.toMatch(/<script|<img|<iframe|<a\s|onerror="alert|src="https:/i)
    expect(html).toContain("default-src 'none'")
    expect(html).toContain('color-scheme:light dark')
    expect(html).toContain('overflow-wrap:anywhere')
    expect(html).toContain('<main>')
    expect(html).toContain('<h1>')
  })
})
