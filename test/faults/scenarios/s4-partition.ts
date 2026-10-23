// S4: partition, clock skew and resend across a real network namespace
// (M110r Y4). The node end runs under `ip netns exec` on its own veth:
// a one-way loss partition (tc, else a full link-down where tc is
// missing, said aloud) reads unreachable with retries running, the link
// heals and the node rejoins within the target, the queued result
// re-sends and the current epoch lands it, and heartbeats stamped an
// hour ahead never break liveness (arrivals appraise on the monotonic
// clock, never the frame's wall time). Needs Linux with root or
// passwordless sudo; refuses loudly otherwise.
import { spawn, type ChildProcess } from 'node:child_process'
import { performance } from 'node:perf_hooks'
import path from 'node:path'
import { AddressBook } from '../../../src/core/devices/addressBook'
import { LivenessTracker } from '../../../src/core/devices/liveness'
import { intakeResult, ResultQueue } from '../../../src/core/devices/resultQueue'
import { NODE_REDISCOVER_TARGET_MS } from '../../../src/shared/constants'
import {
  checkFact,
  FaultAssertion,
  FaultRefused,
  namespaceIp,
  probeNamespaces,
} from '../../../scripts/lib/faultRig.mjs'
import type { FaultScenario } from '../scenario'
import { acceptOne, closeServer, listenOn } from '../lib/pair'

const NODE_ID = 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad'
const NS = 'fault-node'
const VETH_HOST = 'fault-h'
const VETH_NS = 'fault-n'
const HOST_IP = '10.99.0.1'
const NODE_IP = '10.99.0.2'
const SKEW_MS = 3_600_000

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms)
  })
}

async function waitFor(isMet: () => boolean, what: string): Promise<void> {
  const started = performance.now()
  while (!isMet()) {
    if (performance.now() - started > 10_000) {
      throw new FaultAssertion(`timed out waiting for ${what}`)
    }
    await sleep(20)
  }
}

