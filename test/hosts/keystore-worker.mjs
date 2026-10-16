// One process of the credential-store proof: the real keyringSecretStore over
// the real OS credential store (@napi-rs/keyring), on a throwaway lock scope
// and throwaway accounts handed in by the test. The only thing this process
// adds is the scheduling of the OS calls, which the test needs to be
// deterministic (a real race is too narrow to hit by chance):
//   dieAt             SIGKILL itself at that OS call, no cleanup, as a killed process stops
//   pauseBeforeHeader stop before the call that publishes a parts header, and wait
//   pauseAfterHeader  stop after the call that read a parts header, and wait
// A pause says so on stdout ({"paused": ...}) and waits for `resumeFile` to exist.
// Commands arrive as JSON lines on stdin; each is answered with one JSON line.
// No credentials and no service traffic: every value is a random throwaway.
import { existsSync } from 'node:fs'
import { createRequire } from 'node:module'
import { createInterface } from 'node:readline'
import { setTimeout as delay } from 'node:timers/promises'

const require = createRequire(import.meta.url)
const { keyringSecretStore } = require(process.argv[2])
const { AsyncEntry } = require('@napi-rs/keyring')
const scope = process.argv[3]
const schedule = process.argv[4] === undefined ? {} : JSON.parse(process.argv[4])
const HEADER_TAG = 'muse-spark-parts:v1:'

const reply = (value) => process.stdout.write(`${JSON.stringify(value)}\n`)
// What this process has done so far: its OS calls, and whether it has paused already.
const progress = { calls: 0, hasPaused: false }

async function pause(where) {
  // One pause per process: a read reads its header twice (before the lock, then under it).
  if (progress.hasPaused) return
  progress.hasPaused = true
  reply({ paused: where })
  while (!existsSync(schedule.resumeFile)) await delay(20)
}

async function step(run) {
  progress.calls += 1
  if (schedule.dieAt !== undefined && progress.calls === schedule.dieAt)
    process.kill(process.pid, 'SIGKILL')
  return await run()
}

// Native enumeration returns passwords as well as names. Keep every OS call
// in a test-only service so even cleanup cannot read the owner's credentials.
const open = (service, account) => {
  const entry = new AsyncEntry(`${service}.test.${scope}`, account)
  const isHeaderAccount = !account.includes('#')
  return {
    getPassword: async () => {
      const value = await step(() => entry.getPassword())
      if (isHeaderAccount && schedule.pauseAfterHeader === true && value?.startsWith(HEADER_TAG))
        await pause('after-header-read')
      return value
    },
    setPassword: async (value) => {
      if (isHeaderAccount && schedule.pauseBeforeHeader === true && value.startsWith(HEADER_TAG))
        await pause('before-header-write')
      return await step(() => entry.setPassword(value))
    },
    deletePassword: () => step(() => entry.deletePassword()),
  }
}
const store = keyringSecretStore(open, { lockScope: scope })

async function answer(command) {
  switch (command.op) {
    case 'store': {
      await store.store(command.account, command.value)
      return { ok: true, calls: progress.calls }
    }
    case 'get': {
      const value = await store.get(command.account)
      return { ok: true, value: value ?? null }
    }
    case 'delete': {
      await store.delete(command.account)
      return { ok: true }
    }
    default: {
      return { ok: false, error: 'unknown op' }
    }
  }
}

const lines = createInterface({ input: process.stdin })
for await (const line of lines) {
  try {
    reply(await answer(JSON.parse(line)))
  } catch (error) {
    reply({ ok: false, error: error instanceof Error ? error.name : 'error' })
  }
}
