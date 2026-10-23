// S3: the node's address changes mid-job (M110r Y4). Heartbeats flow
// over loopback; the node end moves to a new port (a new DHCP address)
// and dials home with it inside the channel. The orchestrator end
// re-resolves by identity: the stale address fails, the new one wins
// first-handshake-wins, the address book reorders, liveness flaps
// unreachable and back to online, the duplicate dial-home connection is
// closed, the sequence ledger shows no dupes, and the rejoin lands
// within the rediscovery target.
import { performance } from 'node:perf_hooks'
import { AddressBook, firstHandshakeWins } from '../../../src/core/devices/addressBook'
import { LivenessTracker } from '../../../src/core/devices/liveness'
import { NODE_REDISCOVER_TARGET_MS } from '../../../src/shared/constants'
import { checkFact } from '../../../scripts/lib/faultRig.mjs'
import type { FaultScenario } from '../scenario'
import { acceptOne, closeServer, dialEnd, listenOn, type PairEnd } from '../lib/pair'

const NODE_ID = 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad'
const BEAT_MS = 20
const TRACKER_BEAT_MS = 30
const TRACKER_MISS = 2

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms)
  })
}

export const scenario: FaultScenario = {
  name: 's3-renumber',
  needs: 'loopback',
  run: async (): Promise<void> => {
    const book = new AddressBook()
    const tracker = new LivenessTracker({ heartbeatMs: TRACKER_BEAT_MS, missCount: TRACKER_MISS })
    const seenSeqs: number[] = []
    const onBeat = (beat: { seq: number }): void => {
      seenSeqs.push(beat.seq)
      tracker.onHeartbeat(beat.seq, performance.now(), Date.now())
    }
    let nodeSeq = 0
    const nextBeat = (addresses?: readonly string[]) => {
      nodeSeq += 1
      return {
        from: 'node',
        seq: nodeSeq,
        wall: Date.now(),
        ...(addresses !== undefined && { addresses }),
      }
    }

    const home = await listenOn('127.0.0.1')
    const first = await listenOn('127.0.0.1')
    const firstAddress = `127.0.0.1:${String(first.port)}`
    book.remember(NODE_ID, 'node', [firstAddress], Date.now())

    // Heartbeats flow on the first address, node to orchestrator. The
    // accept registers before the dial lands: the reverse order can lose
    // the connection event on loopback.
    const dialNode = async (port: number): Promise<PairEnd> =>
      await dialEnd('127.0.0.1', port, { label: 'orchestrator', tracker, onBeat })
    const nodeAccepted = acceptOne(first.server, {
      label: 'node',
      tracker: new LivenessTracker(),
    })
    const orchEnd = await dialNode(first.port)
    const nodeEnd = await nodeAccepted
    const beating = setInterval(() => {
      nodeEnd.send(nextBeat())
    }, BEAT_MS)
    await sleep(BEAT_MS * 10)
    checkFact(seenSeqs.length > 0, 'heartbeats flow before the renumber')
    checkFact(
      tracker.view(performance.now(), Date.now()).state === 'online',
      'orchestrator sees the node online before the renumber',
    )

    // The renumber: the node's address moves; the old socket dies. The
    // orchestrator misses beats and goes unreachable, retrying.
    const moved = await listenOn('127.0.0.1')
    const newAddress = `127.0.0.1:${String(moved.port)}`
    const renumberedAt = performance.now()
    nodeEnd.close()
    orchEnd.close()
    await closeServer(first.server)
    await sleep(TRACKER_BEAT_MS * TRACKER_MISS + BEAT_MS * 5)
    tracker.onAttemptScheduled(1, TRACKER_BEAT_MS, Date.now(), [
      { path: 'address', lastSeenWall: Date.now() },
    ])
    checkFact(
      tracker.view(performance.now(), Date.now()).state === 'unreachable',
      'missed beats read unreachable, never silently stuck',
    )

    // The node dials home with its new addresses inside the channel.
    const announced: string[][] = []
    const homeEnd = (async () => {
      const dialed = dialEnd('127.0.0.1', home.port, {
        label: 'node-dial-home',
        tracker: new LivenessTracker(),
      })
      const accepted = acceptOne(home.server, {
        label: 'home',
        tracker,
        onBeat: (beat) => {
          if (beat.addresses !== undefined) announced.push([...beat.addresses])
          onBeat(beat)
        },
      })
      const [dialedEnd, acceptedEnd] = await Promise.all([dialed, accepted])
      dialedEnd.send(nextBeat([newAddress]))
      return { dialedEnd, acceptedEnd }
    })()
    const { dialedEnd, acceptedEnd } = await homeEnd
    await sleep(BEAT_MS * 5)
    checkFact(announced.length === 1, 'the new address arrives inside the channel')
    book.remember(NODE_ID, 'node', [...(announced[0] ?? []), firstAddress], Date.now())

    // Re-resolution: the stale address fails, the new one wins, and the
    // duplicate dial-home connection is closed.
    let attempts = 0
    let servingEnd: PairEnd | undefined
    const rejoined = await firstHandshakeWins([
      async (signal) => {
        attempts += 1
        if (signal.aborted) throw new Error('aborted')
        return await dialNode(first.port)
      },
      async (signal): Promise<PairEnd> => {
        attempts += 1
        if (signal.aborted) throw new Error('aborted')
        const servingAccepted = acceptOne(moved.server, {
          label: 'node-new',
          tracker: new LivenessTracker(),
        })
        const dialed = await dialNode(moved.port)
        const serving = await servingAccepted
        servingEnd = serving
        serving.send(nextBeat())
        dialedEnd.close()
        acceptedEnd.close()
        return dialed
      },
    ])
    const rejoinedAt = performance.now()
    book.recordSuccess(NODE_ID, newAddress, Date.now())
    checkFact(
      book.addressesFor(NODE_ID)[0] === newAddress,
      'the proven address moves to the front of the book',
    )
    checkFact(
      rejoinedAt - renumberedAt < NODE_REDISCOVER_TARGET_MS,
      `rejoin lands within the rediscovery target (${String(Math.round(rejoinedAt - renumberedAt))} ms)`,
    )
    checkFact(attempts >= 1, 're-resolution attempted its legs')

    // Beats resume on the rejoined connection.
    checkFact(servingEnd !== undefined, 'the rejoined connection serves')
    for (let beat = 0; beat < 3; beat += 1) {
      servingEnd.send(nextBeat())
      await sleep(BEAT_MS)
    }
    const view = tracker.view(performance.now(), Date.now())
    checkFact(view.state === 'online', 'orchestrator sees the node online after the rejoin')
    const distinct = new Set(seenSeqs)
    checkFact(distinct.size === seenSeqs.length, 'no heartbeat delivered twice')
    const ordered = [...seenSeqs].toSorted((a, b) => a - b)
    checkFact(
      JSON.stringify(ordered) === JSON.stringify(seenSeqs),
      'heartbeats arrive in sequence order',
    )
    clearInterval(beating)
    rejoined.close()
    await closeServer(moved.server)
    await closeServer(home.server)
  },
}
