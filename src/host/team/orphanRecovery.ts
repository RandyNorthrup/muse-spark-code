import type { LaunchConfirmation, TeamLaunchRecord } from './processLifetime'
import { readFile, readdir, readlink } from 'node:fs/promises'
import process from 'node:process'
import * as z from 'zod/mini'
import { runProgram } from '../processTree'
import {
  createProcessOwnership,
  isProcessOwned,
  didSignalLinuxProcess,
  type OwnershipDriver,
} from './processOwnership'

const LAUNCH_MARKER = /(?:^|[\s\0])MUSE_SPARK_LAUNCH_ID=([a-f0-9-]{36})(?=$|[\s\0])/
const PROC_START_FIELD = 19
// M98 J's libproc sampling pattern, through the existing isolated stdlib
// helper lane. ABI fields/constants follow the macOS SDK's proc_info.h.
// argv is skipped by argc; only exact environment entries are projected.
const DARWIN_OBSERVE = String.raw`
import ctypes,json,os,re,select,sys
lib=ctypes.CDLL('/usr/lib/libproc.dylib',use_errno=True)
libc=ctypes.CDLL(None,use_errno=True)
class BSD(ctypes.Structure):
    _fields_=[(name,ctypes.c_uint32) for name in
        ('flags','status','xstatus','pid','ppid','uid','gid','ruid','rgid','svuid','svgid','reserved')]+[
        ('comm',ctypes.c_char*16),('name',ctypes.c_char*32)]+[
        (name,ctypes.c_uint32) for name in ('nfiles','pgid','pjobc','tdev','tpgid')]+[
        ('nice',ctypes.c_int32),('seconds',ctypes.c_uint64),('microseconds',ctypes.c_uint64)]
lib.proc_pidinfo.argtypes=[ctypes.c_int,ctypes.c_int,ctypes.c_uint64,ctypes.c_void_p,ctypes.c_int]
lib.proc_pidpath.argtypes=[ctypes.c_int,ctypes.c_void_p,ctypes.c_uint32]
lib.proc_listpids.argtypes=[ctypes.c_uint32,ctypes.c_uint32,ctypes.c_void_p,ctypes.c_int]
libc.sysctl.argtypes=[ctypes.POINTER(ctypes.c_int),ctypes.c_uint,ctypes.c_void_p,
                     ctypes.POINTER(ctypes.c_size_t),ctypes.c_void_p,ctypes.c_size_t]
def sample(pid):
    info=BSD()
    path=ctypes.create_string_buffer(4096)
    if (lib.proc_pidinfo(pid,3,0,ctypes.byref(info),ctypes.sizeof(info))!=ctypes.sizeof(info)
        or lib.proc_pidpath(pid,path,len(path))<=0 or info.pid!=pid or info.status==5
        or info.uid!=os.getuid() or info.ruid!=os.getuid()
        or info.seconds==0 or info.microseconds>=1000000): return None
    return {'pid':pid,'uid':info.uid,'group':str(info.pgid),
            'startTime':str(info.seconds)+':'+str(info.microseconds),
            'command':os.fsdecode(path.value),'executable':os.fsdecode(path.value)}
def marker(pid):
    maximum=ctypes.c_int()
    size=ctypes.c_size_t(ctypes.sizeof(maximum))
    mib=(ctypes.c_int*2)(1,8)
    if libc.sysctl(mib,2,ctypes.byref(maximum),ctypes.byref(size),None,0)!=0: return None
    data=ctypes.create_string_buffer(maximum.value)
    size=ctypes.c_size_t(len(data))
    mib=(ctypes.c_int*3)(1,49,pid)
    if libc.sysctl(mib,3,data,ctypes.byref(size),None,0)!=0: return None
    raw=data.raw[:size.value]
    argc=ctypes.c_int.from_buffer_copy(raw[:ctypes.sizeof(ctypes.c_int)]).value
    offset=raw.index(b'\0',ctypes.sizeof(ctypes.c_int))+1
    while offset<len(raw) and raw[offset]==0: offset+=1
    for _ in range(argc): offset=raw.index(b'\0',offset)+1
    for entry in raw[offset:].split(b'\0'):
        if re.fullmatch(rb'MUSE_SPARK_LAUNCH_ID=[a-f0-9-]{36}',entry):
            return entry.split(b'=',1)[1].decode('ascii')
    return None
def observe(pid):
    if pid<=1: return None
    queue=None
    try:
        queue=select.kqueue()
        if queue is not None:
            event=select.kevent(pid,filter=select.KQ_FILTER_PROC,
                flags=select.KQ_EV_ADD|select.KQ_EV_CLEAR,
                fflags=select.KQ_NOTE_EXIT|select.KQ_NOTE_EXEC)
            if queue.control([event],1,0): return None
            before=sample(pid)
            if before is None or queue.control(None,1,0): return None
            launch=marker(pid)
            after=sample(pid)
            if after!=before or queue.control(None,1,0): return None
            return dict(before,launchId=launch)
    except (OSError,ValueError): return None
    finally:
        if queue is not None: queue.close()
if sys.argv[1]=='observe':
    result=observe(int(sys.argv[2]))
else:
    size=lib.proc_listpids(1,0,None,0)
    pids=(ctypes.c_int*(size//ctypes.sizeof(ctypes.c_int)))()
    count=lib.proc_listpids(1,0,pids,ctypes.sizeof(pids))//ctypes.sizeof(ctypes.c_int)
    result=[entry for pid in pids[:count] if (entry:=observe(pid)) is not None]
print(json.dumps(result))
`
const darwinObservationSchema = z.strictObject({
  pid: z.number().check(z.int(), z.positive()),
  uid: z.number().check(z.int(), z.nonnegative()),
  group: z.string().check(z.minLength(1)),
  startTime: z.string().check(z.minLength(1)),
  command: z.string().check(z.minLength(1)),
  executable: z.string().check(z.minLength(1)),
  launchId: z.nullable(z.uuid()),
})
const projectDarwin = (value: z.infer<typeof darwinObservationSchema>): OrphanObservation => ({
  ...value,
  launchId: value.launchId ?? undefined,
})

