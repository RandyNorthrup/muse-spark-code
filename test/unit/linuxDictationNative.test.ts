import { execFileSync, spawn } from 'node:child_process'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import { LineSplitter, parseHelperLine, type HelperLine } from '../../src/core/voice/dictation'

// These exercise the native Linux protocol with a test-only engine, never the microphone.
describe.skipIf(process.platform !== 'linux')(
  'Linux native helper with a fake engine (Linux build)',
  () => {
    let directory: string
    let helper: string
    const children: ReturnType<typeof spawn>[] = []
    afterEach(() => {
      for (const child of children.splice(0)) child.kill()
    })
    beforeAll(async () => {
      directory = await mkdtemp(path.join(tmpdir(), 'm9-native-'))
      helper = path.join(directory, 'helper')
      execFileSync('c++', [
        '-std=c++17',
        '-pthread',
        '-Wall',
        '-Wextra',
        '-Werror',
        '-Itest/native/dictation-linux',
        'native/dictation-linux/helper.cpp',
        '-lpulse-simple',
        '-lpulse',
        '-o',
        helper,
      ])
    })
    afterAll(async () => {
      await rm(directory, { recursive: true, force: true })
    })
    function run(
      args: string[],
      commands: string,
      shouldQuitAfterStop: boolean,
      env?: NodeJS.ProcessEnv,
    ): Promise<{ lines: HelperLine[]; code: number | null }> {
      return new Promise((resolve, reject) => {
        const child = spawn(helper, args, {
          env: env ?? { PULSE_SERVER: 'unix:/nonexistent-m9-pulse' },
        })
        children.push(child)
        const lines: HelperLine[] = []
        const splitter = new LineSplitter()
        child.on('error', reject)
        child.stdout.on('data', (chunk: Buffer) => {
          for (const raw of splitter.push(chunk)) {
            const parsed = parseHelperLine(raw)
            if (parsed === undefined) {
              reject(new Error('Malformed helper frame'))
              child.kill()
              return
            }
            lines.push(parsed)
            if (parsed.type === 'ready') child.stdin.write(commands)
            if (shouldQuitAfterStop && parsed.type === 'stopped') child.stdin.end('quit\n')
          }
        })
        child.on('exit', (code) => {
          resolve({ lines, code })
        })
      })
    }
    it('inserts the fake engine result exactly once before stopped and quits cleanly', async () => {
      const result = await run(
        ['--model', 'fake', '--input-wav', 'test/fixtures/dictation-linux/1.wav'],
        'start\n',
        true,
      )
      expect(result.code).toBe(0)
      expect(result.lines.map((line) => line.type)).toEqual([
        'ready',
        'listening',
        'text',
        'stopped',
      ])
      expect(result.lines[2]).toEqual({ type: 'text', text: 'Recognized fixture' })
    })
    it('model initialization failure is an error rather than an empty success', async () => {
      expect(await run(['--model', 'fail'], '', false)).toEqual({
        code: 1,
        lines: [{ type: 'error', reason: 'model-load' }],
      })
    })
    it('missing WAV or audio server is an explicit failure and never produces recognized text', async () => {
      const result = await run(
        ['--model', 'fake', '--input-wav', path.join(directory, 'missing.wav')],
        'start\n',
        true,
      )
      expect(result.lines).toContainEqual({ type: 'error', reason: 'input-wav' })
      expect(result.lines.some((line) => line.type === 'text')).toBe(false)
      const stereo = await readFile('test/fixtures/dictation-linux/1.wav')
      stereo.writeUInt16LE(2, 22)
      const unsupported = path.join(directory, 'stereo.wav')
      await writeFile(unsupported, stereo)
      const invalid = await run(['--model', 'fake', '--input-wav', unsupported], 'start\n', true)
      expect(invalid.lines).toContainEqual({ type: 'error', reason: 'input-wav' })
      expect(invalid.lines.some((line) => line.type === 'text')).toBe(false)
      const capture = await run(['--model', 'fake'], 'start\n', true)
      expect(capture.lines).toContainEqual({ type: 'error', reason: 'pulse-capture' })
      expect(capture.lines.some((line) => line.type === 'text')).toBe(false)
    })
    it('a network audio server is refused before any connection (RVCM9LNX P2)', async () => {
      // No listener is started: refusal happens before connecting, so this
      // also runs where loopback servers are unavailable.
      for (const server of ['tcp:127.0.0.1:47139', 'tcp:audio.example:4713', 'audio.example']) {
        const refused = await run(['--model', 'fake'], 'start\n', true, {
          PULSE_SERVER: server,
        })
        expect(refused.lines, server).toContainEqual({ type: 'error', reason: 'remote-server' })
        expect(
          refused.lines.some((line) => line.type === 'text'),
          server,
        ).toBe(false)
      }
    })
    it('an immediate stop drains capture and acknowledges once', async () => {
      const result = await run(
        ['--model', 'fake', '--input-wav', 'test/fixtures/dictation-linux/1.wav'],
        'start\nstop\n',
        true,
      )
      expect(result.lines[0]?.type).toBe('ready')
      expect(result.lines.filter((line) => line.type === 'stopped')).toHaveLength(1)
      expect(result.code).toBe(0)
    })
    it('unknown commands and unsupported arguments fail explicitly', async () => {
      const unknown = await run(['--model', 'fake'], 'unknown\n', false)
      expect(unknown.lines).toContainEqual({
        type: 'error',
        reason: 'command',
      })
      expect(await run(['--unexpected', 'value'], '', false)).toEqual({
        code: 1,
        lines: [{ type: 'error', reason: 'arguments' }],
      })
    })
  },
)
