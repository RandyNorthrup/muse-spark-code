// Test peer speaking the pipe-helper relay protocol (docs/design/
// vault-windows-pipe-helper.md), like sessionBrokerChild.ts speaks the
// broker session protocol: the outside world in bytes, driving the real
// PipeRelay class. Runs on any OS: no named pipes, only stdio frames.
import { Buffer } from 'node:buffer'

const HEADER = 9
const READY = 0x01
const OPEN = 0x02
const DATA = 0x03
const FAULT = 0x05
const FILE_RESULT = 0x06
const SERVER_RESULT = 0x07
const PROCESS_RESULT = 0x08
const SEND = 0x13
const CLOSE = 0x14
const FILE = 0x21
const SERVER = 0x22
const PROCESS = 0x23

const OWNER_SID = 'S-1-5-21-1-2-3-1001'
const EXECUTABLE = String.raw`C:\Windows\System32\peer.exe`
const STARTED_AT = 1_700_000_000_000

function frame(type, id, payload) {
  const header = Buffer.alloc(HEADER)
  header[0] = type
  header.writeUInt32BE(id, 1)
  header.writeUInt32BE(payload.length, 5)
  process.stdout.write(Buffer.concat([header, payload]))
}

function json(value) {
  return Buffer.from(JSON.stringify(value), 'utf8')
}

function clientRecord() {
  return {
    v: 1,
    processId: 4242,
    userId: OWNER_SID,
    startedAt: STARTED_AT,
    executable: EXECUTABLE,
    remote: false,
    ownerOnlyDacl: true,
  }
}

function onFrame(state, type, id, payload) {
  if (type === SEND) {
    frame(DATA, id, payload)
    return
  }
  if (type === CLOSE) return
  const request = JSON.parse(payload.toString('utf8'))
  if (type === FILE) {
    frame(FILE_RESULT, 0, json({ v: 1, id: request.id, result: 'ok' }))
    return
  }
  if (type === SERVER) {
    frame(
      SERVER_RESULT,
      0,
      json({
        v: 1,
        id: request.id,
        result: 'ok',
        ownerSid: OWNER_SID,
        server: clientRecord(),
      }),
    )
    return
  }
  if (type === PROCESS) {
    frame(
      PROCESS_RESULT,
      0,
      json({
        v: 1,
        id: request.id,
        result: 'ok',
        ownerSid: OWNER_SID,
        process: {
          processId: request.processId,
          userId: OWNER_SID,
          startedAt: STARTED_AT,
          executable: EXECUTABLE,
        },
      }),
    )
  }
}

function pump(state, chunk) {
  state.buffer = Buffer.concat([state.buffer, chunk])
  for (;;) {
    if (state.buffer.length < HEADER) return
    const type = state.buffer[0]
    const id = state.buffer.readUInt32BE(1)
    const length = state.buffer.readUInt32BE(5)
    if (state.buffer.length < HEADER + length) return
    const payload = state.buffer.subarray(HEADER, HEADER + length)
    state.buffer = state.buffer.subarray(HEADER + length)
    onFrame(state, type, id, Buffer.from(payload))
  }
}

function readyAndOpen(pipe, id) {
  const readyPayload = json({ v: 1, pipe, ownerSid: OWNER_SID })
  const readyHeader = Buffer.alloc(HEADER)
  readyHeader[0] = READY
  readyHeader.writeUInt32BE(0, 1)
  readyHeader.writeUInt32BE(readyPayload.length, 5)
  const openPayload = json(clientRecord())
  const openHeader = Buffer.alloc(HEADER)
  openHeader[0] = OPEN
  openHeader.writeUInt32BE(id, 1)
  openHeader.writeUInt32BE(openPayload.length, 5)
  // One write: READY and OPEN coalesced, like the helper's back-to-back frames.
  process.stdout.write(Buffer.concat([readyHeader, readyPayload, openHeader, openPayload]))
}

function main() {
  const state = { buffer: Buffer.alloc(0), mode: null, line: Buffer.alloc(0), nextId: 0 }
  const behavior = process.argv[2] ?? 'serve'
  process.stdin.on('data', (chunk) => {
    if (state.mode !== null) {
      pump(state, chunk)
      return
    }
    state.line = Buffer.concat([state.line, chunk])
    const end = state.line.indexOf('\n')
    if (end === -1) return
    const first = JSON.parse(state.line.subarray(0, end).toString('utf8'))
    state.line = state.line.subarray(end + 1)
    state.mode = first.mode
    if (behavior === 'fault') {
      frame(FAULT, 0, json('squatted'))
      process.exit(1)
    }
    if (behavior === 'garbage') {
      const header = Buffer.alloc(HEADER)
      header[0] = 0xff
      process.stdout.write(header)
      return
    }
    if (state.mode === 'serve') {
      state.nextId += 1
      readyAndOpen(first.pipe, state.nextId)
    }
    if (state.line.length > 0) pump(state, state.line)
  })
}

main()
