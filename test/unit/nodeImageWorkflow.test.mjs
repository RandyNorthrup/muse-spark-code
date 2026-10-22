import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import { nodeImageChannel } from '../../scripts/retain-node-images.mjs'
import { recordCalls } from './helpers/recordCalls'

const image = 'ghcr.io/randynorthrup/muse-spark-code-node'
const currentDigest = `sha256:${'1'.repeat(64)}`
const candidateDigest = `sha256:${'2'.repeat(64)}`
const registryVersion = (id, tags) => ({
  id,
  name: currentDigest,
  created_at: '2026-10-05T00:00:00Z',
  metadata: { container: { tags } },
})
const channelOf = (tag) => (tag.includes('-') ? 'preview' : 'stable')
const command = { file: process.execPath, args: ['docker-stub.mjs'] }

/** A recording executor over the product's real helper and schemas. */
function stubExecute(implementation) {
  const calls = recordCalls()
  const execute = (...args) => {
    calls.fn(...args)
    return implementation(...args)
  }
  return { calls: calls.calls, execute }
}
const inspectCurrent = () => JSON.stringify({ digest: currentDigest })
function inspectError(stderr) {
  const error = new Error(`Command failed: ${stderr}`)
  error.status = 1
  error.stderr = stderr
  throw error
}
const missingChannel = (file, args) => inspectError(`ERROR: ${args.at(-1)}: not found`)

describe('node image channel promotion', () => {
  it.each([
    ['v0.14.0', 'v0.15.0'],
    ['v0.9.0', 'v0.10.0'],
    ['v0.14.0', 'v1.0.0'],
    ['v0.15.0-beta.2', 'v0.15.0-beta.10'],
    ['v0.15.0-alpha', 'v0.15.0-beta'],
    ['v0.15.0-9', 'v0.15.0-alpha'],
    ['v0.15.0-beta', 'v0.15.0'],
    ['v0.14.0', 'v0.15.0+build.4'],
    ['v0.9007199254740992.0', 'v0.9007199254740993.0'],
  ])('leaves the channel alone for recovery %s from %s', (tag, current) => {
    const channel = channelOf(tag)
    const { calls, execute } = stubExecute(inspectCurrent)
    expect(
      nodeImageChannel(tag, [[registryVersion(1, [channel, current])]], command, execute),
    ).toBe('')
    expect(calls).toHaveLength(1)
  })
  it.each([
    ['v0.15.0', 'v0.14.0'],
    ['v0.10.0', 'v0.9.0'],
    ['v1.0.0', 'v0.15.0'],
    ['v0.15.0', 'v0.15.0'],
    ['v0.15.0-beta.10', 'v0.15.0-beta.2'],
    ['v0.15.0-beta', 'v0.15.0-alpha'],
    ['v0.15.0-beta.1', 'v0.15.0-beta'],
    ['v0.15.0-alpha', 'v0.15.0-9'],
    ['v0.15.0-beta.1', 'v0.15.0-beta.1'],
    ['v0.15.0', 'v0.15.0-beta'],
    ['v0.15.0', 'v0.15.0+build.4'],
    ['v0.9007199254740993.0', 'v0.9007199254740992.0'],
    ['v0.15.0', undefined],
    ['v0.15.0-beta.1', undefined],
  ])('advances or initializes the channel for %s from %s', (tag, current) => {
    const channel = channelOf(tag)
    const pages = [current === undefined ? [] : [registryVersion(1, [channel, current])]]
    const inspect = current === undefined ? missingChannel : inspectCurrent
    const { execute } = stubExecute(inspect)
    expect(nodeImageChannel(tag, pages, command, execute)).toBe(channel)
  })
  it('checks every release alias of the current channel before advancing', () => {
    const pages = [[], [registryVersion(1, ['stable', 'v0.13.0', 'v0.15.0'])]]
    const { execute } = stubExecute(inspectCurrent)
    expect(nodeImageChannel('v0.14.0', pages, command, execute)).toBe('')
  })
  it.each([
    { failure: 'registry refused' },
    { failure: 'registry unavailable', status: 1 },
    { pages: [[]] },
    { changedDigest: true },
    { pages: [[registryVersion(1, ['stable'])]] },
    { pages: [[registryVersion(1, ['stable', 'v0.015.0'])]] },
    { pages: [[registryVersion(1, ['stable', 'v0.15.0-beta.01'])]] },
    { pages: [[{ ...registryVersion(1, ['stable', 'v0.15.0']), id: 'invalid' }]] },
    {
      pages: [
        [registryVersion(1, ['stable', 'v0.15.0'])],
        [registryVersion(2, ['stable', 'v0.14.0'])],
      ],
    },
    { pages: [[{ metadata: { container: { tags: ['stable', 'v0.15.0'] } } }]] },
  ])('refuses promotion when current channel state is unavailable or invalid: %j', (options) => {
    const { execute } = stubExecute(() => {
      if (options.failure !== undefined) {
        if (options.status === 1) inspectError(options.failure)
        throw new Error(options.failure)
      }
      return JSON.stringify({ digest: options.changedDigest ? candidateDigest : currentDigest })
    })
    expect(() =>
      nodeImageChannel(
        'v0.14.0',
        options.pages ?? [[registryVersion(1, ['stable', 'v0.15.0'])]],
        command,
        execute,
      ),
    ).toThrow()
  })
  it('refuses the channel when first-time inspection is ambiguous', () => {
    const { execute } = stubExecute(() => inspectError('unexpected status: 401 Unauthorized'))
    expect(() => nodeImageChannel('v0.15.0-beta.1', [[]], command, execute)).toThrow(
      'Current node image channel lookup failed',
    )
  })
  it('refuses to initialize a channel when registry inspection is unavailable', () => {
    const { execute } = stubExecute(() => inspectError('registry unavailable'))
    expect(() => nodeImageChannel('v0.14.0', [[]], command, execute)).toThrow(
      'Current node image channel lookup failed',
    )
  })
  it('refuses every promotion when the candidate is not a release version', () => {
    const { calls, execute } = stubExecute(inspectCurrent)
    expect(() =>
      nodeImageChannel(
        'notaversion',
        [[registryVersion(1, ['stable', 'v0.15.0'])]],
        command,
        execute,
      ),
    ).toThrow('Valid SemVer release tag required')
    expect(calls).toEqual([])
  })
  it('passes the configured executable and argument prefix directly without a shell', () => {
    const { calls, execute } = stubExecute(inspectCurrent)
    const configured = { file: process.execPath, args: ['a path with spaces & symbols.mjs'] }
    expect(
      nodeImageChannel(
        'v0.15.0',
        [[registryVersion(1, ['stable', 'v0.14.0'])]],

        configured,
        execute,
      ),
    ).toBe('stable')
    expect(calls).toEqual([
      [
        configured.file,
        [
          ...configured.args,
          'buildx',
          'imagetools',
          'inspect',
          '--format',
          '{{json .Manifest}}',
          `${image}:stable`,
        ],
        { encoding: 'utf8', stdio: 'pipe', shell: false },
      ],
    ])
  })
  it.each([
    null,
    'docker',
    {},
    { file: '', args: [] },
    { file: 42, args: [] },
    { file: 'docker' },
    { file: 'docker', args: '--version' },
    { file: 'docker', args: [42] },
    { file: 'docker', args: [], shell: true },
  ])('rejects an invalid Docker command before executing: %j', (configured) => {
    const { calls, execute } = stubExecute(inspectCurrent)
    expect(() => nodeImageChannel('v0.15.0', [[]], configured, execute)).toThrow(z.ZodError)
    expect(calls).toEqual([])
  })
})
