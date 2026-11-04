# Some hosted Windows runners start processes far slower than others (PowerShell 7 to 26 s cold,
# against about 3 s). This prints whether that is a first read or lasts, and what else the runner is
# doing. It proves nothing about the product, and the steps that run it cannot fail a job.
param([Parameter(Mandatory)][string]$When)

"== $When, image $env:ImageVersion"
$commands = @(
  @{ Name = 'powershell'; File = 'powershell.exe'; Arguments = @('-NoProfile', '-Command', 'exit 0') },
  @{ Name = 'pwsh'; File = 'pwsh.exe'; Arguments = @('-NoProfile', '-Command', 'exit 0') },
  @{ Name = 'cmd'; File = 'cmd.exe'; Arguments = @('/c', 'exit 0') },
  @{ Name = 'git'; File = 'git.exe'; Arguments = @('--version') },
  @{ Name = 'node'; File = 'node.exe'; Arguments = @('--version') }
)
foreach ($command in $commands) {
  $times = 1..3 | ForEach-Object {
    [int](Measure-Command { & $command.File @($command.Arguments) *> $null }).TotalMilliseconds
  }
  "$($command.Name): $($times -join ', ') ms"
}
$processor = Get-CimInstance Win32_Processor
"cpu: $($processor.NumberOfLogicalProcessors) logical, load $($processor.LoadPercentage)%"
$system = Get-CimInstance Win32_OperatingSystem
"memory free: $([int]($system.FreePhysicalMemory / 1024)) MB of $([int]($system.TotalVisibleMemorySize / 1024)) MB"
$defender = Get-MpComputerStatus
"defender: realtime $($defender.RealTimeProtectionEnabled), behavior $($defender.BehaviorMonitorEnabled), mode $($defender.AMRunningMode)"
"defender exclusions: $((Get-MpPreference).ExclusionPath -join ', ')"
Get-Process |
  Sort-Object CPU -Descending |
  Select-Object -First 8 |
  ForEach-Object { "$($_.Name): cpu $([int]$_.CPU) s, memory $([int]($_.WorkingSet64 / 1MB)) MB" }
