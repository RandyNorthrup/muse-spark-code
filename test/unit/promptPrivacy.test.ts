import { describe, expect, it } from 'vitest'
import { promptPrivacy } from '../../src/core/prompts/promptPrivacy'
import { scrubShareText } from '../../src/shared/share'

describe('prompt privacy adapter', () => {
  it('scrubs known/registered values and the user name while preserving relative workspace paths', () => {
    const privacy = promptPrivacy({
      workspaceRoots: ['/work with spaces/project'],
      home: '/home/Private User',
      user: 'PrivateUser',
      registeredSecrets: () => ['registered-value'],
    })
    const text = scrubShareText(
      'registered-value LLM_ABCDEFGHIJKLMNOP123456 /work with spaces/project/src/main.ts /home/Private User/data PrivateUser PRIVATEUSER /outside/path',
      privacy,
    )
    expect(text).toBe('[redacted] [redacted] src/main.ts [home]/data [user] [user] [path]')
    expect(scrubShareText(text, privacy)).toBe(text)
    expect(scrubShareText('/work with spaces/project-other/file', privacy)).toBe(
      '[path] with spaces/project-other/file',
    )
  })
  it('covers drive/UNC paths, escaped separators, file URLs and case variations', () => {
    const privacy = promptPrivacy({
      workspaceRoots: [String.raw`C:\work root\repo`],
      home: String.raw`C:\Users\Private User`,
      user: 'private-user',
      registeredSecrets: () => [],
    })
    const result = scrubShareText(
      String.raw`c:\WORK ROOT\repo\src\main.ts C:\\work root\\repo\\src\\other.ts C:\Users\Private User\file \\server\share\file file:///outside/path`,
      privacy,
    )
    expect(result).toBe(String.raw`src/main.ts src/other.ts [home]\file [path] [path]`)
    expect(scrubShareText('https://example.org/page ordinary words', privacy)).toBe(
      'https://example.org/page ordinary words',
    )
  })
})
