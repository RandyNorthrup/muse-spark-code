import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { once } from 'node:events'
import { mkdtemp, open, rm, unlink } from 'node:fs/promises'
import { createConnection, createServer, type Socket } from 'node:net'
import os from 'node:os'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import * as z from 'zod/mini'
import { expect, it } from 'vitest'
import { CoordinatorSpecification } from './helpers/m96dCoordinatorSpecification'

it('F1: an unavailable native endpoint leaves its existing owner and admitted work alive', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'm96d-'))
  const endpoint =
    process.platform === 'win32'
      ? String.raw`\\.\pipe\m96d-${randomUUID()}`
      : path.join(directory, 'owner.sock')
  const connections = new Set<Socket>()
  const server = createServer((socket) => {
    connections.add(socket)
    socket.on('error', () => {
      // Cleanup may destroy the peer while an echo is in flight.
    })
    socket.pipe(socket)
  })
  const spec = new CoordinatorSpecification('epoch-A')
  expect(spec.reserve('grant-A', 'owner-A', ['landing', 'worker'])).toBe(true)
  let original: Socket | undefined
  let probe: Socket | undefined
  try {
    server.listen(endpoint)
    await once(server, 'listening')
    const accepted = once(server, 'connection')
    original = createConnection(endpoint)
    await once(original, 'connect')
    await accepted
    if (process.platform === 'win32') server.close()
    else await unlink(endpoint)

    let failure: unknown
    if (process.platform === 'win32') {
      // net.connect retries a busy pipe while its existing peer stays open.
      // File open observes the unavailable native endpoint without retrying.
      try {
        const handle = await open(endpoint, 'r+')
        await handle.close()
      } catch (error) {
        failure = error
      }
    } else {
      probe = createConnection(endpoint)
      ;[failure] = await once(probe, 'error')
    }
    const { code } = z.object({ code: z.string() }).parse(failure)
    expect(process.platform === 'win32' ? ['EBUSY'] : ['ENOENT', 'ECONNREFUSED']).toContain(code)
    spec.endpointFailed(code)
    expect(spec.electSuccessor(false)).toBe(false)
    expect(spec.reserve('grant-B', 'owner-B', ['landing', 'worker'])).toBe(false)
    expect(spec.held('grant-A')).toEqual(['landing', 'worker'])

    // The very same listener process still services an admitted connection.
    const received = once(original, 'data')
    original.write('owner-still-alive')
    const [echo] = await received
    if (!Buffer.isBuffer(echo)) throw new Error('Expected an echo buffer')
    expect(echo.toString('utf8')).toBe('owner-still-alive')
    expect(server.listening).toBe(process.platform !== 'win32')
  } finally {
    original?.destroy()
    probe?.destroy()
    for (const socket of connections) socket.destroy()
    if (server.listening)
      await new Promise<void>((resolve) => {
        server.close(() => {
          resolve()
        })
      })
    await rm(directory, { recursive: true, force: true })
  }
})

