# Fake-only regression for the actual C# guard, read loop and handle-based listing.
# Replace only Windows OS primitives/path joining and FileStream with managed fakes.
$ErrorActionPreference = 'Stop'
$sourcePath = Join-Path $PSScriptRoot '../../../src/core/maker/detect/projectIoWindows.ts'
$text = [IO.File]::ReadAllText($sourcePath)
$match = [regex]::Match($text, '(?s)const NATIVE_SOURCE = String.raw`(.*?)`')
if (-not $match.Success) { throw 'Missing native source' }
$source = $match.Groups[1].Value
$replacements = @{
  CreateFile = 'static SafeFileHandle CreateFile(string path, uint access, uint share, IntPtr security, uint creation, uint flags, IntPtr template) { return FakeOpen(path, share, flags); }'
  GetFinalPathNameByHandle = 'static uint GetFinalPathNameByHandle(SafeFileHandle file, StringBuilder path, uint length, uint flags) { path.Append(FakeNames[file]); return (uint)path.Length; }'
  GetFileInformationByHandle = 'static bool GetFileInformationByHandle(SafeFileHandle file, out Information info) { info = new Information(); info.Attributes = FakeNames[file].EndsWith(".py") ? 0 : DirectoryAttribute; return true; }'
  GetFileType = 'static uint GetFileType(SafeFileHandle file) { return DiskFileType; }'
  NtQueryDirectoryFile = 'static int NtQueryDirectoryFile(SafeFileHandle file, IntPtr e, IntPtr a, IntPtr c, ref IoStatus status, IntPtr buffer, uint length, uint informationClass, bool single, IntPtr name, bool restart) { return FakeQuery(file, ref status, buffer); }'
}
foreach ($entry in $replacements.GetEnumerator()) {
  $pattern = '(?s)\[DllImport\([^\]]+\)\]\s*static extern [^;]*\b' + $entry.Key + '\([^;]+;'
  if ([regex]::Matches($source, $pattern).Count -ne 1) { throw "Missing primitive $($entry.Key)" }
  $source = [regex]::Replace($source, $pattern, $entry.Value)
}
$source = $source.Replace('Path.Combine(', 'FakeCombine(').Replace('new FileStream(', 'new FakeStream(')
$fakes = @'
  public static int Scenario, FakeReads, OutsideQueries;
  public static bool DidSwap;
  static Dictionary<SafeFileHandle,string> FakeNames = new Dictionary<SafeFileHandle,string>();
  static HashSet<SafeFileHandle> Queried = new HashSet<SafeFileHandle>();
  const string RootName = @"\\?\E:\ws";
  static string FakeCombine(string first, string second) { return (first == "" ? "" : first.TrimEnd('\\') + "\\") + second.Replace('/', '\\'); }
  public static void Reset(int scenario) { Scenario = scenario; FakeReads = 0; OutsideQueries = 0; DidSwap = false; FakeNames.Clear(); Queried.Clear(); }
  static SafeFileHandle FakeOpen(string name, uint share, uint flags) {
    if (share != ShareReadWrite || (flags & BackupSemantics) == 0) throw new Exception("root must deny share-delete");
    string canonical = name == @"E:\ws" ? RootName : name;
    if ((Scenario == 1 && name.EndsWith(@"\sub\main.py")) || ((Scenario == 2 || DidSwap) && name.EndsWith(@"\sub\nested"))) {
      canonical = canonical.Replace(@"\ws\sub", @"\outside"); DidSwap = true;
    }
    if (Scenario == 4 && name.EndsWith(".py")) { canonical = canonical.Replace(@"\ws", @"\WS"); DidSwap = true; }
    var handle = new SafeFileHandle(new IntPtr(100 + FakeNames.Count), false); FakeNames[handle] = canonical; return handle;
  }
  sealed class FakeStream : MemoryStream {
    public FakeStream(SafeFileHandle file, FileAccess access, int size, bool async) : base(Encoding.UTF8.GetBytes(FakeNames[file].Contains(@"\outside") ? "outside" : "inside")) {}
    public override int Read(byte[] bytes, int offset, int count) { FakeReads++; return base.Read(bytes, offset, count); }
  }
  static int FakeQuery(SafeFileHandle file, ref IoStatus status, IntPtr buffer) {
    if (!Queried.Add(file)) return NoMoreFiles;
    var canonical = FakeNames[file]; string entry; uint attributes;
    if (canonical.Contains(@"\outside")) { OutsideQueries++; entry = "outside.scad"; attributes = 0; }
    else if (canonical == RootName) { entry = "sub"; attributes = DirectoryAttribute; }
    else if (canonical.EndsWith(@"\sub")) { entry = "nested"; attributes = DirectoryAttribute; }
    else { if (Scenario == 3) DidSwap = true; entry = "inside.scad"; attributes = 0; }
    var bytes = Encoding.Unicode.GetBytes(entry);
    Marshal.WriteInt32(buffer, AttributesOffset, (int)attributes); Marshal.WriteInt32(buffer, NameLengthOffset, bytes.Length);
    Marshal.Copy(bytes, 0, IntPtr.Add(buffer, NameOffset), bytes.Length); status.Bytes = new IntPtr(NameOffset + bytes.Length); return 0;
  }
'@
$end = $source.LastIndexOf('}')
$source = $source.Insert($end, $fakes)
Add-Type -TypeDefinition $source

[MuseProjectIo]::Reset(0)
if ([MuseProjectIo]::Read('E:\ws', 'sub/main.py', 100) -ne [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes('inside'))) { throw 'unchanged regular-file read' }
[MuseProjectIo]::Reset(1)
if ($null -ne [MuseProjectIo]::Read('E:\ws', 'sub/main.py', 100) -or [MuseProjectIo]::FakeReads -ne 0 -or -not [MuseProjectIo]::DidSwap) { throw 'refuses Windows bytes after an ancestor swap before file open' }
Write-Output 'PASS refuses Windows bytes after an ancestor swap before file open'
[MuseProjectIo]::Reset(2)
$names = [MuseProjectIo]::Files('E:\ws', 100, 2)
if ($names.Count -ne 0 -or [MuseProjectIo]::OutsideQueries -ne 0 -or -not [MuseProjectIo]::DidSwap) { throw 'refuses Windows names after an ancestor swap before directory open' }
Write-Output 'PASS refuses Windows names after an ancestor swap before directory open'
[MuseProjectIo]::Reset(3)
$names = [MuseProjectIo]::Files('E:\ws', 100, 2)
if ($names.Count -ne 1 -or $names[0] -ne 'sub/nested/inside.scad' -or [MuseProjectIo]::OutsideQueries -ne 0 -or -not [MuseProjectIo]::DidSwap) { throw 'lists the checked Windows directory handle after an ancestor swap' }
Write-Output 'PASS lists the checked Windows directory handle after an ancestor swap'

[MuseProjectIo]::Reset(4)
if ($null -ne [MuseProjectIo]::Read('E:\ws', 'sub/main.py', 100) -or [MuseProjectIo]::FakeReads -ne 0 -or -not [MuseProjectIo]::DidSwap) { throw 'refuses Windows case-sensitive sibling roots' }
Write-Output 'PASS refuses Windows case-sensitive sibling roots'
