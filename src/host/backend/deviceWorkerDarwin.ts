// M100/H: a GUI launchd job with supervised caps and kernel coalition retirement.
import { spawn, type ChildProcess, type SpawnOptions } from 'node:child_process'
import { createHash, randomUUID } from 'node:crypto'
import { lstat, mkdir, open, readdir, rename, rm, stat, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import * as z from 'zod/mini'
import { UI_TEXT } from '../../shared/l10n/text'
import { workerEnvironment } from '../../core/team/refFence'
import {
  handleIdentity,
  identityOf,
  lstatIdentity,
  sameFile,
  type FileIdentity,
} from '../../core/fs/fileIdentity'
import {
  DEVICE_LIMITS,
  MILLISECONDS_PER_SECOND,
  POSIX_TREE_EXIT_POLL_MS,
} from '../../shared/constants'
import {
  DeviceWorkerHostError,
  admittedProcessLimit,
  deviceWorkerRefused,
  parseDeviceWorkerQuery,
  type DeviceWorkerCommand,
  type DeviceWorkerDriver,
  type DeviceWorkerJob,
  type DeviceWorkerLaunch,
} from '../devices/deviceWorkerHost'

// Darwin posix_spawn(2): path/format/permission failures are definitive; memory
// and process limits are capacity. pipe(2): EMFILE/ENFILE exhaust the descriptors
// needed to spawn with pipes. Sources and Node's throw/event split: HM6 record.
const spawnErrnos: Readonly<Record<string, 'capacity' | 'helper' | undefined>> = {
  EAGAIN: 'capacity',
  ENOMEM: 'capacity',
  EMFILE: 'capacity',
  ENFILE: 'capacity',
  ENOENT: 'helper',
  EACCES: 'helper',
  ENOEXEC: 'helper',
  ENOTDIR: 'helper',
  ELOOP: 'helper',
  ENAMETOOLONG: 'helper',
  E2BIG: 'helper',
  EINVAL: 'helper',
}

// Compile beside the private attempt store. No SDK, shell, inherited credential,
// system service, login trigger, or plain-spawn fallback is used for the worker.
// The private coalition ABI is checked on every factory's real launch self-test.
// Apple sources: xnu/bsd/sys/proc_info_private.h and wrappers/coalition.c.
const helperSource = String.raw`
#import <Foundation/Foundation.h>
#import <IOKit/pwr_mgt/IOPMLib.h>
#import <IOKit/ps/IOPowerSources.h>
#import <IOKit/ps/IOPSKeys.h>
#include <libproc.h>
#include <sys/wait.h>
#include <sys/stat.h>
#include <fcntl.h>
#include <unistd.h>
#include <signal.h>
#include <spawn.h>
#include <errno.h>
#include <mach/mach_time.h>

// These are Darwin ABI values, not tunables. Fail closed on ABI or read failure.
struct CoalitionIDs { uint64_t ids[2], reserved[3]; };
extern int coalition_info_resource_usage(uint64_t, void *, size_t);
static uint64_t coalition(pid_t pid) {
  struct CoalitionIDs ids = {0};
  return proc_pidinfo(pid, 20, 0, &ids, sizeof(ids)) == sizeof(ids) ? ids.ids[0] : 0;
}
static BOOL counts(uint64_t id, uint64_t *active, uint64_t *cpu) {
  uint64_t usage[4] = {0};
  if (!id || coalition_info_resource_usage(id, usage, sizeof(usage)) || usage[0] < usage[1]) return NO;
  *active = usage[0] - usage[1];
  mach_timebase_info_data_t scale; if (mach_timebase_info(&scale) != KERN_SUCCESS) return NO;
  *cpu = usage[3] / 100 * scale.numer / scale.denom;
  return YES;
}
static NSString *power(void) {
  CFTypeRef info = IOPSCopyPowerSourcesInfo(); if (!info) return @"unknown";
  CFStringRef type = IOPSGetProvidingPowerSourceType(info);
  NSString *value = @"unknown";
  if (type && CFEqual(type, CFSTR(kIOPSACPowerValue))) value = @"ac";
  else if (type && CFEqual(type, CFSTR(kIOPSBatteryPowerValue))) value = @"battery";
  CFRelease(info); return value;
}
static NSDictionary *query(NSString *label, uint64_t active, uint64_t cpu, uint64_t memory, BOOL awake) {
  return @{@"context": @{@"session": @(getuid()), @"station": @"gui", @"desktop": label},
    @"power": power(), @"sleepInhibited": @(awake), @"activeProcesses": @(active),
    @"cpu100ns": @(cpu), @"peakMemoryBytes": @(memory)};
}
static BOOL save(NSString *file, id value) {
  NSData *data = [NSJSONSerialization dataWithJSONObject:value options:0 error:nil];
  return data && [data writeToFile:file options:NSDataWritingAtomic error:nil];
}
static BOOL present(NSString *file) { return access(file.fileSystemRepresentation, F_OK) == 0; }
static BOOL capacity(int error) { return ${Object.entries(spawnErrnos)
  .filter(([, detail]) => detail === 'capacity')
  .map(([code]) => `error == ${code}`)
  .join(' || ')}; }
static BOOL members(uint64_t id, BOOL stop, uint64_t *memory, uint64_t *active) {
  int bytes = proc_listpids(PROC_UID_ONLY, getuid(), NULL, 0);
  if (bytes <= 0) return NO;
  // proc_listpids returns bytes. A full/truncated snapshot cannot prove membership.
  int capacity = bytes + sizeof(pid_t);
  pid_t *pids = calloc(1, capacity); if (!pids) return NO;
  int size = proc_listpids(PROC_UID_ONLY, getuid(), pids, capacity);
  if (size <= 0 || size >= capacity || size % sizeof(pid_t)) { free(pids); return NO; }
  *memory = 0;
  *active = 0;
  for (int i = 0; i < size / sizeof(pid_t); i++) {
    if (pids[i] <= 0 || pids[i] == getpid()) continue;
    errno = 0;
    uint64_t member = coalition(pids[i]);
    if (!member && errno != ESRCH) { free(pids); return NO; }
    if (member != id) continue;
    (*active)++;
    struct rusage_info_v2 usage = {0};
    if (proc_pid_rusage(pids[i], RUSAGE_INFO_V2, (rusage_info_t *)&usage) == 0) *memory += usage.ri_resident_size;
    // Recheck coalition membership immediately before signalling a member.
    if (stop && coalition(pids[i]) == id && kill(pids[i], SIGKILL) && errno != ESRCH) {
      free(pids); return NO;
    }
  }
  free(pids); return YES;
}
static void drain(int *fd, NSMutableData *out, NSUInteger limit, BOOL *overflow) {
  if (*fd < 0) return;
  uint8_t buffer[${DEVICE_LIMITS.channelFrameBytes}]; ssize_t size;
  while ((size = read(*fd, buffer, sizeof(buffer))) > 0) {
    if ((NSUInteger)size > limit - out.length) *overflow = YES;
    else [out appendBytes:buffer length:size];
    if (*overflow) return; // A writer cannot monopolize the retirement/control loop.
  }
  if (size == 0) { close(*fd); *fd = -1; }
  else if (errno != EAGAIN && errno != EINTR) *overflow = YES;
}
int main(int argc, const char **argv) { @autoreleasepool {
  umask(0077);
  if (argc == 2 && !strcmp(argv[1], "--self-test")) {
    uint64_t active, cpu;
    if (!counts(coalition(getpid()), &active, &cpu)) return 1;
    char *args[] = {"/usr/bin/true", NULL}; char *env[] = {NULL};
    pid_t child; int status;
    int launchError = posix_spawn(&child, args[0], NULL, NULL, args, env);
    if (capacity(launchError)) {
      NSData *data = [NSJSONSerialization dataWithJSONObject:
        @{@"jobProbe":@NO,@"query":@YES,@"power":power(),@"scheduler":@"untested",@"failure":@"capacity"} options:0 error:nil];
      return write(STDOUT_FILENO, data.bytes, data.length) == data.length ? 0 : 1;
    }
    if (launchError || waitpid(child, &status, 0) != child ||
        !WIFEXITED(status) || WEXITSTATUS(status) != 0) return 1;
    NSData *data = [NSJSONSerialization dataWithJSONObject:
      @{@"jobProbe":@YES,@"query":@YES,@"power":power(),@"scheduler":@"untested"} options:0 error:nil];
    return write(STDOUT_FILENO, data.bytes, data.length) == data.length ? 0 : 1;
  }
  if (argc == 2 && !strcmp(argv[1], "--query")) {
    NSData *data = [NSJSONSerialization dataWithJSONObject:query(@"transport",0,0,0,NO) options:0 error:nil];
    return write(STDOUT_FILENO, data.bytes, data.length) == data.length ? 0 : 1;
  }
  if (argc == 3 && !strcmp(argv[1], "--count")) {
    uint64_t active, cpu, memory, id = strtoull(argv[2], NULL, 10);
    // bootout may reap the resource-usage record. A complete successful UID
    // membership scan still proves whether any task belongs to that coalition.
    if (!counts(id, &active, &cpu) && !members(id, NO, &memory, &active)) return 1;
    printf("{\"active\":%llu}", active); return 0;
  }
  if (argc != 3 || strcmp(argv[1], "--run")) return 1;
  NSDictionary *config = [NSJSONSerialization JSONObjectWithData:[NSData dataWithContentsOfFile:@(argv[2])] options:0 error:nil];
  if (![config isKindOfClass:NSDictionary.class]) return 1;
  NSString *directory = config[@"directory"], *label = config[@"label"];
  NSString *(^file)(NSString *) = ^(NSString *name) { return [directory stringByAppendingPathComponent:name]; };
  uint64_t id = coalition(getpid()), active, cpu;
  // A dedicated resource coalition must contain exactly this launchd helper.
  if (!counts(id, &active, &cpu) || active != 1 || getppid() != 1 || getpgrp() != getpid()) return 1;
  IOPMAssertionID assertion;
  if (IOPMAssertionCreateWithName(kIOPMAssertionTypePreventUserIdleSystemSleep, kIOPMAssertionLevelOn,
      CFSTR("Muse Spark device worker"), &assertion) != kIOReturnSuccess) return 1;
  BOOL awake = YES;
  if (!save(file(@"ready.json"), @{@"pid": @(getpid()), @"coalition": @(id), @"query": query(label,0,cpu,0,awake)})) return 1;
  while (!present(file(@"go"))) {
    if (present(file(@"stop"))) {
      IOPMAssertionRelease(assertion);
      save(file(@"query.json"),query(label,0,cpu,0,NO));
      return save(file(@"result.json"),@{@"exitCode":@1,@"stdout":@"",@"failure":@"none"}) ? 0 : 1;
    }
    usleep([config[@"pollUs"] unsignedIntValue]);
  }
  NSArray *arguments = [@[config[@"executable"]] arrayByAddingObjectsFromArray:config[@"args"]];
  char **args = calloc(arguments.count + 1, sizeof(char *));
  NSDictionary *environment = config[@"environment"];
  char **env = calloc(environment.count + 1, sizeof(char *));
  if (!args || !env) return 1;
  for (NSUInteger i = 0; i < arguments.count; i++) args[i] = strdup([arguments[i] UTF8String]);
  NSUInteger index = 0;
  for (NSString *key in environment) env[index++] = strdup([[NSString stringWithFormat:@"%@=%@",key,environment[key]] UTF8String]);
  int output[2], errors[2];
  if (pipe(output) || pipe(errors)) return 1;
  posix_spawn_file_actions_t actions;
  if (posix_spawn_file_actions_init(&actions) ||
      posix_spawn_file_actions_addopen(&actions,0,"/dev/null",O_RDONLY,0) ||
      posix_spawn_file_actions_adddup2(&actions,output[1],1) ||
      posix_spawn_file_actions_adddup2(&actions,errors[1],2) ||
      posix_spawn_file_actions_addclose(&actions,output[0]) ||
      posix_spawn_file_actions_addclose(&actions,output[1]) ||
      posix_spawn_file_actions_addclose(&actions,errors[0]) ||
      posix_spawn_file_actions_addclose(&actions,errors[1]) ||
      posix_spawn_file_actions_addchdir_np(&actions,[config[@"cwd"] fileSystemRepresentation])) return 1;
  pid_t child = -1;
  int launchError = posix_spawn(&child,args[0],&actions,NULL,args,env);
  posix_spawn_file_actions_destroy(&actions);
  if (launchError) child = -1;
  close(output[1]); close(errors[1]);
  fcntl(output[0],F_SETFL,O_NONBLOCK); fcntl(errors[0],F_SETFL,O_NONBLOCK);
  NSMutableData *stdoutData = NSMutableData.data, *stderrData = NSMutableData.data;
  BOOL overflow = NO, exited = child < 0;
  int status = 0; uint64_t peak = 0;
  NSString *failure = launchError ? (capacity(launchError) ? @"capacity" : @"unsupported-host") : @"none";
  mach_timebase_info_data_t sampleScale;
  if (mach_timebase_info(&sampleScale) != KERN_SUCCESS) return 1;
  for (;;) { @autoreleasepool {
    uint64_t sampleStart = mach_absolute_time();
    drain(&output[0],stdoutData,[config[@"outputBytes"] unsignedIntegerValue],&overflow);
    drain(&errors[0],stderrData,[config[@"outputBytes"] unsignedIntegerValue],&overflow);
    if (!exited && waitpid(child,&status,WNOHANG) == child) exited = YES;
    if (!counts(id,&active,&cpu) || active < 1) return 1; // Unknown is never retirement.
    // Supervised admission: overflow may execute until this 20 ms membership sample.
    // The helper is outside the admitted worker-process count, on every platform.
    if (overflow || active - 1 > [config[@"maxProcesses"] unsignedLongLongValue]) failure = @"capacity";
    BOOL stop = present(file(@"stop")) || ![failure isEqualToString:@"none"];
    uint64_t memory;
    uint64_t observed; if (!members(id,stop,&memory,&observed)) return 1;
    if (memory > peak) peak = memory;
    if (!save(file(@"query.json"), query(label,active-1,cpu,peak,awake))) return 1;
    // Kernel counts include every descendant, even setsid/double-fork escapees.
    if (exited && active == 1 && output[0] < 0 && errors[0] < 0) break;
    // Charge scan/accounting/I/O time to the interval instead of adding it to 20 ms.
    uint64_t elapsedUs = (mach_absolute_time() - sampleStart) * sampleScale.numer / sampleScale.denom / ${MILLISECONDS_PER_SECOND};
    unsigned int intervalUs = [config[@"pollUs"] unsignedIntValue];
    if (elapsedUs < intervalUs) usleep(intervalUs - (unsigned int)elapsedUs);
  } }
  IOPMAssertionRelease(assertion); awake = NO;
  NSString *stdoutText = [[NSString alloc] initWithData:stdoutData encoding:NSUTF8StringEncoding];
  int exitCode = WIFEXITED(status) ? WEXITSTATUS(status) : 1;
  if (!stdoutText) { stdoutText = @""; failure = @"capacity"; }
  NSDictionary *result = @{@"exitCode":@(exitCode),@"stdout":stdoutText,@"failure":failure};
  NSData *encoded = [NSJSONSerialization dataWithJSONObject:result options:0 error:nil];
  if (encoded.length > [config[@"outputBytes"] unsignedIntegerValue])
    result = @{@"exitCode":@(exitCode),@"stdout":@"",@"failure":@"capacity"};
  if (!save(file(@"query.json"),query(label,0,cpu,peak,awake))) return 1;
  return save(file(@"result.json"),result) ? 0 : 1;
} }
`

const selfTestSchema = z.strictObject({
  jobProbe: z.boolean(),
  query: z.boolean(),
  power: z.enum(['ac', 'battery', 'unknown']),
  scheduler: z.literal('untested'),
  failure: z.optional(z.literal('capacity')),
})
const pidSchema = z.int().check(z.gt(1))
const readySchema = z.strictObject({
  pid: pidSchema,
  coalition: z.int().check(z.gt(0)),
  query: z.unknown(),
})
const countSchema = z.strictObject({ active: z.int().check(z.gte(0)) })
const resultSchema = z.strictObject({
  exitCode: z.int(),
  stdout: z.string(),
  failure: z.enum(['none', 'capacity', 'unsupported-host']),
})

type ProgramFailureKind = 'spawn' | 'exit' | 'timeout' | 'output'
class DarwinProgramError extends DeviceWorkerHostError {
  public constructor(
    public readonly kind: ProgramFailureKind,
    detail: 'capacity' | 'helper',
    public readonly isRetryable: boolean,
    public readonly exitCode?: number | null,
    options?: { cause?: unknown },
  ) {
    super(detail, options)
  }
}

// Native launchctl statuses captured on this rig; ABI values, not tunables.
const LAUNCHCTL_ABSENT_BOOTOUT = 3
const LAUNCHCTL_ABSENT_PRINT = 113

type SpawnChild = (file: string, args: readonly string[], options: SpawnOptions) => ChildProcess
type ProgramResult =
  | { kind: 'success'; stdout: string }
  | { kind: 'absent' }
  | { kind: 'failure'; error: DeviceWorkerHostError }

function spawnFailure(error: unknown): DarwinProgramError {
  const code =
    typeof error === 'object' && error !== null && 'code' in error ? error.code : undefined
  const detail = typeof code === 'string' ? spawnErrnos[code] : undefined
  // Unknown/I/O failures cannot establish that this host lacks GUI support.
  return new DarwinProgramError('spawn', detail ?? 'helper', detail !== 'helper')
}

function attemptFailure(error: unknown): DeviceWorkerHostError {
  if (error instanceof DeviceWorkerHostError) return error
  // Filesystem errno carries retry evidence; a generic validation/preflight
  // exception does not establish transient OS pressure.
  if (typeof error === 'object' && error !== null && 'code' in error) {
    return error.code === 'ETIMEDOUT'
      ? new DarwinProgramError('timeout', 'capacity', true)
      : spawnFailure(error)
  }
  return new DeviceWorkerHostError('helper')
}

/** The driver's only process-start boundary, including the early Aqua reader. */
function program(
  spawnChild: SpawnChild,
  file: string,
  args: readonly string[],
  env: NodeJS.ProcessEnv,
  isSessionOnly: boolean,
): Promise<ProgramResult> {
  return new Promise((resolve) => {
    let child: ChildProcess
    try {
      child = spawnChild(file, [...args], { env, stdio: ['ignore', 'pipe', 'pipe'] })
    } catch (error) {
      resolve({ kind: 'failure', error: spawnFailure(error) })
      return
    }
    let isSettled = false
    const chunks: Buffer[] = []
    const finish = (result: ProgramResult, shouldStop: boolean) => {
      if (isSettled) return
      isSettled = true
      clearTimeout(deadline)
      if (shouldStop) child.kill('SIGKILL')
      resolve(result)
    }
    const deadline = setTimeout(() => {
      finish({ kind: 'failure', error: new DarwinProgramError('timeout', 'capacity', true) }, true)
    }, DEVICE_LIMITS.frameDeadlineMs)
    child.once('error', (error) => {
      finish({ kind: 'failure', error: spawnFailure(error) }, true)
    })
    child.once('close', (code: number | null) => {
      if (
        file === '/bin/launchctl' &&
        ((code === LAUNCHCTL_ABSENT_PRINT && args[0] === 'print') ||
          (code === LAUNCHCTL_ABSENT_BOOTOUT && args[0] === 'bootout'))
      ) {
        finish({ kind: 'absent' }, false)
        return
      }
      finish(
        code === 0 && !isSessionOnly && child.stdout !== null && child.stderr !== null
          ? { kind: 'success', stdout: Buffer.concat(chunks).toString('utf8') }
          : {
              kind: 'failure',
              error: new DarwinProgramError('exit', 'helper', code === null, code),
            },
        false,
      )
    })
    let stdoutBytes = 0
    let stderrBytes = 0
    child.stdout?.on('data', (chunk: Buffer) => {
      if (isSettled) return
      chunks.push(Buffer.from(chunk.subarray(0, DEVICE_LIMITS.frameBytes - stdoutBytes)))
      stdoutBytes += chunk.byteLength
      if (isSessionOnly) {
        // A GUI listing can grow without bound. A complete session line within
        // the kept prefix is sufficient; never retain the trailing services.
        const line = /^\s*session = ([^\r\n]+)\r?\n/m.exec(Buffer.concat(chunks).toString('utf8'))
        if (line !== null) {
          finish({ kind: 'success', stdout: `session = ${line[1] ?? ''}` }, true)
          return
        }
      }
      if (stdoutBytes > DEVICE_LIMITS.frameBytes)
        finish({ kind: 'failure', error: new DarwinProgramError('output', 'helper', false) }, true)
    })
    child.stderr?.on('data', (chunk: Buffer) => {
      if (isSettled) return
      stderrBytes += chunk.byteLength
      if (stderrBytes > DEVICE_LIMITS.frameBytes)
        finish({ kind: 'failure', error: new DarwinProgramError('output', 'helper', false) }, true)
    })
  })
}

type PreparationOutcome =
  | { kind: 'ready' | 'notGui' }
  | { kind: 'broken'; error: DeviceWorkerHostError }
  | { kind: 'retry'; error: DeviceWorkerHostError }
type PreparationState =
  | { kind: 'unknown' }
  | { kind: 'preparing'; result: Promise<PreparationOutcome> }
  | { kind: 'ready' | 'notGui' }
  | { kind: 'broken'; error: DeviceWorkerHostError }

type ReadyMembership = z.infer<typeof readySchema>
type AttemptProgress =
  | { kind: 'allocated' }
  | { kind: 'bootstrapping'; pid?: number; coalition?: number }
  | { kind: 'running'; ready: ReadyMembership }
type NativeResult = z.infer<typeof resultSchema>
type AttemptState =
  | AttemptProgress
  | { kind: 'retiring'; reached: AttemptProgress; result?: NativeResult }
  | { kind: 'pendingReclaim'; reached: AttemptProgress; result?: NativeResult; error: unknown }
  | { kind: 'reclaimed' }
interface DarwinAttempt {
  readonly directory: string
  identity?: FileIdentity
  state: AttemptState
  reclamation?: Promise<void>
  stopWritten?: boolean
  /** Resolves only on the transition to `reclaimed`; the host's uncertain-launch proof. */
  readonly reclaimed: { readonly promise: Promise<void>; resolve(): void }
}
// Node 20 hosts do not have Promise.withResolvers (the supported editor floor).
function reclaimedSignal(): DarwinAttempt['reclaimed'] {
  let signal: { resolve(): void } | undefined
  const promise = new Promise<void>((resolve) => {
    signal = { resolve }
  })
  if (signal === undefined) throw new DeviceWorkerHostError('helper')
  const settled = signal
  return {
    promise,
    resolve: () => {
      settled.resolve()
    },
  }
}

export interface DeviceWorkerDarwinDeps {
  readonly storageDir: string
  readonly environment: NodeJS.ProcessEnv
  readonly spawn?: SpawnChild
  readonly uid?: number
}

async function readBounded(file: string): Promise<unknown> {
  const info = await lstatIdentity(file)
  if (!info.isFile() || info.isSymbolicLink() || info.size > DEVICE_LIMITS.frameBytes)
    throw new DeviceWorkerHostError('result')
  const handle = await open(file, 'r')
  try {
    const opened = await handleIdentity(handle)
    if (!sameFile(opened, info)) throw new DeviceWorkerHostError('result')
    const buffer = Buffer.alloc(DEVICE_LIMITS.frameBytes + 1)
    let offset = 0
    while (offset < buffer.byteLength) {
      const { bytesRead } = await handle.read(buffer, offset, buffer.byteLength - offset, offset)
      if (bytesRead === 0) break
      offset += bytesRead
    }
    if (offset > DEVICE_LIMITS.frameBytes) throw new DeviceWorkerHostError('result')
    return JSON.parse(buffer.subarray(0, offset).toString('utf8'))
  } finally {
    await handle.close()
  }
}

async function isPresent(file: string): Promise<boolean> {
  try {
    await stat(file)
    return true
  } catch (error) {
    if (typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT')
      return false
    throw error
  }
}

function xml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;')
}

/** No GUI domain, compiler, coalition ABI or assertion means unsupported-host. */
export function deviceWorkerDarwin(deps: DeviceWorkerDarwinDeps): DeviceWorkerDriver {
  const env = workerEnvironment(deps.environment, 'darwin')
  const invoke = async (
    file: string,
    args: readonly string[],
    isSessionOnly = false,
  ): Promise<string> => {
    const result = await program(deps.spawn ?? spawn, file, args, env, isSessionOnly)
    if (result.kind === 'failure') throw result.error
    return result.kind === 'absent' ? '' : result.stdout
  }
  const uid = deps.uid ?? (typeof process.getuid === 'function' ? process.getuid() : undefined)
  const domain = `gui/${String(uid)}`
  const root = path.join(deps.storageDir, 'device-workers-darwin')
  const target = path.join(
    root,
    `worker-${createHash('sha256').update(helperSource).digest('hex')}`,
  )
  const jobs = new Map<string, DarwinAttempt>()
  let rootIdentity: FileIdentity | undefined
  let preparation: PreparationState = { kind: 'unknown' }
  let allocating = Promise.resolve()
  const call = async (args: string[]) => {
    const result = await program(deps.spawn ?? spawn, '/bin/launchctl', args, env, false)
    if (result.kind === 'failure') throw result.error
    return result.kind === 'absent' ? undefined : result.stdout
  }
  const transition = (attempt: DarwinAttempt, state: AttemptState): void => {
    // A late observer cannot resurrect a reclaimed attempt.
    if (attempt.state.kind === 'reclaimed') return
    attempt.state = state
    if (state.kind === 'reclaimed') attempt.reclaimed.resolve()
  }
  const progress = (attempt: DarwinAttempt): AttemptProgress | undefined => {
    const state = attempt.state
    if (state.kind === 'reclaimed') return undefined
    return state.kind === 'pendingReclaim' || state.kind === 'retiring' ? state.reached : state
  }
  const observedResult = (attempt: DarwinAttempt): NativeResult | undefined => {
    const state = attempt.state
    return state.kind === 'retiring' || state.kind === 'pendingReclaim' ? state.result : undefined
  }
  const prepareRoot = async (): Promise<void> => {
    await mkdir(root, { recursive: true, mode: Number('0o700') })
    const info = await lstat(root)
    if (
      !info.isDirectory() ||
      info.isSymbolicLink() ||
      info.uid !== uid ||
      (info.mode & Number('0o077')) !== 0
    )
      throw new DeviceWorkerHostError('preflight')
    const identity = await lstatIdentity(root)
    if (rootIdentity !== undefined && !sameFile(identity, rootIdentity))
      throw new DeviceWorkerHostError('preflight')
    rootIdentity ??= identityOf(identity)
  }
  const hasOwnedDirectory = async (attempt: DarwinAttempt): Promise<boolean> => {
    await prepareRoot()
    const name = path.basename(attempt.directory)
    let info
    try {
      info = await lstatIdentity(attempt.directory)
    } catch (error) {
      // Failed allocation may not have created its directory. This is known
      // allocated progress, not a state inferred from a missing readiness file.
      if (
        typeof error === 'object' &&
        error !== null &&
        'code' in error &&
        error.code === 'ENOENT' &&
        progress(attempt)?.kind === 'allocated'
      )
        return false
      throw error
    }
    if (
      !/^attempt-com\.musespark\.device\.[a-f0-9]{32}$/.test(name) ||
      path.dirname(attempt.directory) !== root ||
      !info.isDirectory() ||
      info.isSymbolicLink() ||
      (attempt.identity !== undefined && !sameFile(info, attempt.identity))
    )
      throw new DeviceWorkerHostError('preflight')
    // The factory minted and registered this allocated name before mkdir. The
    // first successful identity observation completes allocation; no process
    // can bootstrap until it is pinned. Later observations must match it.
    attempt.identity ??= identityOf(info)
    return true
  }
  const isMembershipEmpty = async (reached: AttemptProgress): Promise<boolean> => {
    if (reached.kind === 'allocated') return true
    const pid = reached.kind === 'bootstrapping' ? reached.pid : reached.ready.pid
    if (pid === undefined) return true
    const coalition = reached.kind === 'bootstrapping' ? reached.coalition : reached.ready.coalition
    if (coalition !== undefined) {
      const counts = countSchema.parse(
        JSON.parse(await invoke(target, ['--count', String(coalition)])),
      )
      if (counts.active !== 0) return false
    }
    // Before readiness only launchctl's observed PID is available. Prove both
    // that PID and its process group absent; after readiness add coalition proof.
    const rows = await invoke('/bin/ps', ['-axo', 'pid=,pgid='])
    return rows.split(/\r?\n/).every((line) => {
      const row = line.trim()
      if (row === '') return true
      if (!/^\d+\s+\d+$/.test(row)) throw new DeviceWorkerHostError('result')
      return !row.split(/\s+/).includes(String(pid))
    })
  }
  const signalStop = async (attempt: DarwinAttempt): Promise<void> => {
    const reached = progress(attempt)
    if (reached === undefined || attempt.stopWritten === true || reached.kind === 'allocated')
      return
    await writeFile(path.join(attempt.directory, 'stop'), '', { mode: Number('0o600') })
    attempt.stopWritten = true
  }
  const reclaim = (service: string, attempt: DarwinAttempt): Promise<void> => {
    if (attempt.reclamation !== undefined) return attempt.reclamation
    const reached = progress(attempt)
    if (reached === undefined) return Promise.resolve()
    const result = observedResult(attempt)
    transition(attempt, { kind: 'retiring', reached, ...(result !== undefined && { result }) })
    const operation = (async () => {
      try {
        const hasDirectory = await hasOwnedDirectory(attempt)
        // A bootstrap may have published unreadable readiness before PID observation.
        // Always signal it before bootout, including when no host job was returned.
        if (hasDirectory) await signalStop(attempt)
        if (reached.kind !== 'allocated') await call(['bootout', service])
        if (!(await isMembershipEmpty(reached))) throw new DeviceWorkerHostError('result')
        // Recheck immediately before removal; never follow a substituted directory.
        if (hasDirectory && (await hasOwnedDirectory(attempt)))
          await rm(attempt.directory, { recursive: true, force: true })
        transition(attempt, { kind: 'reclaimed' })
        jobs.delete(service)
      } catch (error) {
        const failure = attemptFailure(error)
        transition(attempt, {
          kind: 'pendingReclaim',
          reached,
          ...(result !== undefined && { result }),
          error: failure,
        })
        throw failure
      } finally {
        delete attempt.reclamation
      }
    })()
    attempt.reclamation = operation
    return operation
  }
  const pendingReclaim = async (service: string, attempt: DarwinAttempt): Promise<void> => {
    try {
      await reclaim(service, attempt)
    } catch {
      // reclaim records the failed observation and its furthest progress. The
      // primary launch/retirement failure remains the caller's outcome.
    }
  }
  const sweep = async (shouldInspectRunning = true) => {
    const failures: {
      service: string
      reached: AttemptProgress
      stopWritten: boolean
      error: unknown
    }[] = []
    for (const [service, attempt] of jobs) {
      if (attempt.state.kind === 'pendingReclaim') {
        await pendingReclaim(service, attempt)
      } else if (shouldInspectRunning && attempt.state.kind === 'running') {
        try {
          if ((await call(['print', service])) === undefined) await pendingReclaim(service, attempt)
        } catch (error) {
          const reached = progress(attempt)
          if (reached !== undefined) transition(attempt, { kind: 'pendingReclaim', reached, error })
        }
      }
      if (attempt.state.kind === 'pendingReclaim')
        failures.push({
          service,
          reached: attempt.state.reached,
          stopWritten: attempt.stopWritten === true,
          error: attempt.state.error,
        })
    }
    return failures
  }
  const allocate = async (directory: string): Promise<FileIdentity> => {
    const previous = allocating
    let unlock: { resolve(): void } | undefined
    allocating = new Promise<void>((resolve) => {
      unlock = { resolve }
    })
    if (unlock === undefined) throw new DeviceWorkerHostError('helper')
    try {
      await previous
      await prepareRoot()
      const names = await readdir(root)
      if (
        names.filter((name) => name.startsWith('attempt-')).length >=
        DEVICE_LIMITS.unresolvedAttempts
      ) {
        await sweep()
        const remaining = await readdir(root)
        if (
          remaining.filter((name) => name.startsWith('attempt-')).length >=
          DEVICE_LIMITS.unresolvedAttempts
        )
          throw new DeviceWorkerHostError('capacity')
      }
      await mkdir(directory, { mode: Number('0o700') })
      return identityOf(await lstatIdentity(directory))
    } finally {
      unlock.resolve()
    }
  }
  const rawLaunch = async (
    command: DeviceWorkerCommand,
    environment: NodeJS.ProcessEnv,
    maxProcesses: number,
  ): Promise<
    | Exclude<DeviceWorkerLaunch, { kind: 'launched' }>
    | { kind: 'launched'; job: DeviceWorkerJob & { reclaim(): Promise<void> } }
  > => {
    const label = `com.musespark.device.${randomUUID().replaceAll('-', '')}`
    const directory = path.join(root, `attempt-${label}`)
    const attempt: DarwinAttempt = {
      directory,
      state: { kind: 'allocated' },
      reclaimed: reclaimedSignal(),
    }
    const service = `${domain}/${label}`
    jobs.set(service, attempt)
    const file = (name: string) => path.join(directory, name)
    try {
      attempt.identity = await allocate(directory)
      const config = {
        directory,
        label,
        executable: command.executable,
        args: command.args,
        cwd: command.cwd,
        environment: workerEnvironment(environment, 'darwin'),
        outputBytes: DEVICE_LIMITS.frameBytes,
        maxProcesses,
        pollUs: POSIX_TREE_EXIT_POLL_MS * MILLISECONDS_PER_SECOND,
      }
      const encoded = JSON.stringify(config)
      if (Buffer.byteLength(encoded) > DEVICE_LIMITS.frameBytes)
        throw new DeviceWorkerHostError('preflight')
      await writeFile(file('request.json'), encoded, { flag: 'wx', mode: Number('0o600') })
      const variables = Object.entries(env)
        .map(([name, value = '']) => `<key>${xml(name)}</key><string>${xml(value)}</string>`)
        .join('')
      const plist = `<?xml version="1.0" encoding="UTF-8"?><plist version="1.0"><dict><key>Label</key><string>${label}</string><key>ProgramArguments</key><array><string>${xml(target)}</string><string>--run</string><string>${xml(file('request.json'))}</string></array><key>EnvironmentVariables</key><dict>${variables}</dict><key>RunAtLoad</key><true/><key>AbandonProcessGroup</key><false/><key>LimitLoadToSessionType</key><string>Aqua</string></dict></plist>`
      await writeFile(file('job.plist'), plist, { flag: 'wx', mode: Number('0o600') })
      transition(attempt, { kind: 'bootstrapping' })
      await call(['bootstrap', domain, file('job.plist')])
      const deadline = Date.now() + DEVICE_LIMITS.frameDeadlineMs
      while (!(await isPresent(file('ready.json')))) {
        const printed = await call(['print', service])
        if (printed === undefined) throw new DeviceWorkerHostError('result')
        const pid = /^\s*pid = (\d+)\s*$/m.exec(printed)?.[1]
        if (pid !== undefined)
          transition(attempt, { kind: 'bootstrapping', pid: pidSchema.parse(Number(pid)) })
        if (/state = (?:exited|not running)/.test(printed) || Date.now() >= deadline)
          throw new DeviceWorkerHostError('helper')
        await delay(POSIX_TREE_EXIT_POLL_MS)
      }
      const ready = readySchema.parse(await readBounded(file('ready.json')))
      transition(attempt, { kind: 'bootstrapping', pid: ready.pid, coalition: ready.coalition })
      const query = parseDeviceWorkerQuery(ready.query)
      if (
        query.context.station !== 'gui' ||
        query.context.session !== uid ||
        query.context.desktop !== label ||
        !query.sleepInhibited
      )
        throw new DeviceWorkerHostError('context')
      transition(attempt, { kind: 'running', ready })
    } catch (error) {
      // All failures, including request/plist writes, use the same lifecycle.
      // No activation was issued. Reclamation itself records pending evidence.
      await pendingReclaim(service, attempt)
      const failure = attemptFailure(error)
      // Refused only once reclaimed; a pending attempt is settled by a later sweep.
      return attempt.state.kind === 'reclaimed'
        ? { kind: 'refused', error: failure }
        : { kind: 'uncertain', error: failure, reclaimed: attempt.reclaimed.promise }
    }
    const running = attempt.state
    if (running.kind !== 'running')
      return { kind: 'uncertain', error: new DeviceWorkerHostError('result') }
    const ready = running.ready
    const query = parseDeviceWorkerQuery(ready.query)
    const retirement = (async (): Promise<unknown> => {
      try {
        for (;;) {
          const printed = await call(['print', service])
          const hasPid = printed !== undefined && /^\s*pid = \d+\s*$/m.test(printed)
          if (!hasPid) {
            // Neither a disappeared helper nor a cancellation supplies a result.
            if (!(await isPresent(file('result.json')))) throw new DeviceWorkerHostError('result')
            transition(attempt, { kind: 'retiring', reached: { kind: 'running', ready } })
            if (await isMembershipEmpty({ kind: 'running', ready })) {
              const result = resultSchema.parse(await readBounded(file('result.json')))
              transition(attempt, { kind: 'retiring', reached: { kind: 'running', ready }, result })
              return result
            }
          }
          await delay(POSIX_TREE_EXIT_POLL_MS)
        }
      } catch (error) {
        // Once launched, every failed observation is uncertainty, including a
        // manager/inspection helper's typed startup failure. None proves exit.
        if (attempt.state.kind !== 'reclaimed')
          transition(attempt, {
            kind: 'pendingReclaim',
            reached: { kind: 'running', ready },
            error,
          })
        const failure = new DeviceWorkerHostError('result')
        failure.cause = error
        throw failure
      }
    })()
    void retirement.catch(() => {
      /* The host attaches after readiness validation. */
    })
    const job = {
      query,
      retirement,
      activate: async () => {
        if (attempt.state.kind !== 'running') throw new DeviceWorkerHostError('result')
        await writeFile(file('go'), '', { flag: 'wx', mode: Number('0o600') })
      },
      cancel: async () => {
        if (attempt.state.kind === 'reclaimed') return
        if (await hasOwnedDirectory(attempt)) await signalStop(attempt)
      },
      reclaim: () =>
        observedResult(attempt) === undefined
          ? pendingReclaim(service, attempt)
          : reclaim(service, attempt),
      remove: async () => {
        if (attempt.state.kind === 'reclaimed') return
        if (observedResult(attempt) === undefined) throw new DeviceWorkerHostError('result')
        await reclaim(service, attempt)
      },
    }
    return { kind: 'launched', job }
  }
  const prepareWorker = async (): Promise<PreparationOutcome> => {
    try {
      if (uid === undefined) return { kind: 'notGui' }
      const domainInfo = await invoke('/bin/launchctl', ['print', domain], true)
      if (!/^\s*session = Aqua\s*$/m.test(domainInfo)) return { kind: 'notGui' }
      await prepareRoot()
      if (!(await isPresent(target))) {
        const stem = path.join(root, randomUUID())
        try {
          await writeFile(`${stem}.m`, helperSource, { flag: 'wx', mode: Number('0o600') })
          await invoke('/usr/bin/clang', [
            '-fobjc-arc',
            '-fblocks',
            '-framework',
            'Foundation',
            '-framework',
            'IOKit',
            `${stem}.m`,
            '-o',
            stem,
          ])
          await rename(stem, target)
        } finally {
          await rm(`${stem}.m`, { force: true })
          await rm(stem, { force: true })
        }
      }
      const probe = selfTestSchema.parse(JSON.parse(await invoke(target, ['--self-test'])))
      if (probe.failure === 'capacity') throw new DeviceWorkerHostError('capacity')
      if (!probe.jobProbe || !probe.query) throw new DeviceWorkerHostError('helper')
      parseDeviceWorkerQuery(JSON.parse(await invoke(target, ['--query'])))
      const launched = await rawLaunch(
        { executable: '/usr/bin/true', args: [], cwd: root, requiredTools: [] },
        env,
        1,
      )
      // A pending probe stays in its record for the entry sweeps; the failure is the outcome.
      if (launched.kind !== 'launched') throw launched.error
      const job = launched.job
      try {
        await job.activate()
        const result = resultSchema.parse(await job.retirement)
        if (result.failure === 'capacity') throw new DeviceWorkerHostError('capacity')
        if (result.exitCode !== 0 || result.failure !== 'none')
          throw new DeviceWorkerHostError('helper')
        return { kind: 'ready' }
      } finally {
        try {
          await job.cancel()
        } finally {
          await job.reclaim()
        }
      }
    } catch (error) {
      // Retry cleanup once before publishing a cached outcome. A one-shot
      // cleanup failure must not leave a definitive failure half alive.
      await sweep(false)
      const failure = attemptFailure(error)
      const isRetryable =
        failure instanceof DarwinProgramError
          ? failure.isRetryable
          : failure.detail === 'capacity' || failure.detail === 'result'
      return { kind: isRetryable ? 'retry' : 'broken', error: failure }
    }
  }
  const isPrepared = async (): Promise<boolean> => {
    // Even definitive preparation outcomes may have pending cleanup evidence.
    if (preparation.kind !== 'preparing') await sweep(false)
    if (preparation.kind === 'unknown') {
      // Set preparing before any caller can start a second preparation.
      const result = (async () => {
        const outcome = await prepareWorker()
        preparation = outcome.kind === 'retry' ? { kind: 'unknown' } : outcome
        return outcome
      })()
      preparation = { kind: 'preparing', result }
    }
    const outcome = preparation.kind === 'preparing' ? await preparation.result : preparation
    if (outcome.kind === 'retry') throw outcome.error
    return outcome.kind === 'ready'
  }
  return {
    platform: 'darwin',
    selfTest: isPrepared,
    launch: async (command, environment, attempt): Promise<DeviceWorkerLaunch> => {
      let maxProcesses: number
      // Nothing is registered for this attempt before rawLaunch: these refusals allocate nothing.
      try {
        maxProcesses = admittedProcessLimit(attempt)
        if (!(await isPrepared()))
          throw preparation.kind === 'broken'
            ? preparation.error
            : new DeviceWorkerHostError('helper')
        await sweep()
      } catch (error) {
        return deviceWorkerRefused(attemptFailure(error))
      }
      return await rawLaunch(command, environment, maxProcesses)
    },
    query: async () => {
      const failures = await sweep(false)
      if (failures.length > 0) {
        const failure = new DeviceWorkerHostError('result')
        failure.message = UI_TEXT.devices.unresolvedHelp
        failure.cause = new AggregateError(failures, UI_TEXT.devices.unresolvedHelp)
        throw failure
      }
      if (!(await isPrepared()))
        throw preparation.kind === 'broken'
          ? preparation.error
          : new DeviceWorkerHostError('helper')
      const query = parseDeviceWorkerQuery(JSON.parse(await invoke(target, ['--query'])))
      for (const [service, job] of jobs) {
        const running = job.state
        if (running.kind !== 'running') continue
        const printed = await call(['print', service])
        if (printed === undefined || !/^\s*pid = \d+\s*$/m.test(printed)) continue
        const queryFile = path.join(job.directory, 'query.json')
        const sample = parseDeviceWorkerQuery(
          (await isPresent(queryFile)) ? await readBounded(queryFile) : running.ready.query,
        )
        query.sleepInhibited ||= sample.sleepInhibited
        query.activeProcesses += sample.activeProcesses
        query.cpu100ns += sample.cpu100ns
        query.peakMemoryBytes += sample.peakMemoryBytes
      }
      return query
    },
  }
}
