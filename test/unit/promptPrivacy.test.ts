import { describe, expect, it } from 'vitest'
import { promptPrivacy } from '../../src/core/prompts/promptPrivacy'
import { scrubShareText } from '../../src/shared/share'

describe('prompt privacy adapter', () => {
  it('treats regex metacharacters in roots, home and user names as literal text', () => {
    const name = 'Alice([a-z]+)+$^?{2}|[x].End'
    const privacy = promptPrivacy({
      workspaceRoots: [`C:/work/${name}`],
      home: `C:/Users/${name}`,
      user: name,
      registeredSecrets: () => [],
    })
    expect(
      scrubShareText(`C:/work/${name}/src/main.ts C:/Users/${name}/data owner: ${name}`, privacy),
    ).toBe('src/main.ts [home]/data owner: [user]')
    expect(scrubShareText(`C:/work/${name}/src/main.ts`.replaceAll('/', '\\'), privacy)).toBe(
      'src/main.ts',
    )
    expect(scrubShareText('AliceaaaaEnd unrelated words', privacy)).toBe(
      'AliceaaaaEnd unrelated words',
    )
  })
  it('scrubs known/registered values and the user name while preserving relative workspace paths', () => {
    const privacy = promptPrivacy({
      workspaceRoots: ['/work with spaces/project'],
      home: '/home/Private User',
      user: 'PrivateUser',
      registeredSecrets: () => ['registered-value'],
    })
    const text = scrubShareText(
      'registered-value LLM_ABCDEFGHIJKLMNOP123456 /work with spaces/project/src/main.ts /home/Private User/data owner: PrivateUser username=PRIVATEUSER /outside/path',
      privacy,
    )
    expect(text).toBe(
      '[redacted] [redacted] src/main.ts [home]/data owner: [user] username=[user] [path]',
    )
    expect(scrubShareText(text, privacy)).toBe(text)
    expect(scrubShareText('/work with spaces/project-other/file', privacy)).toBe(
      '[path] with spaces/project-other/file',
    )
  })
  it.each(['user', 'admin', 'test', 'randy.northrup'])(
    'scrubs only path segments and identity fields for %s',
    (user) => {
      const privacy = promptPrivacy({
        workspaceRoots: ['/work'],
        home: `/home/${user}`,
        user,
        registeredSecrets: () => [],
      })
      const ordinary = `The user can admin a test. Say ${user}. {"scope":"user","tags":["admin","test"]}`
      expect(scrubShareText(ordinary, privacy)).toBe(ordinary)
      for (const relative of [
        `team/${user}-guide/file`,
        `team/prefix.${user}/file`,
        `${user}.ts`,
      ]) {
        expect(scrubShareText(relative, privacy)).toBe(relative)
      }
      for (const input of [
        `/work/team/${user}/notes`,
        String.raw`C:\work\team\${user}\notes`,
        `team/${user}/notes`,
        `team\\${user}\\notes`,
      ]) {
        expect(scrubShareText(input, privacy)).toMatch(/\[user\]|\[path\]/)
      }
      for (const label of ['user', 'username', 'owner', 'author', 'account', 'login']) {
        for (const text of [
          `${label}: ${user}`,
          `${label}=${user}`,
          `"${label}": "${user.toUpperCase()}"`,
        ]) {
          expect(scrubShareText(text, privacy)).toContain('[user]')
        }
      }
      expect(scrubShareText(`owner: ${user}Extra`, privacy)).toBe(`owner: ${user}Extra`)
    },
  )
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
  it.each(['user', 'home', 'src', 'team'])(
    'is a fixed point for %s across nested paths and both separators',
    (user) => {
      const privacy = promptPrivacy({
        workspaceRoots: ['/work', String.raw`C:\work`],
        home: `/home/${user}`,
        user,
        registeredSecrets: () => [],
      })
      const messages = [
        `/work/team/${user}/src/main.ts`,
        `/work/team/${user}/src/main.ts`.replaceAll('/', '\\'),
        `C:\\work\\team\\${user}\\src\\main.ts`,
        `/home/${user}/team/${user}/src/main.ts`,
        `/work/a/${user}/b/${user}/c.ts`,
        `see /work/team/${user}/src/main.ts for details`,
        `owner: ${user}`,
      ]
      for (const message of messages) {
        const once = scrubShareText(message, privacy)
        expect(scrubShareText(once, privacy), message).toBe(once)
      }
    },
  )
})