/** Real user-owned process scan. Only the marker is projected from environment data. */
export function createNativeOrphanDriver(): OrphanRecoveryDriver {
  const uid = process.getuid?.()
  const observe = async (pid: number): Promise<OrphanObservation | undefined> => {
    if (!Number.isSafeInteger(pid) || pid <= 1) return undefined
    try {
      if (process.platform === 'linux') {
        const directory = `/proc/${String(pid)}`
        const status = await readFile(`${directory}/status`, 'utf8')
        if (Number(/^Uid:\s+(\d+)/m.exec(status)?.[1]) !== uid) return undefined
        const before = await readFile(`${directory}/stat`, 'utf8')
        const fields = before
          .slice(before.lastIndexOf(')') + 2)
          .trim()
          .split(/\s+/)
        if (fields[0] === 'Z') return undefined
        const environment = await readFile(`${directory}/environ`, 'utf8')
        const executable = await readlink(`${directory}/exe`)
        const command = executable
        const bootId = await readFile('/proc/sys/kernel/random/boot_id', 'utf8')
        const boot = bootId.trim()
        // Reject exit/reuse during sampling. This grants no journal ownership.
        const after = await readFile(`${directory}/stat`, 'utf8')
        const later = after
          .slice(after.lastIndexOf(')') + 2)
          .trim()
          .split(/\s+/)
        if (fields[PROC_START_FIELD] !== later[PROC_START_FIELD] || fields[2] !== later[2])
          return undefined
        const group = fields[2]
        if (group === undefined || fields[PROC_START_FIELD] === undefined || !/^\d+$/.test(group))
          return undefined
        return {
          pid,
          group,
          startTime: `${boot}:${fields[PROC_START_FIELD]}`,
          command,
          executable,
          uid,
          launchId: LAUNCH_MARKER.exec(environment)?.[1],
        }
      }
      if (process.platform === 'darwin') {
        const text = await runProgram(
          '/usr/bin/python3',
          ['-I', '-c', DARWIN_OBSERVE, 'observe', String(pid)],
          {},
        )
        const value = z.nullable(darwinObservationSchema).parse(JSON.parse(text))
        return value === null ? undefined : projectDarwin(value)
      }
    } catch {
      /* Exit, restricted environment or an unavailable /proc entry is not a match. */
    }
    return undefined
  }
  return {
    observe,
    async scan(_launchIds) {
      let pids: number[] = []
      if (process.platform === 'linux') {
        const entries = await readdir('/proc')
        pids = entries.filter((name) => /^\d+$/.test(name)).map(Number)
      } else if (process.platform === 'darwin') {
        const text = await runProgram('/usr/bin/python3', ['-I', '-c', DARWIN_OBSERVE, 'scan'], {})
        const entries = z.array(z.unknown()).parse(JSON.parse(text))
        const found: OrphanObservation[] = []
        for (const entry of entries) {
          const parsed = darwinObservationSchema.safeParse(entry)
          if (parsed.success) found.push(projectDarwin(parsed.data))
        }
        return found
      }
      const found: OrphanObservation[] = []
      // Serial and bounded by the current process table; environment values never reach a log.
      for (const pid of pids) {
        const observation = await observe(pid)
        if (observation !== undefined) found.push(observation)
      }
      return found
    },
    async signal(identity, signal, isGroup) {
      if (process.platform === 'linux') {
        if (isGroup) throw new Error('TEAM_PIDFD_GROUP_INVALID')
        return await didSignalLinuxProcess(identity, signal)
      }
      const mine = await observe(process.pid)
      if (
        !Number.isSafeInteger(identity.pid) ||
        identity.pid <= 1 ||
        (isGroup && identity.group === mine?.group)
      )
        throw new Error('TEAM_ORPHAN_GROUP_INVALID')
      // Ownership is re-read after the self-group check, immediately before kill.
      if (!(await isProcessOwned(observe, identity))) return false
      process.kill(isGroup ? -identity.pid : identity.pid, signal)
      return true
    },
  }
}