export const scenario: FaultScenario = {
  name: 's4-partition',
  needs: 'namespaces',
  run: async (repoRoot: string): Promise<void> => {
    const probe = await probeNamespaces()
    if (!probe.ok) throw new FaultRefused(`namespaces unavailable: ${probe.reason}`)
    const sudo = probe.sudo
    const ip = async (args: string[]): Promise<string> => await namespaceIp(sudo, args)
    const runRoot = async (args: string[]): Promise<void> => {
      const binary = sudo.length > 0 ? sudo[0] : undefined
      const command = binary ?? 'ip'
      const commandArgs = binary === undefined ? [...args] : [...sudo.slice(1), 'ip', ...args]
      await new Promise<void>((resolve, reject) => {
        const child = spawn(command, commandArgs, { stdio: ['ignore', 'pipe', 'pipe'] })
        let stderr = ''
        child.stderr.on('data', (chunk: Buffer) => {
          stderr += chunk.toString('utf8')
        })
        child.on('error', (error: unknown) => {
          reject(error instanceof Error ? error : new Error(String(error)))
        })
        child.on('close', (code: number | null) => {
          if (code === 0) resolve(undefined)
          else reject(new Error(`ip ${args.join(' ')} exited ${String(code)}: ${stderr}`))
        })
      })
    }

    const book = new AddressBook()
    const tracker = new LivenessTracker({ heartbeatMs: 30, missCount: 2 })
    const seenSeqs: number[] = []
    const seenWalls: number[] = []
    const queue = new ResultQueue()
    book.remember(NODE_ID, 'ns-node', [`${NODE_IP}:0`], Date.now())

    try {
      await runRoot(['netns', 'add', NS])
    } catch {
      await runRoot(['netns', 'delete', NS])
      await runRoot(['netns', 'add', NS])
    }
    let responder: ChildProcess | undefined
    try {
      await ip(['link', 'add', VETH_HOST, 'type', 'veth', 'peer', 'name', VETH_NS])
      await ip(['link', 'set', VETH_NS, 'netns', NS])
      await ip(['addr', 'add', `${HOST_IP}/24`, 'dev', VETH_HOST])
      await ip(['link', 'set', VETH_HOST, 'up'])
      await runRoot(['netns', 'exec', NS, 'ip', 'addr', 'add', `${NODE_IP}/24`, 'dev', VETH_NS])
      await runRoot(['netns', 'exec', NS, 'ip', 'link', 'set', VETH_NS, 'up'])
      await runRoot(['netns', 'exec', NS, 'ip', 'link', 'set', 'lo', 'up'])

      const home = await listenOn(HOST_IP)
      const startNode = async () => {
        const responderPath = path.join(repoRoot, 'test', 'faults', 'lib', 'nsResponder.mjs')
        const responderArgs = [
          'netns',
          'exec',
          NS,
          process.execPath,
          responderPath,
          '--home',
          `${HOST_IP}:${String(home.port)}`,
          '--skew-ms',
          String(SKEW_MS),
        ]
        const binary = sudo.length > 0 ? sudo[0] : undefined
        const child = spawn(
          binary ?? 'ip',
          binary === undefined ? responderArgs : [...sudo.slice(1), 'ip', ...responderArgs],
          { stdio: ['ignore', 'ignore', 'ignore'] },
        )
        responder = child
        let spawnError: unknown
        child.on('error', (error: unknown) => {
          spawnError = error
        })
        const homeEnd = await acceptOne(home.server, {
          label: 'home',
          tracker,
          onBeat: (beat) => {
            seenSeqs.push(beat.seq)
            seenWalls.push(beat.wall)
            tracker.onHeartbeat(beat.seq, performance.now(), Date.now())
          },
        })
        return { homeEnd, spawnError: () => spawnError }
      }
      try {
        let started = await startNode()
        try {
          await waitFor(
            () => tracker.view(performance.now(), Date.now()).state === 'online',
            'the namespaced node online',
          )
          checkFact(seenSeqs.length > 0, 'heartbeats cross the veth')
          checkFact(started.spawnError() === undefined, 'the namespaced responder started')
          // Skew proof: every frame is stamped an hour ahead, yet the
          // node reads online, because arrivals appraise on the
          // monotonic clock.
          const now = Date.now()
          checkFact(
            seenWalls.length > 0 && seenWalls.every((wall) => wall > now),
            'frames stamped an hour ahead still read online',
          )

          // Partition one way (the node's egress drops whole) where tc
          // runs, else the whole link down, said aloud either way.
          let isOneWay = true
          try {
            await runRoot([
              'netns',
              'exec',
              NS,
              'tc',
              'qdisc',
              'add',
              'dev',
              VETH_NS,
              'root',
              'netem',
              'loss',
              '100%',
            ])
          } catch {
            isOneWay = false
            await ip(['link', 'set', VETH_HOST, 'down'])
          }
          process.stdout.write(
            isOneWay
              ? 'partition: one-way (tc loss 100%)\n'
              : 'partition: full (link down; tc missing)\n',
          )
          const lastBefore = seenSeqs.at(-1) ?? 0
          tracker.onAttemptScheduled(1, 100, Date.now(), [
            { path: 'address', lastSeenWall: Date.now() },
          ])
          await waitFor(
            () => tracker.view(performance.now(), Date.now()).state === 'unreachable',
            'unreachable across the partition',
          )
          checkFact(
            tracker.view(performance.now(), Date.now()).attempt === 1,
            'the waiting row names the retry attempt',
          )

          // Work queues behind the partition instead of failing.
          queue.enqueue({
            id: 'q1',
            taskId: 't1',
            attemptId: 'a1',
            epoch: 3,
            kind: 'result',
            stepKey: 'p/t1/a1/3/9/abc',
            body: { lines: 3 },
            enqueuedAtWall: Date.now(),
          })
          checkFact(queue.pendingCount() === 1, 'one result waits out the partition')

          // Heal: beats resume, the node rejoins within the target, the
          // queued result re-sends and the current epoch lands it. A
          // link-down kills the responder's socket, so the full
          // partition redials; the one-way loss heals on the same one.
          const healedAt = performance.now()
          if (isOneWay) {
            await runRoot(['netns', 'exec', NS, 'tc', 'qdisc', 'del', 'dev', VETH_NS, 'root'])
          } else {
            await ip(['link', 'set', VETH_HOST, 'up'])
            started.homeEnd.close()
            responder?.kill('SIGKILL')
            started = await startNode()
          }
          await waitFor(
            () =>
              tracker.view(performance.now(), Date.now()).state === 'online' &&
              (seenSeqs.at(-1) ?? 0) > lastBefore,
            'the rejoin after the heal',
          )
          checkFact(
            performance.now() - healedAt < NODE_REDISCOVER_TARGET_MS,
            'the partitioned node rejoins within the rediscovery target',
          )
          const pending = queue.pending()
          checkFact(pending.length === 1, 'the queued result re-sends after the heal')
          const first = pending[0]
          checkFact(first !== undefined, 'the re-sent result is present')
          checkFact(
            intakeResult(3, first).status === 'accepted',
            'the current epoch lands the re-sent result',
          )
          queue.acknowledge('q1')
          checkFact(queue.pendingCount() === 0, 'the acknowledgement drains the queue')
        } finally {
          started.homeEnd.close()
        }
      } finally {
        await closeServer(home.server)
      }
    } finally {
      responder?.kill('SIGKILL')
      try {
        await runRoot(['netns', 'delete', NS])
      } catch {
        // Already gone is clean enough.
      }
      try {
        await ip(['link', 'delete', VETH_HOST])
      } catch {
        // Already gone is clean enough.
      }
    }
  },
}
