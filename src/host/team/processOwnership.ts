import * as z from 'zod/mini'
import { runProgram } from '../processTree'

export interface ProcessIdentity {
  readonly pid: number
  readonly group: string
  readonly startTime: string
  readonly launchId: string | undefined
}

export interface OwnershipDriver {
  readonly observe: (pid: number) => Promise<ProcessIdentity | undefined>
  scan(launchIds: readonly string[]): Promise<readonly ProcessIdentity[]>
  /** Native adapter rechecks identity at the syscall, using pidfds on Linux. */
  signal(
    identity: ProcessIdentity,
    signal: 'SIGTERM' | 'SIGKILL',
    isGroup: boolean,
  ): Promise<boolean>
}

export interface OwnershipResult {
  readonly signalled: readonly number[]
  readonly notOwned: readonly number[]
}

function isSameProcess(current: ProcessIdentity | undefined, expected: ProcessIdentity): boolean {
  return (
    current?.pid === expected.pid &&
    current.group === expected.group &&
    current.startTime === expected.startTime &&
    (expected.launchId === undefined || current.launchId === expected.launchId)
  )
}

export async function isProcessOwned(
  observe: OwnershipDriver['observe'],
  expected: ProcessIdentity,
): Promise<boolean> {
  return isSameProcess(await observe(expected.pid), expected)
}

/** The sole authority for K's PID/group/container signal decisions. */
export function createProcessOwnership(driver: OwnershipDriver) {
  const isOwned = async (expected: ProcessIdentity) =>
    await isProcessOwned(driver.observe, expected)
  const signal = async (
    expected: ProcessIdentity,
    signal: 'SIGTERM' | 'SIGKILL',
    shouldFindSurvivors: boolean,
  ): Promise<OwnershipResult> => {
    const isExpectedOwned = await isOwned(expected)
    if (!isExpectedOwned && !shouldFindSurvivors) return { signalled: [], notOwned: [expected.pid] }
    const leaderPid = Number(expected.group)
    const leader = await driver.observe(leaderPid)
    const isLeaderOwned =
      leader?.pid === leaderPid &&
      leader.group === expected.group &&
      (leaderPid === expected.pid
        ? isSameProcess(leader, expected)
        : expected.launchId !== undefined && leader.launchId === expected.launchId)
    if (isLeaderOwned && process.platform === 'darwin') {
      return (await isOwned(leader)) && (await driver.signal(leader, signal, true))
        ? { signalled: [expected.pid], notOwned: [] }
        : { signalled: [], notOwned: [expected.pid] }
    }
    // Linux never sends a reusable negative PID. Each member gets a pidfd and
    // its own final identity proof, even when the leader has already exited.
    const members = await driver.scan(expected.launchId === undefined ? [] : [expected.launchId])
    const candidates = new Map<number, ProcessIdentity>()
    if (isExpectedOwned) candidates.set(expected.pid, expected)
    const notOwned = new Set<number>(isLeaderOwned ? [] : [leaderPid])
    if (!isExpectedOwned) notOwned.add(expected.pid)
    for (const member of members) {
      if (member.group !== expected.group || member.pid === expected.pid) continue
      if (expected.launchId !== undefined && member.launchId === expected.launchId)
        candidates.set(member.pid, member)
      else notOwned.add(member.pid)
    }
    const signalled: number[] = []
    for (const member of candidates.values()) {
      if ((await isOwned(member)) && (await driver.signal(member, signal, false)))
        signalled.push(member.pid)
      else notOwned.add(member.pid)
    }
    return { signalled, notOwned: [...notOwned] }
  }
  return {
    isOwned,
    signal: async (expected: ProcessIdentity, name: 'SIGTERM' | 'SIGKILL') =>
      await signal(expected, name, false),
    /** Automatic retirement can still retire proved members after the primary exits. */
    signalLaunch: async (expected: ProcessIdentity, name: 'SIGTERM' | 'SIGKILL') =>
      await signal(expected, name, true),
  }
}

// Node's supported host versions expose no pidfd API. This isolated stdlib
// helper opens a stable handle BEFORE sampling /proc, then signals that handle.
// No environment, command line or account text is returned to the host.
const PIDFD_SIGNAL = String.raw`
import errno,json,os,re,signal,sys
expected=json.loads(sys.argv[1])
fd=None
result={'kind':'notOwned'}
try:
    pid=expected['pid']
    if pid > 1 and hasattr(os,'pidfd_open') and hasattr(signal,'pidfd_send_signal'):
        fd=os.pidfd_open(pid)
        base='/proc/'+str(pid)
        def sample():
            with open(base+'/stat') as file: raw=file.read()
            fields=raw[raw.rfind(')')+2:].split()
            return fields[0],fields[2],fields[19]
        before=sample()
        with open(base+'/status') as file: status=file.read()
        uid=re.search(r'^Uid:\s+(\d+)',status,re.M)
        with open(base+'/environ','rb') as file: environment=file.read().split(b'\0')
        with open('/proc/sys/kernel/random/boot_id') as file: boot=file.read().strip()
        marker=expected.get('launchId')
        owned=(uid is not None and int(uid[1])==os.getuid() and before[0]!='Z'
               and before[1]==expected['group']
               and boot+':'+before[2]==expected['startTime']
               and (marker is None or ('MUSE_SPARK_LAUNCH_ID='+marker).encode() in environment)
               and sample()==before)
        if owned:
            signal.pidfd_send_signal(fd,getattr(signal,sys.argv[2]))
            result={'kind':'signalled'}
except OSError as error:
    if error.errno not in (errno.ESRCH,errno.ENOENT):
        result={'kind':'failed','code':errno.errorcode.get(error.errno,'UNKNOWN')}
finally:
    if fd is not None: os.close(fd)
print(json.dumps(result))
`
const signalResultSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('signalled') }),
  z.strictObject({ kind: z.literal('notOwned') }),
  z.strictObject({ kind: z.literal('failed'), code: z.string() }),
])

export async function didSignalLinuxProcess(
  identity: ProcessIdentity,
  signal: 'SIGTERM' | 'SIGKILL',
): Promise<boolean> {
  const text = await runProgram(
    '/usr/bin/python3',
    ['-I', '-c', PIDFD_SIGNAL, JSON.stringify(identity), signal],
    {},
  )
  const result = signalResultSchema.parse(JSON.parse(text))
  if (result.kind === 'failed') throw new Error(`TEAM_SIGNAL_FAILED:${result.code}`)
  return result.kind === 'signalled'
}
