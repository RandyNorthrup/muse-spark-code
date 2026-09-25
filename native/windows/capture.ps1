# Muse Spark Code: microphone capture helper for Windows (Muse Voice, M35).
#
# Records the default recording device through the waveIn API that ships
# with Windows (winmm.dll, reached through a small C# type that Windows
# PowerShell compiles once when the helper starts) and hands the audio to
# the extension host, which streams it to Meta's Muse Voice Transcribe with
# the user's Model API key. This helper only records: it recognises nothing,
# sends nothing anywhere, and records only between "start" and "stop".
#
# Runs as a resident child of the extension host, with the same line
# protocol as dictate.ps1 plus the audio lines. Commands arrive on stdin, one
# per line; everything leaves on stdout, one JSON object per line:
#
#   stdin  "start"  begin recording        stdout  {"type":"ready","language":"pcm_s16le","recognizer":"capture 16000 Hz mono"}
#   stdin  "stop"   end the recording       stdout  {"type":"listening"}
#   stdin  "quit"   exit (EOF does too)     stdout  {"type":"audio","data":"<base64>"}   (16-bit little-endian PCM, mono, 16 kHz, about 100 ms each)
#                                           stdout  {"type":"stopped"}   (after the last audio line)
#                                           stdout  {"type":"error","reason":"..."}   (then exits 2)
#
# Nothing is written to stderr on the success path; the host logs stderr as a
# diagnostic when the helper dies.

[CmdletBinding()]
param(
  # Diagnostics and tests: replay this 16 kHz 16-bit mono WAV file as the
  # recording instead of the microphone, so the protocol can be checked on a
  # machine without one.
  [string] $InputWav = ''
)

$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

$PollIntervalMs = 40
$StdinBufferBytes = 256
$ExitCodeUnavailable = 2
$SampleRate = 16000
# A RIFF WAV file's PCM data starts after its 44-byte header (the format
# the test synthesises writes no other chunks).
$WavHeaderBytes = 44
$ReplayChunkBytes = 3200

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

# C# 5, which Windows PowerShell 5.1's Add-Type compiles. The buffers live in
# unmanaged memory because the driver fills them after the calls return; they
# are polled for the done flag (no callback into managed code) and handed
# back to the driver in the order they were queued, which is the order the
# driver fills them.
$Source = @'
using System;
using System.Collections.Generic;
using System.IO;
using System.Runtime.InteropServices;

public sealed class MuseSparkCapture {
  [StructLayout(LayoutKind.Sequential)]
  struct WaveFormat {
    public ushort Tag;
    public ushort Channels;
    public uint SamplesPerSecond;
    public uint BytesPerSecond;
    public ushort BlockAlign;
    public ushort BitsPerSample;
    public ushort ExtraSize;
  }

  [StructLayout(LayoutKind.Sequential)]
  struct WaveHeader {
    public IntPtr Data;
    public uint BufferLength;
    public uint BytesRecorded;
    public IntPtr User;
    public uint Flags;
    public uint Loops;
    public IntPtr Next;
    public IntPtr Reserved;
  }

  [DllImport("winmm.dll")]
  static extern uint waveInGetNumDevs();
  [DllImport("winmm.dll")]
  static extern uint waveInOpen(out IntPtr handle, uint device, ref WaveFormat format, IntPtr callback, IntPtr instance, uint flags);
  [DllImport("winmm.dll")]
  static extern uint waveInPrepareHeader(IntPtr handle, IntPtr header, uint size);
  [DllImport("winmm.dll")]
  static extern uint waveInUnprepareHeader(IntPtr handle, IntPtr header, uint size);
  [DllImport("winmm.dll")]
  static extern uint waveInAddBuffer(IntPtr handle, IntPtr header, uint size);
  [DllImport("winmm.dll")]
  static extern uint waveInStart(IntPtr handle);
  [DllImport("winmm.dll")]
  static extern uint waveInReset(IntPtr handle);
  [DllImport("winmm.dll")]
  static extern uint waveInClose(IntPtr handle);

  const uint WaveMapper = 0xFFFFFFFF;
  const uint CallbackNull = 0;
  const uint HeaderDone = 1;
  const ushort PcmTag = 1;
  const int BufferCount = 8;

  readonly uint sampleRate;
  readonly uint bufferBytes;
  readonly uint headerSize = (uint)Marshal.SizeOf(typeof(WaveHeader));
  IntPtr handle = IntPtr.Zero;
  readonly List<IntPtr> headers = new List<IntPtr>();
  int next;

  public MuseSparkCapture(uint sampleRate, uint bufferMilliseconds) {
    this.sampleRate = sampleRate;
    bufferBytes = sampleRate * 2 * bufferMilliseconds / 1000;
  }

  public static uint DeviceCount() {
    return waveInGetNumDevs();
  }

  static void Check(uint result, string call) {
    if (result != 0) {
      throw new InvalidOperationException(call + " failed with MMSYSERR " + result);
    }
  }

  public void Start() {
    WaveFormat format = new WaveFormat();
    format.Tag = PcmTag;
    format.Channels = 1;
    format.SamplesPerSecond = sampleRate;
    format.BitsPerSample = 16;
    format.BlockAlign = 2;
    format.BytesPerSecond = sampleRate * 2;
    Check(waveInOpen(out handle, WaveMapper, ref format, IntPtr.Zero, IntPtr.Zero, CallbackNull), "waveInOpen");
    for (int index = 0; index < BufferCount; index++) {
      WaveHeader header = new WaveHeader();
      header.Data = Marshal.AllocHGlobal((int)bufferBytes);
      header.BufferLength = bufferBytes;
      IntPtr pointer = Marshal.AllocHGlobal((int)headerSize);
      Marshal.StructureToPtr(header, pointer, false);
      headers.Add(pointer);
      Check(waveInPrepareHeader(handle, pointer, headerSize), "waveInPrepareHeader");
      Check(waveInAddBuffer(handle, pointer, headerSize), "waveInAddBuffer");
    }
    next = 0;
    Check(waveInStart(handle), "waveInStart");
  }

