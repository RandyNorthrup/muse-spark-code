param([Parameter(Mandatory=$true)][string]$Folder)
$nativeSource = @"
using System; using System.Runtime.InteropServices; using Microsoft.Win32.SafeHandles; using System.Text;
public static class SecPathOracle {
 [DllImport("kernel32.dll", CharSet=CharSet.Unicode, SetLastError=true)] static extern SafeFileHandle CreateFileW(string name,uint access,uint share,IntPtr security,uint creation,uint flags,IntPtr template);
 [DllImport("kernel32.dll",SetLastError=true)] static extern bool GetFileInformationByHandle(SafeFileHandle handle,out Info info);
 [DllImport("kernel32.dll",CharSet=CharSet.Unicode,SetLastError=true)] static extern uint GetFullPathNameW(string name,uint size,StringBuilder buffer,IntPtr part);
 [StructLayout(LayoutKind.Sequential)] struct Info {public uint attributes,creationLow,creationHigh,accessLow,accessHigh,writeLow,writeHigh,volume,sizeHigh,sizeLow,links,indexHigh,indexLow;}
 public static string Check(string name) {
  var full=new StringBuilder(32768);
  if(GetFullPathNameW(name,32768,full,IntPtr.Zero)==0)throw new Exception("GetFullPathNameW failed");
  using(var handle=CreateFileW(full.ToString(),0,7,IntPtr.Zero,3,0x02000000,IntPtr.Zero)) {
   if(handle.IsInvalid)return "error="+Marshal.GetLastWin32Error();
   Info info;if(!GetFileInformationByHandle(handle,out info))throw new Exception("Identity read failed");
   return info.volume+":"+(((ulong)info.indexHigh<<32)|info.indexLow);
  }
 }
}
"@
Add-Type -TypeDefinition $nativeSource
$nativeFile = Join-Path $Folder 'AGENTS.md'
foreach ($nativePath in @(($nativeFile),($nativeFile+'.'),($nativeFile+' '),($nativeFile+'::$DATA'))) {
    [SecPathOracle]::Check($nativePath)
}
$nativeSettings = Join-Path $Folder '.claude/settings.json'
[SecPathOracle]::Check($nativeSettings)
[SecPathOracle]::Check((Join-Path $Folder '.claude./settings.json'))
[SecPathOracle]::Check((Join-Path $Folder '.claude /settings.json'))
