# Muse Spark Code: voice dictation helper for Windows.
#
# Recognises speech with the recogniser that ships with Windows (System.Speech,
# the desktop SAPI engine, through the .NET Framework that Windows PowerShell
# 5.1 runs on). Nothing is installed, nothing leaves the machine, nothing is
# billed. Audio is captured from the default recording device by the engine
# itself.
#
# Runs as a resident child of the extension host. Commands arrive on stdin,
# one per line; results leave on stdout, one JSON object per line:
#
#   stdin  "start"  begin listening        stdout  {"type":"ready","language":"en-US","recognizer":"..."}
#   stdin  "stop"   finish the phrase       stdout  {"type":"listening"}
#   stdin  "quit"   exit (EOF does too)     stdout  {"type":"text","text":"...","confidence":0.93}
#                                           stdout  {"type":"stopped"}
#                                           stdout  {"type":"error","reason":"..."}   (then exits 2)
#
# Nothing is written to stderr on the success path; the host logs stderr as a
# diagnostic when the helper dies.

[CmdletBinding()]
param(
  # Diagnostics: recognise this WAV file instead of the microphone. The unit
  # test drives the command loop with a synthesised recording; a user can
  # replay a known file to tell a recogniser problem from a microphone one.
  [string] $InputWav = ''
)

$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

$RecognizedEvent = 'MuseDictation.SpeechRecognized'
$CompletedEvent = 'MuseDictation.RecognizeCompleted'
$PollIntervalMs = 40
$StdinBufferBytes = 256
$ExitCodeUnavailable = 2

function Send-Line([hashtable] $Payload) {
  [Console]::Out.WriteLine((ConvertTo-Json -InputObject $Payload -Compress))
  [Console]::Out.Flush()
}

function Get-FailureReason([System.Management.Automation.ErrorRecord] $Record) {
  $exception = $Record.Exception
  while ($null -ne $exception.InnerException) {
    $exception = $exception.InnerException
  }
  return $exception.Message
}

# The recogniser for the user's display language when one is installed,
# otherwise the current locale's, otherwise the first one Windows has.
function Select-Recognizer {
  $installed = @([System.Speech.Recognition.SpeechRecognitionEngine]::InstalledRecognizers())
  if ($installed.Count -eq 0) {
    return $null
  }
  foreach ($culture in @([System.Globalization.CultureInfo]::CurrentUICulture, [System.Globalization.CultureInfo]::CurrentCulture)) {
    $match = $installed | Where-Object { $_.Culture.Name -eq $culture.Name } | Select-Object -First 1
    if ($null -ne $match) {
      return $match
    }
  }
  return $installed[0]
}

try {
  Add-Type -AssemblyName System.Speech
} catch {
  Send-Line @{ type = 'error'; reason = "Windows speech recognition (System.Speech) is not available: $(Get-FailureReason $_)" }
  exit $ExitCodeUnavailable
}

$recognizerInfo = Select-Recognizer
if ($null -eq $recognizerInfo) {
  Send-Line @{ type = 'error'; reason = 'No Windows speech recogniser is installed. Add a speech language pack in Settings > Time & language > Language & region.' }
  exit $ExitCodeUnavailable
}

$engine = New-Object System.Speech.Recognition.SpeechRecognitionEngine($recognizerInfo)
try {
  $engine.LoadGrammar((New-Object System.Speech.Recognition.DictationGrammar))
  if ($InputWav -ne '') {
    $engine.SetInputToWaveFile($InputWav)
  } else {
    $engine.SetInputToDefaultAudioDevice()
  }
} catch {
  Send-Line @{ type = 'error'; reason = "No microphone is available to Windows speech recognition: $(Get-FailureReason $_)" }
  $engine.Dispose()
  exit $ExitCodeUnavailable
}

Register-ObjectEvent -InputObject $engine -EventName SpeechRecognized -SourceIdentifier $RecognizedEvent | Out-Null
Register-ObjectEvent -InputObject $engine -EventName RecognizeCompleted -SourceIdentifier $CompletedEvent | Out-Null

$stdin = [Console]::OpenStandardInput()
$buffer = New-Object byte[] $StdinBufferBytes
$pendingInput = ''
$state = 'idle'
$isStartQueued = $false
$isQuitting = $false

function Enter-Listening {
  $script:engine.RecognizeAsync([System.Speech.Recognition.RecognizeMode]::Multiple)
  $script:state = 'listening'
  Send-Line @{ type = 'listening' }
}

function Invoke-HostCommand([string] $Command) {
  switch ($Command) {
    'start' {
      if ($script:state -eq 'idle') {
        Enter-Listening
      } elseif ($script:state -eq 'stopping') {
        $script:isStartQueued = $true
      }
    }
    'stop' {
      if ($script:state -eq 'listening') {
        $script:state = 'stopping'
        # Keeps the audio already captured: the phrase in flight is still
        # recognised, then RecognizeCompleted fires.
        $script:engine.RecognizeAsyncStop()
      }
      $script:isStartQueued = $false
    }
    'quit' {
      $script:isQuitting = $true
    }
  }
}

function Receive-EngineEvent {
  foreach ($queued in @(Get-Event)) {
    Remove-Event -EventIdentifier $queued.EventIdentifier
    switch ($queued.SourceIdentifier) {
      'MuseDictation.SpeechRecognized' {
        $result = $queued.SourceEventArgs.Result
        if ($null -ne $result -and $result.Text -ne '') {
          Send-Line @{ type = 'text'; text = $result.Text; confidence = [Math]::Round($result.Confidence, 3) }
        }
      }
      'MuseDictation.RecognizeCompleted' {
        $script:state = 'idle'
        $completion = $queued.SourceEventArgs
        if ($null -ne $completion.Error) {
          Send-Line @{ type = 'error'; reason = "Speech recognition stopped: $($completion.Error.Message)" }
          $script:isQuitting = $true
          return
        }
        Send-Line @{ type = 'stopped' }
        if ($script:isStartQueued) {
          $script:isStartQueued = $false
          Enter-Listening
        }
      }
    }
  }
}

try {
  Send-Line @{ type = 'ready'; language = $recognizerInfo.Culture.Name; recognizer = $recognizerInfo.Name }
  $read = $stdin.ReadAsync($buffer, 0, $buffer.Length)
  while (-not $isQuitting) {
    Receive-EngineEvent
    if ($isQuitting) {
      break
    }
    if ($read.IsCompleted) {
      $count = $read.Result
      if ($count -eq 0) {
        # EOF: the host went away.
        break
      }
      $pendingInput += [System.Text.Encoding]::UTF8.GetString($buffer, 0, $count)
      while ($pendingInput.Contains("`n")) {
        $newline = $pendingInput.IndexOf("`n")
        $line = $pendingInput.Substring(0, $newline).Trim()
        $pendingInput = $pendingInput.Substring($newline + 1)
        Invoke-HostCommand $line
      }
      $read = $stdin.ReadAsync($buffer, 0, $buffer.Length)
    }
    Start-Sleep -Milliseconds $PollIntervalMs
  }
} finally {
  if ($state -ne 'idle') {
    $engine.RecognizeAsyncCancel()
  }
  Unregister-Event -SourceIdentifier $RecognizedEvent -ErrorAction SilentlyContinue
  Unregister-Event -SourceIdentifier $CompletedEvent -ErrorAction SilentlyContinue
  $engine.Dispose()
}
