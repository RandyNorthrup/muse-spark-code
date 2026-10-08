// M100/H: an on-demand GUI launchd job, with a kernel coalition retirement proof.
import { execFile } from 'node:child_process'
import { createHash, randomUUID } from 'node:crypto'
import { lstat, mkdir, open, readdir, rename, rm, stat, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import * as z from 'zod/mini'
import { workerEnvironment } from '../../core/team/refFence'
import { handleIdentity, lstatIdentity, sameFile } from '../../core/fs/fileIdentity'
import {
  DEVICE_LIMITS,
  MILLISECONDS_PER_SECOND,
  POSIX_TREE_EXIT_POLL_MS,
} from '../../shared/constants'
import {
  DeviceWorkerHostError,
  parseDeviceWorkerQuery,
  type DeviceWorkerCommand,
  type DeviceWorkerDriver,
  type DeviceWorkerJob,
} from '../devices/deviceWorkerHost'
import type { RunProgram } from '../processTree'

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
static BOOL members(uint64_t id, BOOL stop, uint64_t *memory) {
  int bytes = proc_listallpids(NULL, 0);
  if (bytes <= 0) return NO;
  // The API returns a count when no buffer is passed; retry a full buffer.
  int capacity = bytes + 1;
  pid_t *pids = calloc(capacity, sizeof(pid_t)); if (!pids) return NO;
  int size = proc_listallpids(pids, capacity * sizeof(pid_t));
  if (size < 0 || size >= capacity) { free(pids); return NO; }
  *memory = 0;
  for (int i = 0; i < size; i++) {
    if (pids[i] <= 0 || pids[i] == getpid() || coalition(pids[i]) != id) continue;
    struct rusage_info_v2 usage = {0};
    if (proc_pid_rusage(pids[i], RUSAGE_INFO_V2, (rusage_info_t *)&usage) == 0) *memory += usage.ri_resident_size;
    // Recheck coalition membership immediately before signalling a member.
    if (stop && coalition(pids[i]) == id) kill(pids[i], SIGKILL);
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
  if (argc == 2 && !strcmp(argv[1], "--query")) {
    NSData *data = [NSJSONSerialization dataWithJSONObject:query(@"transport",0,0,0,NO) options:0 error:nil];
    return write(STDOUT_FILENO, data.bytes, data.length) == data.length ? 0 : 1;
  }
  if (argc == 3 && !strcmp(argv[1], "--count")) {
    uint64_t active, cpu; if (!counts(strtoull(argv[2], NULL, 10), &active, &cpu)) return 1;
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
  NSString *failure = launchError ? (launchError == EAGAIN || launchError == ENOMEM ? @"capacity" : @"unsupported-host") : @"none";
  for (;;) { @autoreleasepool {
    drain(&output[0],stdoutData,[config[@"outputBytes"] unsignedIntegerValue],&overflow);
    drain(&errors[0],stderrData,[config[@"outputBytes"] unsignedIntegerValue],&overflow);
    if (!exited && waitpid(child,&status,WNOHANG) == child) exited = YES;
    if (!counts(id,&active,&cpu) || active < 1) return 1; // Unknown is never retirement.
    if (overflow || active - 1 > [config[@"maxProcesses"] unsignedLongLongValue]) failure = @"capacity";
    BOOL stop = present(file(@"stop")) || ![failure isEqualToString:@"none"];
    uint64_t memory;
    if (!members(id,stop,&memory)) return 1;
    if (memory > peak) peak = memory;
    if (!save(file(@"query.json"), query(label,active-1,cpu,peak,awake))) return 1;
    // Kernel counts include every descendant, even setsid/double-fork escapees.
    if (exited && active == 1 && output[0] < 0 && errors[0] < 0) break;
    usleep([config[@"pollUs"] unsignedIntValue]);
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

const readySchema = z.strictObject({
  pid: z.int().check(z.gt(1)),
  coalition: z.int().check(z.gt(0)),
  query: z.unknown(),
})
const countSchema = z.strictObject({ active: z.int().check(z.gte(0)) })
const resultSchema = z.strictObject({
  exitCode: z.int(),
  stdout: z.string(),
  failure: z.enum(['none', 'capacity', 'unsupported-host']),
})

const run: RunProgram = (file, args, env) =>
  new Promise((resolve, reject) => {
    const child = execFile(
      file,
      [...args],
      {
        env,
        timeout: DEVICE_LIMITS.frameDeadlineMs,
        maxBuffer: DEVICE_LIMITS.frameBytes,
      },
      (error, stdout) => {
        if (error === null) resolve(stdout)
        else
          reject(
            new DeviceWorkerHostError(
              error.code === 'EAGAIN' || error.code === 'ENOMEM' ? 'capacity' : 'helper',
            ),
          )
      },
    )
    child.stdin?.end()
  })

export interface DeviceWorkerDarwinDeps {
  readonly storageDir: string
  readonly environment: NodeJS.ProcessEnv
  readonly run?: RunProgram
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
  const invoke = deps.run ?? run
  const env = workerEnvironment(deps.environment, 'darwin')
  const uid = deps.uid ?? (typeof process.getuid === 'function' ? process.getuid() : undefined)
  const domain = `gui/${String(uid)}`
  const root = path.join(deps.storageDir, 'device-workers-darwin')
  const target = path.join(
    root,
    `worker-${createHash('sha256').update(helperSource).digest('hex')}`,
  )
  const jobs = new Map<string, { directory: string; pid: number }>()
  let preparing: Promise<boolean> | undefined
  let allocating = Promise.resolve()
  const call = (args: string[]) => invoke('/bin/launchctl', args, env)
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
  }
  const allocate = async (directory: string): Promise<void> => {
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
      const entries = names.filter((name) => name.startsWith('attempt-'))
      if (entries.length >= DEVICE_LIMITS.unresolvedAttempts)
        throw new DeviceWorkerHostError('capacity')
      await mkdir(directory, { mode: Number('0o700') })
    } finally {
      unlock.resolve()
    }
  }
  const rawLaunch = async (
    command: DeviceWorkerCommand,
    environment: NodeJS.ProcessEnv,
  ): Promise<DeviceWorkerJob> => {
    const label = `com.musespark.device.${randomUUID().replaceAll('-', '')}`
    const directory = path.join(root, `attempt-${label}`)
    await allocate(directory)
    const file = (name: string) => path.join(directory, name)
    const config = {
      directory,
      label,
      executable: command.executable,
      args: command.args,
      cwd: command.cwd,
      environment: workerEnvironment(environment, 'darwin'),
      outputBytes: DEVICE_LIMITS.frameBytes,
      maxProcesses: DEVICE_LIMITS.processes,
      pollUs: POSIX_TREE_EXIT_POLL_MS * MILLISECONDS_PER_SECOND,
    }
    const encoded = JSON.stringify(config)
    if (Buffer.byteLength(encoded) > DEVICE_LIMITS.frameBytes)
      throw new DeviceWorkerHostError('preflight')
    await writeFile(file('request.json'), encoded, { flag: 'wx', mode: Number('0o600') })
    const variables = Object.entries(env)
      .map(([name, value]) => `<key>${xml(name)}</key><string>${xml(value ?? '')}</string>`)
      .join('')
    const plist = `<?xml version="1.0" encoding="UTF-8"?><plist version="1.0"><dict><key>Label</key><string>${label}</string><key>ProgramArguments</key><array><string>${xml(target)}</string><string>--run</string><string>${xml(file('request.json'))}</string></array><key>EnvironmentVariables</key><dict>${variables}</dict><key>RunAtLoad</key><true/><key>AbandonProcessGroup</key><false/><key>LimitLoadToSessionType</key><string>Aqua</string></dict></plist>`
    await writeFile(file('job.plist'), plist, { flag: 'wx', mode: Number('0o600') })
    const service = `${domain}/${label}`
    let ready: z.infer<typeof readySchema>
    let query: ReturnType<typeof parseDeviceWorkerQuery>
    try {
      await call(['bootstrap', domain, file('job.plist')])
      const deadline = Date.now() + DEVICE_LIMITS.frameDeadlineMs
      while (!(await isPresent(file('ready.json')))) {
        const printed = await call(['print', service])
        if (/state = (?:exited|not running)/.test(printed) || Date.now() >= deadline)
          throw new DeviceWorkerHostError('helper')
        await delay(POSIX_TREE_EXIT_POLL_MS)
      }
      ready = readySchema.parse(await readBounded(file('ready.json')))
      query = parseDeviceWorkerQuery(ready.query)
      if (
        query.context.station !== 'gui' ||
        query.context.session !== uid ||
        query.context.desktop !== label ||
        !query.sleepInhibited
      )
        throw new DeviceWorkerHostError('context')
    } catch (error) {
      // Activation has never been issued: stop the helper, retaining evidence on
      // any manager failure. No readiness deadline ever resolves retirement.
      await writeFile(file('stop'), '', { mode: Number('0o600') })
      try {
        await call(['bootout', service])
      } catch {
        /* Keep this attempt for local recovery. */
      }
      throw error instanceof DeviceWorkerHostError ? error : new DeviceWorkerHostError('helper')
    }
    jobs.set(service, { directory, pid: ready.pid })
    let isObserved = false
    let isRemoved = false
    const retirement = (async (): Promise<unknown> => {
      try {
        for (;;) {
          const printed = await call(['print', service])
          const hasPid = /^\s*pid = \d+\s*$/m.test(printed)
          if (!hasPid) {
            // Neither a disappeared helper nor a cancellation supplies a result.
            if (!(await isPresent(file('result.json')))) throw new DeviceWorkerHostError('result')
            const counts: unknown = JSON.parse(
              await invoke(target, ['--count', String(ready.coalition)], env),
            )
            const group = await invoke('/bin/ps', ['-axo', 'pgid='], env)
            if (
              countSchema.parse(counts).active === 0 &&
              group.split(/\r?\n/).every((line) => line.trim() !== String(ready.pid))
            ) {
              const result = resultSchema.parse(await readBounded(file('result.json')))
              isObserved = true
              return result
            }
          }
          await delay(POSIX_TREE_EXIT_POLL_MS)
        }
      } catch {
        // Once launched, every failed observation is uncertainty, including a
        // manager/inspection helper's typed startup failure. None proves exit.
        throw new DeviceWorkerHostError('result')
      }
    })()
    void retirement.catch(() => {
      /* The host attaches after readiness validation. */
    })
    return {
      query,
      retirement,
      activate: () => writeFile(file('go'), '', { flag: 'wx', mode: Number('0o600') }),
      cancel: async () => {
        if (!isRemoved && !isObserved) await writeFile(file('stop'), '', { mode: Number('0o600') })
      },
      remove: async () => {
        if (!isObserved) throw new DeviceWorkerHostError('result')
        if (isRemoved) return
        await call(['bootout', service])
        isRemoved = true
        jobs.delete(service)
        await rm(directory, { recursive: true, force: true })
      },
    }
  }
  const isPrepared = async (): Promise<boolean> => {
    try {
      if (uid === undefined) return false
      const domainInfo = await call(['print', domain])
      if (!domainInfo.includes('session = Aqua')) return false
      await prepareRoot()
      if (!(await isPresent(target))) {
        const stem = path.join(root, randomUUID())
        try {
          await writeFile(`${stem}.m`, helperSource, { flag: 'wx', mode: Number('0o600') })
          await invoke(
            '/usr/bin/clang',
            [
              '-fobjc-arc',
              '-fblocks',
              '-framework',
              'Foundation',
              '-framework',
              'IOKit',
              `${stem}.m`,
              '-o',
              stem,
            ],
            env,
          )
          await rename(stem, target)
        } finally {
          await rm(`${stem}.m`, { force: true })
          await rm(stem, { force: true })
        }
      }
      parseDeviceWorkerQuery(JSON.parse(await invoke(target, ['--query'], env)))
      const job = await rawLaunch(
        { executable: '/usr/bin/true', args: [], cwd: root, requiredTools: [] },
        env,
      )
      try {
        await job.activate()
        const result = resultSchema.parse(await job.retirement)
        return result.exitCode === 0 && result.failure === 'none'
      } finally {
        await job.cancel()
        await job.remove()
      }
    } catch (error) {
      if (error instanceof DeviceWorkerHostError && error.detail === 'capacity') throw error
      return false
    }
  }
  return {
    platform: 'darwin',
    selfTest: () => (preparing ??= isPrepared()),
    launch: async (command, environment) => {
      if (!(await (preparing ??= isPrepared()))) throw new DeviceWorkerHostError('helper')
      return await rawLaunch(command, environment)
    },
    query: async () => {
      if (!(await (preparing ??= isPrepared()))) throw new DeviceWorkerHostError('helper')
      const query = parseDeviceWorkerQuery(JSON.parse(await invoke(target, ['--query'], env)))
      for (const [service, job] of jobs) {
        const printed = await call(['print', service])
        if (!/^\s*pid = \d+\s*$/m.test(printed)) continue
        const value = await readBounded(
          path.join(
            job.directory,
            (await isPresent(path.join(job.directory, 'query.json'))) ? 'query.json' : 'ready.json',
          ),
        )
        const ready = readySchema.safeParse(value)
        const sample = parseDeviceWorkerQuery(ready.success ? ready.data.query : value)
        query.sleepInhibited ||= sample.sleepInhibited
        query.activeProcesses += sample.activeProcesses
        query.cpu100ns += sample.cpu100ns
        query.peakMemoryBytes += sample.peakMemoryBytes
      }
      return query
    },
  }
}