// Real Windows qualification counterexample; non-Windows hosts retain the portable suite.
const windowsProbe = `$ErrorActionPreference = 'Stop'
Add-Type -TypeDefinition @'
using System;
using System.ComponentModel;
using System.Runtime.InteropServices;
using System.Security.Principal;
using System.Text;
public static class ScopeProbe {
  [StructLayout(LayoutKind.Sequential)] struct SI {
    public int cb; public IntPtr reserved, desktop, title; public int x,y,xs,ys,xc,yc,fill,flags;
    public short show,reserved2; public IntPtr data,input,output,error;
  } [StructLayout(LayoutKind.Sequential)] struct PI { public IntPtr process,thread; public int pid,tid; }
  [StructLayout(LayoutKind.Sequential)] struct Limits {
    public long processTime,jobTime; public uint flags; public UIntPtr min,max; public uint active; public UIntPtr affinity; public uint priority,scheduling;
    public ulong readOps,writeOps,otherOps,readBytes,writeBytes,otherBytes;
    public UIntPtr processMemory,jobMemory,peakProcess,peakJob;
  }
  [StructLayout(LayoutKind.Sequential)] struct Accounting {
    public long user,kernel,periodUser,periodKernel; public uint faults,total,active,terminated;
  } [DllImport("kernel32.dll", SetLastError=true)] static extern IntPtr CreateJobObject(IntPtr a,string name);
  [DllImport("kernel32.dll", SetLastError=true)] static extern bool SetInformationJobObject(IntPtr job,int cls,ref Limits limits,int size);   [DllImport("kernel32.dll", SetLastError=true)] static extern bool AssignProcessToJobObject(IntPtr job,IntPtr process);
  [DllImport("kernel32.dll", SetLastError=true)] static extern bool QueryInformationJobObject(IntPtr job,int cls,out Accounting value,int size,IntPtr length);   [DllImport("kernel32.dll", SetLastError=true)] static extern bool IsProcessInJob(IntPtr process,IntPtr job,out bool member);
  [DllImport("kernel32.dll", SetLastError=true,CharSet=CharSet.Unicode)] static extern bool CreateProcess(string app,StringBuilder cmd,IntPtr pa,IntPtr ta,bool inherit,uint flags,IntPtr env,string cwd,ref SI si,out PI pi);   [DllImport("advapi32.dll", SetLastError=true,CharSet=CharSet.Unicode)] static extern bool CreateProcessAsUser(IntPtr token,string app,StringBuilder cmd,IntPtr pa,IntPtr ta,bool inherit,uint flags,IntPtr env,string cwd,ref SI si,out PI pi);
  [DllImport("advapi32.dll", SetLastError=true)] static extern bool OpenProcessToken(IntPtr process,uint access,out IntPtr token);   [DllImport("advapi32.dll", SetLastError=true)] static extern bool CreateRestrictedToken(IntPtr token,uint flags,uint dc,IntPtr ds,uint pc,IntPtr ps,uint rc,IntPtr rs,out IntPtr result);
  [DllImport("advapi32.dll", SetLastError=true)] static extern bool GetTokenInformation(IntPtr token,int cls,IntPtr data,int size,out int needed);   [DllImport("kernel32.dll")] static extern IntPtr GetCurrentProcess(); [DllImport("kernel32.dll")] static extern bool TerminateProcess(IntPtr process,uint code);
  [DllImport("kernel32.dll", SetLastError=true)] static extern IntPtr OpenProcess(uint access,bool inherit,int pid);   [DllImport("kernel32.dll", SetLastError=true)] static extern uint ResumeThread(IntPtr thread);
  [DllImport("kernel32.dll")] static extern uint WaitForSingleObject(IntPtr handle,uint ms);   [DllImport("kernel32.dll")] public static extern bool CloseHandle(IntPtr handle);
  public sealed class Launch { public IntPtr Job,Process; public int Pid; public string[] Token; }
  static void Check(bool ok) { if(!ok) throw new Win32Exception(Marshal.GetLastWin32Error()); }
  public static string[] Facts(IntPtr process) {
    IntPtr token; Check(OpenProcessToken(process,8,out token));
    IntPtr buffer=Marshal.AllocHGlobal(4096);
    try {
      int needed; Check(GetTokenInformation(token,10,buffer,4096,out needed));
      // TOKEN_STATISTICS.AuthenticationId follows the eight-byte TokenId.
      string luid=Marshal.ReadInt64(buffer,8).ToString();
      Check(GetTokenInformation(token,3,buffer,4096,out needed));
      string privileges=Marshal.ReadInt32(buffer).ToString();
      using(var identity=new WindowsIdentity(token)) return new[]{identity.User.Value,luid,privileges};
    } finally { Marshal.FreeHGlobal(buffer); CloseHandle(token); } }
  public static string[] PidFacts(int pid) {
    IntPtr process=OpenProcess(0x1000,false,pid); Check(process!=IntPtr.Zero);
    try { return Facts(process); } finally { CloseHandle(process); }
  }
  public static bool Member(IntPtr job,int pid) {
    IntPtr process=OpenProcess(0x1000,false,pid); Check(process!=IntPtr.Zero);
    try { bool member; Check(IsProcessInJob(process,job,out member)); return member; }
    finally { CloseHandle(process); } }
  public static uint Active(IntPtr job) {
    Accounting a; Check(QueryInformationJobObject(job,1,out a,Marshal.SizeOf(typeof(Accounting)),IntPtr.Zero)); return a.active;
  }
  public static Launch Start(string command,bool restricted) {
    IntPtr job=CreateJobObject(IntPtr.Zero,null), token=IntPtr.Zero, low=IntPtr.Zero;
    Check(job!=IntPtr.Zero); var limits=new Limits(); limits.flags=0x2000;
    Check(SetInformationJobObject(job,9,ref limits,Marshal.SizeOf(typeof(Limits))));
    var si=new SI(); si.cb=Marshal.SizeOf(typeof(SI)); PI pi=new PI(); bool kept=false;
    try {
      if(restricted) {
        Check(OpenProcessToken(GetCurrentProcess(),0x000b,out token));
        Check(CreateRestrictedToken(token,1,0,IntPtr.Zero,0,IntPtr.Zero,0,IntPtr.Zero,out low));
        Check(CreateProcessAsUser(low,null,new StringBuilder(command),IntPtr.Zero,IntPtr.Zero,false,0x08000004,IntPtr.Zero,null,ref si,out pi));
      } else Check(CreateProcess(null,new StringBuilder(command),IntPtr.Zero,IntPtr.Zero,false,0x08000004,IntPtr.Zero,null,ref si,out pi));
      try {
        Check(AssignProcessToJobObject(job,pi.process));
        var result=new Launch {Job=job,Process=pi.process,Pid=pi.pid,Token=Facts(pi.process)};
        Check(ResumeThread(pi.thread)!=0xffffffff); kept=true; return result;
      } finally { CloseHandle(pi.thread); }
    } finally { if(!kept) { if(pi.process!=IntPtr.Zero) { TerminateProcess(pi.process,9); WaitForSingleObject(pi.process,10000); CloseHandle(pi.process); } CloseHandle(job); } if(token!=IntPtr.Zero) CloseHandle(token); if(low!=IntPtr.Zero) CloseHandle(low); }
  }
  public static void Wait(Launch launch) { Check(WaitForSingleObject(launch.Process,10000)==0); }
}
'@
$directory = '{{DIRECTORY}}'
[void][IO.Directory]::CreateDirectory($directory)
$source = 'm96d-' + [guid]::NewGuid().ToString()
Register-WmiEvent -Class Win32_ProcessStartTrace -SourceIdentifier $source | Out-Null
$rows = @(); try {
  foreach ($restricted in @($false,$true)) {
    $lane = Join-Path $directory ([string]$restricted)
    [void][IO.Directory]::CreateDirectory($lane)
    $gate = Join-Path $lane 'release'
    $landed = Join-Path $lane 'landed'
    $created = Join-Path $lane 'created.json'
    $writer = '$watch=[Diagnostics.Stopwatch]::StartNew(); while(-not [IO.File]::Exists(''' + $gate.Replace("'","''") + ''')) { if($watch.ElapsedMilliseconds -gt 15000) {exit 9}; [Threading.Thread]::Sleep(10) }; [IO.File]::WriteAllText(''' + $landed.Replace("'","''") + ''',''late-write'')'
    $encodedWriter = [Convert]::ToBase64String([Text.Encoding]::Unicode.GetBytes($writer))
    $writerCommand = 'powershell.exe -NoProfile -NonInteractive -EncodedCommand ' + $encodedWriter
    $root = '$result=([wmiclass]''Win32_Process'').Create(''' + $writerCommand + '''); $result | Select-Object ReturnValue,ProcessId | ConvertTo-Json -Compress | Set-Content -LiteralPath ''' + $created.Replace("'","''") + ''''
    $encodedRoot = [Convert]::ToBase64String([Text.Encoding]::Unicode.GetBytes($root))
    $launch = [ScopeProbe]::Start('powershell.exe -NoProfile -NonInteractive -EncodedCommand ' + $encodedRoot,$restricted)
    $writerProcess = $null
    try {
      [ScopeProbe]::Wait($launch)
      $result = Get-Content -LiteralPath $created -Raw | ConvertFrom-Json
      if ($result.ReturnValue -ne 0) {throw ('WMI Create failed: ' + $result.ReturnValue)}
      $writerPid = [int]$result.ProcessId
      $writerProcess = [Diagnostics.Process]::GetProcessById($writerPid); [void]$writerProcess.Handle
      $facts = [ScopeProbe]::PidFacts($writerPid)
      $member = [ScopeProbe]::Member($launch.Job,$writerPid); $active = [ScopeProbe]::Active($launch.Job)
      $watch = [Diagnostics.Stopwatch]::StartNew()
      do {
        $event = Get-Event -SourceIdentifier $source -ErrorAction SilentlyContinue | Where-Object { $_.SourceEventArgs.NewEvent.ProcessID -eq $writerPid } | Select-Object -First 1
        if ($null -ne $event) { break }
        [Threading.Thread]::Sleep(20)
      } while ($watch.ElapsedMilliseconds -lt 3000)
      $parent = (Get-CimInstance Win32_Process -Filter "ProcessId=$writerPid").ParentProcessId
      $parentName = (Get-Process -Id $parent).ProcessName
      [IO.File]::WriteAllText($gate,'go')
      $watch.Restart()
      while (-not [IO.File]::Exists($landed)) {
        if ($watch.ElapsedMilliseconds -gt 5000) {throw 'Writer did not land'}
        [Threading.Thread]::Sleep(10)
      }
      $rows += [pscustomobject]@{restrictedLaunch=$restricted; rootPid=$launch.Pid; writerPid=$writerPid; jobActive=$active; writerInJob=$member; rootSid=$launch.Token[0]; writerSid=$facts[0]; rootLogon=$launch.Token[1]; writerLogon=$facts[1]; rootPrivileges=$launch.Token[2]; writerPrivileges=$facts[2]; traceObserved=($null -ne $event); traceParent=$(if($event){ $event.SourceEventArgs.NewEvent.ParentProcessID }else{ $null }); actualParent=$parent; parentName=$parentName; lateWrite=[IO.File]::ReadAllText($landed)}
      if (-not $writerProcess.WaitForExit(5000)) {throw "Writer did not exit"}
    } finally { if ($null -ne $writerProcess) { if (-not $writerProcess.HasExited) {$writerProcess.Kill(); [void]$writerProcess.WaitForExit(5000)}; $writerProcess.Dispose() }; [void][ScopeProbe]::CloseHandle($launch.Process); [void][ScopeProbe]::CloseHandle($launch.Job) }
  }
  $rows | ConvertTo-Json -Compress
} finally {
  Unregister-Event -SourceIdentifier $source
  Get-Event -SourceIdentifier $source -ErrorAction SilentlyContinue | Remove-Event
}
`