  /** The audio recorded since the last call, in order; the buffers go back to the driver. */
  public byte[] Read() {
    return Collect(true);
  }

  /** Ends the recording: what the driver still held, then everything released. */
  public byte[] Stop() {
    if (handle == IntPtr.Zero) {
      return new byte[0];
    }
    // Reset marks every queued buffer done, the partly filled one included.
    waveInReset(handle);
    byte[] rest = Collect(false);
    foreach (IntPtr pointer in headers) {
      WaveHeader header = (WaveHeader)Marshal.PtrToStructure(pointer, typeof(WaveHeader));
      waveInUnprepareHeader(handle, pointer, headerSize);
      Marshal.FreeHGlobal(header.Data);
      Marshal.FreeHGlobal(pointer);
    }
    headers.Clear();
    waveInClose(handle);
    handle = IntPtr.Zero;
    return rest;
  }

  byte[] Collect(bool requeue) {
    MemoryStream output = new MemoryStream();
    for (int seen = 0; seen < headers.Count; seen++) {
      IntPtr pointer = headers[next];
      WaveHeader header = (WaveHeader)Marshal.PtrToStructure(pointer, typeof(WaveHeader));
      if ((header.Flags & HeaderDone) == 0) {
        break;
      }
      if (header.BytesRecorded > 0) {
        byte[] chunk = new byte[header.BytesRecorded];
        Marshal.Copy(header.Data, chunk, 0, (int)header.BytesRecorded);
        output.Write(chunk, 0, chunk.Length);
      }
      if (requeue) {
        header.Flags = header.Flags & ~HeaderDone;
        header.BytesRecorded = 0;
        Marshal.StructureToPtr(header, pointer, false);
        Check(waveInAddBuffer(handle, pointer, headerSize), "waveInAddBuffer");
      }
      next = (next + 1) % headers.Count;
    }
    return output.ToArray();
  }
}
'@

try {
  Add-Type -TypeDefinition $Source -Language CSharp
} catch {
  Send-Line @{ type = 'error'; reason = "The microphone recorder could not be prepared (Windows PowerShell could not compile it; Constrained Language Mode forbids that): $(Get-FailureReason $_)" }
  exit $ExitCodeUnavailable
}

if ($InputWav -eq '' -and [MuseSparkCapture]::DeviceCount() -eq 0) {
  Send-Line @{ type = 'error'; reason = 'No microphone is connected: Windows lists no recording device.' }
  exit $ExitCodeUnavailable
}

$capture = New-Object MuseSparkCapture ([uint32] $SampleRate), ([uint32] 100)
$replay = $null
$replayOffset = 0
$stdin = [Console]::OpenStandardInput()
$buffer = New-Object byte[] $StdinBufferBytes
$pendingInput = ''
$state = 'idle'
$isQuitting = $false

function Send-Audio([byte[]] $Bytes) {
  if ($null -ne $Bytes -and $Bytes.Length -gt 0) {
    Send-Line @{ type = 'audio'; data = [Convert]::ToBase64String($Bytes) }
  }
}

function Enter-Recording {
  if ($InputWav -ne '') {
    $script:replay = [System.IO.File]::ReadAllBytes($InputWav)
    $script:replayOffset = $WavHeaderBytes
  } else {
    $script:capture.Start()
  }
  $script:state = 'listening'
  Send-Line @{ type = 'listening' }
}

function Read-Recording {
  if ($null -ne $script:replay) {
    $count = [Math]::Min($ReplayChunkBytes, $script:replay.Length - $script:replayOffset)
    if ($count -le 0) {
      return [byte[]] @()
    }
    $chunk = New-Object byte[] $count
    [Array]::Copy($script:replay, $script:replayOffset, $chunk, 0, $count)
    $script:replayOffset += $count
    return $chunk
  }
  return $script:capture.Read()
}

function Exit-Recording {
  if ($null -ne $script:replay) {
    $script:replay = $null
  } else {
    Send-Audio ($script:capture.Stop())
  }
  $script:state = 'idle'
  Send-Line @{ type = 'stopped' }
}

function Invoke-HostCommand([string] $Command) {
  switch ($Command) {
    'start' {
      if ($script:state -eq 'idle') {
        Enter-Recording
      }
    }
    'stop' {
      if ($script:state -eq 'listening') {
        Send-Audio (Read-Recording)
        Exit-Recording
      }
    }
    'quit' {
      $script:isQuitting = $true
    }
  }
}

try {
  Send-Line @{ type = 'ready'; language = 'pcm_s16le'; recognizer = "capture $SampleRate Hz mono" }
  $read = $stdin.ReadAsync($buffer, 0, $buffer.Length)
  while (-not $isQuitting) {
    if ($state -eq 'listening') {
      Send-Audio (Read-Recording)
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
} catch {
  Send-Line @{ type = 'error'; reason = "The microphone stopped: $(Get-FailureReason $_)" }
  exit $ExitCodeUnavailable
} finally {
  if ($state -eq 'listening' -and $null -eq $replay) {
    [void] $capture.Stop()
  }
}
