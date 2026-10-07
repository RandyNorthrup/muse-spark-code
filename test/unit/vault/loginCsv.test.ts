import { randomBytes } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { parseLoginCsv, type LoginCsvColumns } from '../../../src/core/vault/migrate/loginCsv'
import { parseAmbientCredentials } from '../../../src/core/vault/migrate/ambientCredentials'

const columns: LoginCsvColumns = {
  label: 'name',
  url: 'url',
  username: 'username',
  password: 'password',
  totpSeed: 'totp',
}

describe('explicit credential-file decoders', () => {
  it('refuses TOTP imports without L decoder instead of storing an encoded string as a seed', () => {
    const value = randomBytes(32).toString('hex')
    expect(() =>
      parseLoginCsv(
        Buffer.from(
          `name,url,username,password,totp\nLogin,https://example.test,user,${value},${value}`,
        ),
        columns,
        null,
      ),
    ).toThrow()
  })
  it('imports reviewed CSV mappings with quoted commas/quotes/multiline passwords and IDNA origins', () => {
    const password = `${randomBytes(32).toString('hex')},"\r\nend`
    const username = randomBytes(16).toString('hex')
    const seed = randomBytes(32).toString('hex')
    const csv = `\u{FEFF}name,url,username,password,totp\r\n"Login, example",https://bücher.example/login,${username},"${password.replaceAll('"', '""')}",${seed}\r\n`
    const result = parseLoginCsv(Buffer.from(csv), columns, (encoded) =>
      Uint8Array.from(Buffer.from(encoded, 'hex')),
    )
    expect(result).toHaveLength(1)
    expect(result[0]!.label).toBe('Login, example')
    const material = result[0]!.material
    expect(material.origins).toEqual(['https://xn--bcher-kva.example'])
    expect(Buffer.from(material.password).toString()).toBe(password)
    expect(Buffer.from(material.username).toString()).toBe(username)
    expect(Buffer.from(material.totpSeed!).toString('hex')).toBe(seed)
    for (const value of Object.values(material)) if (value instanceof Uint8Array) value.fill(0)
  })
  it.each([
    `name,url,username,password,totp\nLogin,${['http', ':'].join('')}//example.test,user,pass,`,
    'name,url,username,password,totp\nLogin,https://user:pass@example.test,user,pass,',
    'name,url,username,password,totp\nLogin,https://example.test,user,"unterminated,',
    'name,url,username,password,totp\nLogin,https://example.test,user,pass,"unterminated',
    'name,url,username,password,totp,name\nLogin,https://example.test,user,pass,,Other',
    'name,url,username,password,totp\nLogin,https://example.test,user,pass,,Extra',
    'name,url,username,password,totp\nLogin,https://example.test,user,"closed"junk,',
    'name,url,username,password,password\nLogin,https://example.test,user,pass,',
    'name,url,username,password,totp\nLogin,https://example.test,user,',
    'name,url,username,password,totp\n',
    '{"passkey":{"privateKey":"invalid"}}',
  ])(
    'refuses malformed, ambiguous or insecure CSV without returning partial success: %s',
    (csv) => {
      expect(() => parseLoginCsv(Buffer.from(csv), columns, () => new Uint8Array([1]))).toThrow()
    },
  )
  it('imports literal git/netrc/npm/AWS/Docker credentials without reading external helpers or environments', () => {
    const value = randomBytes(32).toString('hex')
    const username = randomBytes(16).toString('hex')
    const cases = [
      { kind: 'git', text: `https://${username}:${value}@example.test/repo`, count: 1 },
      {
        kind: 'netrc',
        text: `# comment\nmachine example.test login ${username} password "${value}#suffix"`,
        count: 1,
      },
      {
        kind: 'npm',
        text: `registry=https://example.test\n//example.test/:_authToken=${value}`,
        count: 1,
      },
      {
        kind: 'aws',
        text: `[profile]\naws_access_key_id=${username}\naws_secret_access_key=${value}\naws_session_token=${value}`,
        count: 3,
      },
      {
        kind: 'docker',
        text: JSON.stringify({
          auths: {
            'example.test': { auth: Buffer.from(`${username}:${value}`).toString('base64') },
          },
          credsStore: 'never-run',
        }),
        count: 1,
      },
    ] as const
    for (const entry of cases) {
      const parsed = parseAmbientCredentials(entry.kind, Buffer.from(entry.text))
      expect(parsed).toHaveLength(entry.count)
      for (const record of parsed) {
        expect(record.target).not.toContain(value)
        if (record.material.kind === 'password')
          expect(Buffer.from(record.material.password).toString()).toBe(
            entry.kind === 'netrc' ? `${value}#suffix` : value,
          )
        for (const field of Object.values(record.material))
          if (field instanceof Uint8Array) field.fill(0)
      }
    }
  })
  it('refuses unresolved environment references, duplicate/targetless credentials and helper-only Docker stores', () => {
    const value = randomBytes(32).toString('hex')
    expect(() =>
      parseAmbientCredentials('npm', Buffer.from('//example.test/:_authToken=${ENV_TOKEN}')),
    ).toThrow()
    expect(() =>
      parseAmbientCredentials(
        'aws',
        Buffer.from(`[a]\naws_secret_access_key=${value}\naws_secret_access_key=${value}`),
      ),
    ).toThrow()
    expect(() =>
      parseAmbientCredentials('docker', Buffer.from('{"credsStore":"external"}')),
    ).toThrow()
    expect(() =>
      parseAmbientCredentials('docker', Buffer.from('{"auths":{"x":{"auth":"bad base64"}}}')),
    ).toThrow()
    expect(() =>
      parseAmbientCredentials('netrc', Buffer.from(`default login user password ${value}`)),
    ).toThrow()
    expect(() =>
      parseAmbientCredentials('git', Buffer.from(`http://user:${value}@example.test`)),
    ).toThrow()
  })
})
