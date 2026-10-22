// Explicit Windows native lifecycle certification; synthetic loopback peers only.
// Nearby PID allocation is a rig precondition, not a portable product gate.
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { once } from 'node:events'
import { writeFile } from 'node:fs/promises'
import { createConnection } from 'node:net'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { windowsPeer } from '../../src/core/judge/local/windowsPeer'
import { compilePeer, endListener, nodeListener } from '../unit/helpers/localJudgeWindows'

describe.skipIf(process.platform !== 'win32' || process.env['MUSE_LOCAL_JUDGE_PID_CERT'] !== '1')(
  'FIXM98J2 real Windows lifetime and nearby PID certification',
  () => {
    it('refuses an exited native process lease while a new OS PID is forced near it', async () => {
      const helper = await compilePeer()
      const pausedHelper = await compilePeer(true)
      const old = await nodeListener('127.0.0.1')
      const socket = createConnection({ host: '127.0.0.1', port: old.port })
      socket.on('error', () => {
        /* The old process exits while the native helper retains its handle. */
      })
      let hasOldExited = false
      let probe: ChildProcessWithoutNullStreams | undefined
      try {
        await once(socket, 'connect')
        const original = await windowsPeer(helper, socket)
        probe = spawn(
          pausedHelper,
          [
            socket.remoteAddress!,
            String(socket.remotePort),
            socket.localAddress!,
            String(socket.localPort),
          ],
          { windowsHide: true, env: { SystemRoot: process.env['SystemRoot'] }, stdio: 'pipe' },
        )
        const ready = await once(probe.stderr, 'data')
        expect(String(ready[0])).toContain('lease-held')
        await endListener(old.child)
        hasOldExited = true
        let nearestPid: number | undefined
        let attempts = 0
        // Holding the old native handle prevents reuse of its process object.
        // Force allocations around it instead; every replacement really executes.
        while (attempts < 1024) {
          attempts++
          const replacement = spawn(
            path.join(process.env['SystemRoot'] ?? '', 'System32/cmd.exe'),
            ['/d', '/c', 'exit', '0'],
            {
              windowsHide: true,
              env: { SystemRoot: process.env['SystemRoot'] },
              stdio: 'ignore',
            },
          )
          const pid = replacement.pid
          const [code] = await once(replacement, 'close')
          expect(code).toBe(0)
          expect(pid).not.toBe(original.pid)
          if (
            pid !== undefined &&
            (nearestPid === undefined ||
              Math.abs(pid - original.pid) < Math.abs(nearestPid - original.pid))
          )
            nearestPid = pid
          if (nearestPid !== undefined && Math.abs(nearestPid - original.pid) <= 16) break
        }
        expect(nearestPid).toBeDefined()
        expect(Math.abs(nearestPid! - original.pid)).toBeLessThanOrEqual(16)
        const closed = once(probe, 'close')
        probe.stdin.end('\n')
        const [code] = await closed
        expect(code).toBe(1)
        // Receipt is synthetic process evidence only, with no accounts or content.
        await writeFile(
          path.resolve('temp/fixm98j2-pid.json'),
          JSON.stringify(
            {
              originalPid: original.pid,
              originalCreationTime: original.creationTime,
              nearestPid,
              distance: Math.abs(nearestPid! - original.pid),
              attempts,
              refusedExit: code,
              originalExited: hasOldExited,
            },
            null,
            2,
          ),
        )
        expect(socket.bytesWritten).toBe(0)
      } finally {
        socket.destroy()
        if (probe?.exitCode === null) {
          const closed = once(probe, 'close')
          probe.kill()
          await closed
        }
        if (!hasOldExited) await endListener(old.child)
      }
    })
  },
)
