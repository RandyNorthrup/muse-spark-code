import { describe, expect, it } from 'vitest'
import { buildChatShare, renderChatShare } from '../../src/core/sharing/chatShare'
import { createChatSharePrivacy } from '../../src/core/sharing/privacy'
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