/** OS adapters return only this projection; environment values never escape their scan. */
export interface OrphanObservation {
  readonly pid: number
  readonly group: string
  readonly startTime: string
  readonly command: string
  readonly launchId: string | undefined
  readonly executable?: string | undefined
  readonly uid?: number | string | undefined
}

export interface OrphanProcess extends OrphanObservation {
  readonly launchId: string
  readonly match: 'matched' | 'uncertain'
  readonly recorded?: LaunchConfirmation
}

export interface OrphanRecoveryDriver extends OwnershipDriver {
  /** Only processes owned by the current OS user may be returned. */
  scan(launchIds: readonly string[]): Promise<readonly OrphanObservation[]>
  /** Exact current sample immediately before the signal, or undefined if gone. */
  observe(pid: number): Promise<OrphanObservation | undefined>
}

function isSameConfirmation(observation: OrphanObservation, confirmation: LaunchConfirmation) {
  return (
    observation.pid === confirmation.pid &&
    observation.startTime === confirmation.startTime &&
    observation.group ===
      (confirmation.container === 'linuxScope' ? String(confirmation.pid) : confirmation.group) &&
    confirmation.executable !== undefined &&
    observation.executable === confirmation.executable &&
    confirmation.uid !== undefined &&
    observation.uid === confirmation.uid
  )
}

/** Recovery reads foreign records, never mutates their journal, copy, branch or refs. */
export function createOrphanRecovery(driver: OrphanRecoveryDriver) {
  const ownership = createProcessOwnership(driver)
  return {
    async find(records: readonly TeamLaunchRecord[]): Promise<readonly OrphanProcess[]> {
      const open = records.filter((record) => record.end?.descendants !== 'proved')
      if (open.length === 0) return []
      const observations = await driver.scan(open.map((record) => record.id))
      const found: OrphanProcess[] = []
      for (const observation of observations) {
        const matched = open.find((record) => record.id === observation.launchId)
        const uncertain = open.find(
          (record) =>
            record.confirmation !== undefined &&
            isSameConfirmation(observation, record.confirmation),
        )
        const record = matched ?? uncertain
        if (record !== undefined) {
          found.push({
            ...observation,
            launchId: record.id,
            match: uncertain === undefined || matched === undefined ? 'uncertain' : 'matched',
            ...(uncertain?.confirmation !== undefined && { recorded: uncertain.confirmation }),
          })
        }
      }
      return found
    },
    async stop(
      orphan: OrphanProcess,
      isUserConfirmed: boolean,
    ): Promise<
      | 'stopped'
      | 'changed'
      | 'kept'
      | { readonly kind: 'partiallyStopped'; readonly notOwned: readonly number[] }
    > {
      if (!isUserConfirmed) return 'kept'
      if (orphan.recorded === undefined || !isSameConfirmation(orphan, orphan.recorded))
        return 'changed'
      const result = await ownership.signal(
        {
          ...orphan.recorded,
          group: orphan.group,
          launchId: orphan.match === 'matched' ? orphan.launchId : undefined,
        },
        'SIGTERM',
      )
      if (!result.signalled.includes(orphan.pid)) return 'changed'
      return result.notOwned.length === 0
        ? 'stopped'
        : { kind: 'partiallyStopped', notOwned: result.notOwned }
    },
  }
}