if (process.platform === 'win32') {
  it('RVCM96D1 native: an empty Job leaves a WMI writer outside the scope', async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'm96d-wmi-'))
    try {
      const { stdout } = await promisify(execFile)(
        'powershell.exe',
        [
          '-NoProfile',
          '-NonInteractive',
          '-Command',
          windowsProbe.replace('{{DIRECTORY}}', () => directory.replaceAll("'", "''")),
        ],
        { windowsHide: true },
      )
      const rows = z
        .array(
          z.object({
            restrictedLaunch: z.boolean(),
            jobActive: z.number(),
            writerInJob: z.boolean(),
            rootSid: z.string(),
            writerSid: z.string(),
            rootLogon: z.string(),
            writerLogon: z.string(),
            rootPrivileges: z.string(),
            writerPrivileges: z.string(),
            traceObserved: z.boolean(),
            rootPid: z.number(),
            traceParent: z.number(),
            actualParent: z.number(),
            parentName: z.string(),
            lateWrite: z.string(),
          }),
        )
        .parse(JSON.parse(stdout))
      expect(rows.map((row) => row.restrictedLaunch)).toEqual([false, true])
      for (const row of rows) {
        expect(row.jobActive).toBe(0)
        expect(row.writerInJob).toBe(false)
        expect(row.writerSid).toBe(row.rootSid)
        expect(row.writerLogon).toBe(row.rootLogon)
        expect(row.writerPrivileges).toBe(row.rootPrivileges)
        if (row.restrictedLaunch) expect(row.rootPrivileges).toBe('1')
        expect(row.traceObserved).toBe(true)
        expect(row.traceParent).toBe(row.actualParent)
        expect(row.traceParent).not.toBe(row.rootPid)
        expect(row.parentName).toBe('WmiPrvSE')
        expect(row.lateWrite).toBe('late-write')
        const spec = new CoordinatorSpecification('epoch-A')
        const reference = {
          platform: 'win32',
          kind: 'processHandle',
          token: 'held-A',
          boot: 'boot-A',
          start: 'captured-A',
          pid: row.rootPid,
          validated: true,
          exited: true,
        } as const
        spec.reserve('grant-A', 'owner-A', ['landing'])
        spec.persistIntent('grant-A', true)
        spec.spawn('grant-A')
        spec.register('grant-A', reference, 'unknown')
        expect(
          spec.settle(
            {
              grant: 'grant-A',
              epoch: 'epoch-A',
              reference,
              treeEmpty: row.jobActive === 0,
              effectsDrained: true,
            },
            true,
          ),
        ).toBe(false)
        expect(spec.retirementState('grant-A')).toBe('unknown')
        expect(spec.reserve('grant-B', 'owner-B', ['landing'])).toBe(false)
      }
    } finally {
      await rm(directory, { recursive: true, force: true })
    }
  })
}
