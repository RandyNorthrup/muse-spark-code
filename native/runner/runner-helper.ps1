param(
    [Parameter(Mandatory=$true)][ValidateSet('init','health','start','status','output','job','execute','selftest')][string]$Action,
    [Parameter(Mandatory=$true)][string]$Root,
    [string]$RunId,
    [string]$MaxJobs,
    [string]$Snapshot,
    [string]$CacheKey,
    [string]$Setup,
    [string]$Command,
    [string]$Timeout
)
$ErrorActionPreference = 'Stop'
foreach ($directory in @('runs','slots','cache')) { [IO.Directory]::CreateDirectory((Join-Path $Root $directory)) | Out-Null }
function Write-Protocol([hashtable]$Value) { [Console]::WriteLine((ConvertTo-Json -Compress $Value)) }
function Get-RunPath([string]$Id) { return Join-Path (Join-Path $Root 'runs') $Id }
function Remove-CacheLock([string]$Cache, [string]$Id) {
    $lock=$Cache+'.creating'
    # Expiry never authorizes stealing: the supervisor calls this after native retirement.
    if ((Test-Path -LiteralPath $lock) -and [IO.File]::ReadAllText($lock).StartsWith($Id+' ')) { [IO.File]::Delete($lock) }
}
function Remove-Credentials {
    foreach ($entry in @(Get-ChildItem Env:)) {
        if ($entry.Name -match '_API_KEY$|^GIT_|^SSH_ASKPASS' -or $entry.Name -in @('AWS_ACCESS_KEY_ID','AWS_SECRET_ACCESS_KEY','AWS_SESSION_TOKEN','OPENAI_KEY','ANTHROPIC_KEY','META_KEY','SSH_AUTH_SOCK','GITHUB_TOKEN','GH_TOKEN','ACTIONS_RUNTIME_TOKEN','ACTIONS_ID_TOKEN_REQUEST_TOKEN','ACTIONS_ID_TOKEN_REQUEST_URL','DBUS_SESSION_BUS_ADDRESS','XDG_RUNTIME_DIR','GNOME_KEYRING_CONTROL','GNOME_KEYRING_PID')) {
            Remove-Item -LiteralPath ('Env:' + $entry.Name)
        }
    }
}
function Initialize-RunnerJob {
        Add-Type -TypeDefinition @'
using System;
using System.IO;
using System.Text;
using Microsoft.Win32.SafeHandles;
using System.Runtime.InteropServices;
using System.Threading;
public static class MuseRunnerJob {
  [StructLayout(LayoutKind.Sequential)] struct Startup {
    public uint cb; public IntPtr reserved,desktop,title; public uint x,y,xSize,ySize,xCount,yCount,fill,flags;
    public short show,reservedSize; public IntPtr reserved2,input,output,error;
  }
  [StructLayout(LayoutKind.Sequential)] struct StartupEx { public Startup startup; public IntPtr attributes; }
  [StructLayout(LayoutKind.Sequential)] struct ProcessInfo { public IntPtr process,thread; public uint pid,tid; }
  [StructLayout(LayoutKind.Sequential)] struct BasicLimit { public long processTime,jobTime; public uint flags; public UIntPtr min,max; public uint active; public UIntPtr affinity; public uint priority,scheduling; }
  [StructLayout(LayoutKind.Sequential)] struct Io { public ulong read,write,other,readBytes,writeBytes,otherBytes; }
  [StructLayout(LayoutKind.Sequential)] struct Limits { public BasicLimit basic; public Io io; public UIntPtr processMemory,jobMemory,peakProcess,peakJob; }
  [StructLayout(LayoutKind.Sequential)] struct Accounting { public long user,kernel,periodUser,periodKernel; public uint faults,total,active,terminated; }
  [DllImport("kernel32",CharSet=CharSet.Unicode,SetLastError=true)] static extern IntPtr CreateJobObject(IntPtr attributes,string name);
  [DllImport("kernel32",SetLastError=true)] static extern bool SetInformationJobObject(IntPtr job,int type,ref Limits value,int size);
  [DllImport("kernel32",SetLastError=true)] static extern bool QueryInformationJobObject(IntPtr job,int type,out Accounting value,int size,IntPtr length);
  [DllImport("kernel32",CharSet=CharSet.Unicode,SetLastError=true)] static extern bool CreateProcess(string application,StringBuilder command,IntPtr pa,IntPtr ta,bool inherit,uint flags,IntPtr env,string cwd,ref Startup start,out ProcessInfo process);
  [DllImport("kernel32",EntryPoint="CreateProcessW",CharSet=CharSet.Unicode,SetLastError=true)] static extern bool CreateProcessEx(string application,StringBuilder command,IntPtr pa,IntPtr ta,bool inherit,uint flags,IntPtr env,string cwd,ref StartupEx start,out ProcessInfo process);
  [DllImport("kernel32",SetLastError=true)] static extern bool InitializeProcThreadAttributeList(IntPtr list,int count,int flags,ref IntPtr size);
  [DllImport("kernel32",SetLastError=true)] static extern bool UpdateProcThreadAttribute(IntPtr list,uint flags,IntPtr attribute,IntPtr value,IntPtr size,IntPtr previous,IntPtr returned);
  [DllImport("kernel32")] static extern void DeleteProcThreadAttributeList(IntPtr list);
  [DllImport("kernel32",SetLastError=true)] static extern bool AssignProcessToJobObject(IntPtr job,IntPtr process);
  [DllImport("kernel32")] static extern uint ResumeThread(IntPtr thread);
  [DllImport("kernel32")] static extern uint WaitForSingleObject(IntPtr handle,uint timeout);
  [DllImport("kernel32")] static extern bool GetExitCodeProcess(IntPtr handle,out uint code);
  [DllImport("kernel32")] static extern bool TerminateJobObject(IntPtr handle,uint code);
  [DllImport("kernel32")] static extern bool TerminateProcess(IntPtr handle,uint code);
  [DllImport("kernel32")] static extern bool CloseHandle(IntPtr handle);
  [DllImport("kernel32")] static extern IntPtr GetStdHandle(int handle);
  [DllImport("kernel32")] static extern IntPtr GetCurrentProcess();
  [DllImport("kernel32",SetLastError=true)] static extern bool DuplicateHandle(IntPtr sourceProcess,SafeFileHandle source,IntPtr targetProcess,out IntPtr target,uint access,bool inherit,uint options);
  static IntPtr Inherit(SafeFileHandle source) {
    IntPtr target; if(!DuplicateHandle(GetCurrentProcess(),source,GetCurrentProcess(),out target,0,true,2)) throw new System.ComponentModel.Win32Exception(); return target;
  }
  [DllImport("kernel32",CharSet=CharSet.Unicode,SetLastError=true)] static extern SafeFileHandle CreateFile(string name,uint access,uint share,IntPtr attributes,uint disposition,uint flags,IntPtr template);
  public static void Start(string application,string command,string output) {
    if(command.Length>=32767) throw new InvalidOperationException("runner command line exceeds CreateProcess limit");
    // Direct inheritable file handles: no Start-Process pipe pump dies with SSH.
    using(SafeFileHandle input=CreateFile("NUL",0x80000000,3,IntPtr.Zero,3,0,IntPtr.Zero))
    using(FileStream log=new FileStream(output,FileMode.CreateNew,FileAccess.Write,FileShare.ReadWrite)) {
      if(input.IsInvalid) throw new System.ComponentModel.Win32Exception();
      Startup start=new Startup(); start.cb=(uint)Marshal.SizeOf(start); start.flags=0x100;
      ProcessInfo child=new ProcessInfo(); IntPtr attributes=IntPtr.Zero,handles=IntPtr.Zero; bool attributesReady=false;
      try {
        start.input=Inherit(input); start.output=Inherit(log.SafeFileHandle); start.error=start.output;
        // Only these two handles may survive SSH. Unrelated inheritable SSH pipes must not.
        IntPtr size=IntPtr.Zero;
        InitializeProcThreadAttributeList(IntPtr.Zero,1,0,ref size);
        attributes=Marshal.AllocHGlobal(size);
        if(!InitializeProcThreadAttributeList(attributes,1,0,ref size)) throw new System.ComponentModel.Win32Exception();
        attributesReady=true;
        handles=Marshal.AllocHGlobal(IntPtr.Size*2);
        Marshal.WriteIntPtr(handles,0,start.input); Marshal.WriteIntPtr(handles,IntPtr.Size,start.output);
        if(!UpdateProcThreadAttribute(attributes,0,new IntPtr(0x20002),handles,new IntPtr(IntPtr.Size*2),IntPtr.Zero,IntPtr.Zero)) throw new System.ComponentModel.Win32Exception();
        StartupEx extended=new StartupEx(); extended.startup=start;
        extended.startup.cb=(uint)Marshal.SizeOf(extended); extended.attributes=attributes;
        // If OpenSSH forbids breakaway, fail; the user's scheduled-task wrapper is required.
        // PowerShell needs a console-compatible process even with redirected handles.
        // CREATE_NO_WINDOW keeps it hidden; DETACHED_PROCESS exits before the script runs.
        if(!CreateProcessEx(application,new StringBuilder(command),IntPtr.Zero,IntPtr.Zero,true,0x01000000|0x08000000|0x200|0x4000|0x80000,IntPtr.Zero,null,ref extended,out child)) throw new System.ComponentModel.Win32Exception();
      } finally {
        if(attributesReady) DeleteProcThreadAttributeList(attributes);
        if(attributes!=IntPtr.Zero) Marshal.FreeHGlobal(attributes); if(handles!=IntPtr.Zero) Marshal.FreeHGlobal(handles);
        if(child.thread!=IntPtr.Zero) CloseHandle(child.thread); if(child.process!=IntPtr.Zero) CloseHandle(child.process);
        if(start.input!=IntPtr.Zero) CloseHandle(start.input); if(start.output!=IntPtr.Zero) CloseHandle(start.output);
      }
    }
  }
  public static uint Run(string application,string command,uint timeout) {
    if(command.Length>=32767) throw new InvalidOperationException("runner command line exceeds CreateProcess limit");
    IntPtr job=CreateJobObject(IntPtr.Zero,null); ProcessInfo child=new ProcessInfo();
    if(job==IntPtr.Zero) throw new System.ComponentModel.Win32Exception();
    try {
      Limits limits=new Limits(); limits.basic.flags=0x2000;
      if(!SetInformationJobObject(job,9,ref limits,Marshal.SizeOf(limits))) throw new System.ComponentModel.Win32Exception();
      Startup start=new Startup(); start.cb=(uint)Marshal.SizeOf(start); start.flags=0x100;
      start.input=GetStdHandle(-10); start.output=GetStdHandle(-11); start.error=start.output;
      if(!CreateProcess(application,new StringBuilder(command),IntPtr.Zero,IntPtr.Zero,true,0x4|0x4000,IntPtr.Zero,null,ref start,out child)) throw new System.ComponentModel.Win32Exception();
      if(!AssignProcessToJobObject(job,child.process)) { TerminateProcess(child.process,1); throw new System.ComponentModel.Win32Exception(); }
      if(ResumeThread(child.thread)==0xffffffff) throw new System.ComponentModel.Win32Exception();
      uint wait=WaitForSingleObject(child.process,timeout),code;
      if(wait==258) { if(!TerminateJobObject(job,124)) throw new System.ComponentModel.Win32Exception(); code=124; }
      else if(wait==0 && GetExitCodeProcess(child.process,out code)) { if(!TerminateJobObject(job,code)) throw new System.ComponentModel.Win32Exception(); }
      else throw new System.ComponentModel.Win32Exception();
      for(;;) { Accounting count; if(!QueryInformationJobObject(job,1,out count,Marshal.SizeOf(typeof(Accounting)),IntPtr.Zero)) throw new System.ComponentModel.Win32Exception(); if(count.active==0) break; Thread.Sleep(100); }
      return code;
    } finally { if(child.thread!=IntPtr.Zero) CloseHandle(child.thread); if(child.process!=IntPtr.Zero) CloseHandle(child.process); CloseHandle(job); }
  }
}
'@

}
switch ($Action) {
    'init' {
        & git -c core.hooksPath=NUL init --bare (Join-Path $Root 'repository.git') | Out-Null
        if ($LASTEXITCODE -ne 0) { throw 'git init failed' }
        Write-Protocol @{}; break
    }
    'selftest' {
        Initialize-RunnerJob
        Remove-Credentials
        $run=Get-RunPath ('selftest-' + [Guid]::NewGuid().ToString('N'))
        [IO.Directory]::CreateDirectory($run) | Out-Null
        $done=Join-Path $run 'ready'
        $script="[Console]::In.ReadToEnd()|Out-Null;[IO.File]::WriteAllText('" + $done.Replace("'","''") + "','ready')"
        $encoded=[Convert]::ToBase64String([Text.Encoding]::Unicode.GetBytes($script))
        $application=Join-Path $PSHOME 'powershell.exe'
        $line='"' + $application + '" -NoProfile -NonInteractive -InputFormat None -EncodedCommand ' + $encoded
        [MuseRunnerJob]::Start($application,$line,(Join-Path $run 'output'))
        $deadline=[DateTime]::UtcNow.AddMilliseconds([double]$RunId)
        while (!(Test-Path -LiteralPath $done) -and [DateTime]::UtcNow -lt $deadline) { Start-Sleep -Milliseconds 100 }
        Write-Protocol @{inputReady=(Test-Path -LiteralPath $done)}; break
    }
    'health' {
        $free = 0
        for ($i = 0; $i -lt [int]$RunId; $i++) {
            $file = Join-Path (Join-Path $Root 'slots') $i
            if (!(Test-Path -LiteralPath $file) -or (Test-Path -LiteralPath (Join-Path (Get-RunPath ([IO.File]::ReadAllText($file))) 'exit.json'))) { $free++ }
        }
        $processors = @(Get-CimInstance Win32_Processor)
        $cores = ($processors | Measure-Object NumberOfLogicalProcessors -Sum).Sum
        $load = (($processors | Measure-Object LoadPercentage -Average).Average / 100) * $cores
        Write-Protocol @{ cores=[int]$cores; load=$load; freeSlots=$free; inputReady=$true }; break
    }
    'status' {
        $run = Get-RunPath $RunId
        if (Test-Path -LiteralPath (Join-Path $run 'exit.json')) { [Console]::WriteLine([IO.File]::ReadAllText((Join-Path $run 'exit.json'))) }
        elseif (Test-Path -LiteralPath $run) { Write-Protocol @{runId=$RunId;state='running'} }
        else { Write-Protocol @{runId=$RunId;state='missing'} }; break
    }
    'output' {
        $file = Join-Path (Get-RunPath $RunId) 'output'
        if (Test-Path -LiteralPath $file) {
            $stream=[IO.File]::Open($file,[IO.FileMode]::Open,[IO.FileAccess]::Read,[IO.FileShare]::ReadWrite)
            $bytes=[IO.MemoryStream]::new()
            try { $stream.CopyTo($bytes); Write-Protocol @{bytes=[Convert]::ToBase64String($bytes.ToArray())} }
            finally { $bytes.Dispose(); $stream.Dispose() }
        }
        else { Write-Protocol @{bytes=''} }; break
    }
    'start' {
        # Execute has the longest action name. Check both native stages before claiming a slot.
        $arguments = @('execute',$Root,$RunId,$MaxJobs,$Snapshot,$CacheKey,$Setup,$Command,$Timeout) | ForEach-Object { "'" + $_.Replace("'","''") + "'" }
        $script = "& '" + $PSCommandPath.Replace("'","''") + "' " + ($arguments -join ' ')
        $encoded = [Convert]::ToBase64String([Text.Encoding]::Unicode.GetBytes($script))
        $application=Join-Path $PSHOME 'powershell.exe'
        $line='"' + $application + '" -NoProfile -NonInteractive -InputFormat None -EncodedCommand ' + $encoded
        if ($line.Length -ge 32767) { Write-Protocol @{runId=$RunId;state='refused';reason='commandTooLong'}; break }
        $allocation = Join-Path $Root 'allocate'
        try { $owner = [IO.File]::Open($allocation, [IO.FileMode]::CreateNew, [IO.FileAccess]::Write, [IO.FileShare]::None) }
        catch [IO.IOException] { Write-Protocol @{runId=$RunId;state='busy'}; break }
        try {
            $slot = $null
            for ($i=0; $i -lt [int]$MaxJobs; $i++) {
                $file = Join-Path (Join-Path $Root 'slots') $i
                if (Test-Path -LiteralPath $file) {
                    $old = [IO.File]::ReadAllText($file)
                    if (Test-Path -LiteralPath (Join-Path (Get-RunPath $old) 'exit.json')) { [IO.File]::Delete($file) }
                }
                try {
                    $claim = [IO.File]::Open($file, [IO.FileMode]::CreateNew, [IO.FileAccess]::Write, [IO.FileShare]::None)
                    try { $bytes=[Text.Encoding]::UTF8.GetBytes($RunId); $claim.Write($bytes,0,$bytes.Length) } finally { $claim.Dispose() }
                    $slot=$i; break
                } catch [IO.IOException] { continue }
            }
            if ($null -eq $slot) { Write-Protocol @{runId=$RunId;state='busy'}; break }
            $run = Get-RunPath $RunId
            if (Test-Path -LiteralPath $run) { throw 'duplicate run id' }
            [IO.Directory]::CreateDirectory($run) | Out-Null
            $arguments = @('job',$Root,$RunId,$MaxJobs,$Snapshot,$CacheKey,$Setup,$Command,$Timeout) | ForEach-Object { "'" + $_.Replace("'","''") + "'" }
            $script = "& '" + $PSCommandPath.Replace("'","''") + "' " + ($arguments -join ' ')
            $encoded = [Convert]::ToBase64String([Text.Encoding]::Unicode.GetBytes($script))
            Initialize-RunnerJob
            Remove-Credentials
            $application=Join-Path $PSHOME 'powershell.exe'
            $line='"' + $application + '" -NoProfile -NonInteractive -InputFormat None -EncodedCommand ' + $encoded
            [MuseRunnerJob]::Start($application,$line,(Join-Path $run 'output'))
            Write-Protocol @{runId=$RunId;state='running'}
        } finally { $owner.Dispose(); [IO.File]::Delete($allocation) }; break
    }
    'job' {
        Remove-Credentials
        $env:GIT_CONFIG_GLOBAL='NUL'; $env:GIT_CONFIG_SYSTEM='NUL'
        $run=Get-RunPath $RunId
        $cache=Join-Path (Join-Path $Root 'cache') $CacheKey
        $creation=$null
        # The supervisor owns the lease; terminating setup cannot interrupt its owner record.
        if (!(Test-Path -LiteralPath (Join-Path $cache 'ready'))) {
            try { $creation=[IO.File]::Open(($cache+'.creating'),[IO.FileMode]::CreateNew,[IO.FileAccess]::Write,[IO.FileShare]::Read) }
            catch [IO.IOException] {
                [IO.File]::WriteAllText((Join-Path $run 'cache-busy'),'')
                [IO.File]::WriteAllText((Join-Path $run 'exit.new'),(ConvertTo-Json -Compress @{runId=$RunId;state='ended';exitCode=75;reason='cacheBusy'}))
                Move-Item -LiteralPath (Join-Path $run 'exit.new') -Destination (Join-Path $run 'exit.json'); break
            }
            $expires=[DateTimeOffset]::UtcNow.ToUnixTimeSeconds()+[int]$Timeout
            $ownerBytes=[Text.Encoding]::UTF8.GetBytes($RunId+' '+$expires)
            try { $creation.Write($ownerBytes,0,$ownerBytes.Length); $creation.Flush() }
            finally { $creation.Dispose() }
        }
        # Suspended creation, no breakaway, kill-on-close, then active-count retirement.
        Initialize-RunnerJob
        $arguments=@('execute',$Root,$RunId,$MaxJobs,$Snapshot,$CacheKey,$Setup,$Command,$Timeout) | ForEach-Object { "'" + $_.Replace("'","''") + "'" }
        $script="& '" + $PSCommandPath.Replace("'","''") + "' " + ($arguments -join ' ')
        $encoded=[Convert]::ToBase64String([Text.Encoding]::Unicode.GetBytes($script))
        $application=Join-Path $PSHOME 'powershell.exe'
        $line='"' + $application + '" -NoProfile -NonInteractive -InputFormat None -EncodedCommand ' + $encoded
        $code=[MuseRunnerJob]::Run($application,$line,([uint32]$Timeout * 1000))
        $run=Get-RunPath $RunId
        Remove-CacheLock (Join-Path (Join-Path $Root 'cache') $CacheKey) $RunId
        $result=@{runId=$RunId;state='ended';exitCode=[int]$code}
        if (Test-Path -LiteralPath (Join-Path $run 'cache-busy')) { $result.reason='cacheBusy' }
        [IO.File]::WriteAllText((Join-Path $run 'exit.new'),(ConvertTo-Json -Compress $result))
        Move-Item -LiteralPath (Join-Path $run 'exit.new') -Destination (Join-Path $run 'exit.json'); break
    }
    'execute' {
        $run=Get-RunPath $RunId; $copy=Join-Path $run 'copy'
        & git -c core.hooksPath=NUL clone --shared --no-checkout (Join-Path $Root 'repository.git') $copy
        if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
        & git -C $copy -c core.hooksPath=NUL checkout --force --detach $Snapshot
        if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
        & git -C $copy remote remove origin
        & git -C $copy clean -ffdx
        Set-Location -LiteralPath $copy
        $cache=Join-Path (Join-Path $Root 'cache') $CacheKey
        if (!(Test-Path -LiteralPath (Join-Path $cache 'ready'))) {
            if (!(Test-Path -LiteralPath ($cache+'.creating')) -or ![IO.File]::ReadAllText(($cache+'.creating')).StartsWith($RunId+' ')) { exit 1 }
            if (Test-Path -LiteralPath $cache) { Remove-Item -Recurse -Force -LiteralPath $cache }
            $setupFile=Join-Path $run 'setup.ps1'; [IO.File]::WriteAllText($setupFile,[Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($Setup)),[Text.UTF8Encoding]::new($true))
            & powershell.exe -NoProfile -NonInteractive -InputFormat None -File $setupFile
            if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
            [IO.Directory]::CreateDirectory($cache) | Out-Null
            $install=Join-Path $cache 'install'; [IO.Directory]::CreateDirectory($install) | Out-Null
            $files=& git -c core.quotePath=false ls-files --others --directory
            if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
            foreach ($entry in $files) {
                $target=Join-Path $install $entry
                [IO.Directory]::CreateDirectory((Split-Path -Parent $target)) | Out-Null
                Copy-Item -Recurse -LiteralPath (Join-Path $copy $entry) -Destination $target
            }
            [IO.File]::WriteAllText((Join-Path $cache 'ready'),'')
        } else { Get-ChildItem -Force -LiteralPath (Join-Path $cache 'install') | ForEach-Object { Copy-Item -Recurse -LiteralPath $_.FullName -Destination $copy } }
        $commandFile=Join-Path $run 'command.ps1'; [IO.File]::WriteAllText($commandFile,[Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($Command)),[Text.UTF8Encoding]::new($true))
        & powershell.exe -NoProfile -NonInteractive -InputFormat None -File $commandFile
        exit $LASTEXITCODE
    }
}
