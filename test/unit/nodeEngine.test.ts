// M110b W1: the engine adapter builds versioned requests, parses
// daemon replies through zod, and selects runtimes without silent
// downgrade. Over recorded exchanges, captured 2026-10-22 from the
// rig's docker 29.2.1 over its socket (`curl --unix-socket
// /var/run/docker.sock …/version|info`, a real labelled container's
// list and inspect, the bridge network's inspect, the debian image's
// inspect for W2's digest read-back). Socket transport and lifecycle
// are proven by drill on the live daemon.
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  createBody,
  EngineError,
  enginePath,
  listQuery,
  MuxDemuxer,
  networkGateway,
  offeredRuntimes,
  parseImageInspect,
  parseInspect,
  parseNetwork,
  parseSummaries,
  parseVersion,
  selectRuntime,
  updateBody,
} from '../../src/runtime/node/sandbox/engine'

const FIXTURES = path.join(__dirname, '..', 'fixtures', 'engine')
const fixture = (name: string): unknown =>
  JSON.parse(readFileSync(path.join(FIXTURES, name), 'utf8')) as unknown

describe('engine adapter', () => {
  it('reads the daemon version, name and API version', () => {
    expect(parseVersion(fixture('version.json'))).toMatchObject({
      name: 'docker',
      serverVersion: '29.2.1',
    })
    expect(parseVersion(fixture('version.json')).apiVersion).toMatch(/^[0-9]+\.[0-9]+$/)
  })
  it('lists the offered runtimes from info', () => {
    expect(offeredRuntimes(fixture('info.json'))).toEqual(['io.containerd.runc.v2', 'runc'])
    expect(offeredRuntimes({})).toEqual([])
  })
  it('auto takes the engine default; anything else must be offered', () => {
    expect(selectRuntime(['runc'], 'auto')).toBeUndefined()
    expect(selectRuntime(['runc', 'kata'], 'kata')).toBe('kata')
    expect(selectRuntime([], 'runc', 'runc')).toBeUndefined()
    expect(() => selectRuntime(['runc'], 'kata')).toThrow(/not offered.*runc/)
  })
  it('parses the recorded list and inspect', () => {
    const summaries = parseSummaries(fixture('list.json'))
    expect(summaries.length).toBe(1)
    expect(summaries[0]).toMatchObject({ State: 'running' })
    expect(summaries[0]?.Labels['muse.test']).toBe('fixture')
    const inspect = parseInspect(fixture('inspect.json'))
    expect(inspect.State).toMatchObject({ Running: true, ExitCode: 0 })
  })
  it('reads the workspace gateway off the recorded network', () => {
    expect(networkGateway(parseNetwork(fixture('network.json')))).toBe('172.17.0.1')
  })
  it('reads the image id and repo digests off the recorded image', () => {
    const image = parseImageInspect(fixture('image.json'))
    expect(image.id).toBe('sha256:62bd423aeee912639ca8ee681c2b762cb3e25137e0a92b20be455898a9f034ad')
    expect(image.digests).toEqual([
      'debian@sha256:62bd423aeee912639ca8ee681c2b762cb3e25137e0a92b20be455898a9f034ad',
    ])
  })
  it('versions paths, filters lists by label, and shapes create and update', () => {
    expect(enginePath('1.44', '/containers/json')).toBe('/v1.44/containers/json')
    expect(listQuery('muse.node.sandbox')).toContain(encodeURIComponent('muse.node.sandbox'))
    const body = createBody(
      {
        image: 'debian:trixie-slim',
        name: 'ws-1',
        command: ['sleep', '60'],
        env: ['A=1'],
        binds: [{ host: '/ws', sandbox: '/workspace' }],
        network: 'ws-net',
        runtime: 'kata',
        memoryBytes: 1024,
        nanoCpus: 2,
        pidsLimit: 3,
        labels: { 'muse.node.workspace': 'ws' },
      },
      false,
      'docker',
    )
    expect(body).toMatchObject({
      Image: 'debian:trixie-slim',
      Cmd: ['sleep', '60'],
      Env: ['A=1'],
      Runtime: 'kata',
      Labels: { 'muse.node.sandbox': '1', 'muse.node.workspace': 'ws' },
    })
    expect(updateBody({ memoryBytes: 5 })).toEqual({ Memory: 5 })
    expect(updateBody({})).toEqual({})
  })
  it('demultiplexes the recorded exec stream, whole or a byte at a time', () => {
    const bytes = readFileSync(path.join(FIXTURES, 'exec-mux.bin'))
    const whole = new MuxDemuxer().push(bytes)
    expect(whole.map((frame) => [frame.stream, frame.payload.toString('utf8')])).toEqual([
      ['stdout', 'out\n'],
      ['stderr', 'err\n'],
    ])
    const split = new MuxDemuxer()
    const frames = []
    for (let at = 0; at < bytes.length; at += 1) {
      frames.push(...split.push(bytes.subarray(at, at + 1)))
    }
    expect(frames.map((frame) => [frame.stream, frame.payload.toString('utf8')])).toEqual([
      ['stdout', 'out\n'],
      ['stderr', 'err\n'],
    ])
    expect(() => new MuxDemuxer().push(Buffer.from([3, 0, 0, 0, 0, 0, 0, 1, 120]))).toThrow(
      EngineError,
    )
  })
  it('relabels binds for podman on SELinux, and only then', () => {
    const binds = [{ host: '/ws', sandbox: '/workspace' }]
    const podman = createBody({ image: 'i', binds }, true, 'podman') as {
      HostConfig: { Binds: string[] }
    }
    expect(podman.HostConfig.Binds).toEqual(['/ws:/workspace:rw:z'])
    const docker = createBody({ image: 'i', binds }, true, 'docker') as {
      HostConfig: { Binds: string[] }
    }
    expect(docker.HostConfig.Binds).toEqual(['/ws:/workspace:rw'])
    const plain = createBody({ image: 'i', binds }, false, 'podman') as {
      HostConfig: { Binds: string[] }
    }
    expect(plain.HostConfig.Binds).toEqual(['/ws:/workspace:rw'])
  })
})
