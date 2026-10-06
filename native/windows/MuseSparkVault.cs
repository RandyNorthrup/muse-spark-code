// M109 P: one bounded binary request per process; no secret in argv/env/files.
// Compiled with Windows' .NET Framework compiler, not PowerShell/Add-Type.
namespace MuseSparkVaultNative
{
using System;
using System.Collections.Generic;
using System.IO;
using System.Runtime.InteropServices;
using System.Security.Cryptography;
using System.Text;
using System.Web.Script.Serialization;

internal static class MuseSparkVault
{
    private const uint System32Search = 0x800;
    [DefaultDllImportSearchPaths(DllImportSearchPath.System32)]
    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern bool SetDefaultDllDirectories(uint flags);
    internal const int Version = 1, KeyBytes = 32, HeaderLimit = 4096;
    internal static readonly JavaScriptSerializer Json = new JavaScriptSerializer { MaxJsonLength = HeaderLimit };

    internal static Dictionary<string, object> Object(object value)
    {
        var result = value as Dictionary<string, object>;
        if (result == null) throw new InvalidDataException();
        return result;
    }
    internal static void Fields(Dictionary<string, object> value, params string[] names)
    {
        if (value.Count != names.Length) throw new InvalidDataException();
        foreach (var name in names) if (!value.ContainsKey(name)) throw new InvalidDataException();
    }
    internal static string Text(Dictionary<string, object> value, string name)
    {
        var text = value[name] as string;
        if (String.IsNullOrEmpty(text) || text.Length > HeaderLimit || text.IndexOfAny(new[] { '\0', '\r', '\n' }) >= 0)
            throw new InvalidDataException();
        return text;
    }
    internal static void Format(Dictionary<string, object> value)
    {
        if (!(value["v"] is int) || (int)value["v"] != Version) throw new InvalidDataException();
    }
    internal static byte[] Bytes(string value, int expected)
    {
        var bytes = Convert.FromBase64String(value);
        if ((expected >= 0 && bytes.Length != expected) || Convert.ToBase64String(bytes) != value)
        { Array.Clear(bytes, 0, bytes.Length); throw new InvalidDataException(); }
        return bytes;
    }
    internal static string Identity(Dictionary<string, object> identity)
    {
        Fields(identity, "slotId", "vaultId", "tier");
        var slot = Text(identity, "slotId"); var vault = Text(identity, "vaultId"); var tier = Text(identity, "tier");
        if (!System.Text.RegularExpressions.Regex.IsMatch(slot, "\\A[a-f0-9]{32}\\z") ||
            !System.Text.RegularExpressions.Regex.IsMatch(vault, "\\A[a-f0-9]{32}\\z") ||
            (tier != "osStore" && tier != "hardware" && tier != "presence")) throw new InvalidDataException();
        return "MuseSparkVault." + vault + "." + slot + "." + tier;
    }
    internal static byte[] Read(Stream input, int count)
    {
        var bytes = new byte[count]; int offset = 0;
        try
        {
            while (offset < count) { int read = input.Read(bytes, offset, count - offset); if (read == 0) throw new InvalidDataException(); offset += read; }
            return bytes;
        }
        catch { Array.Clear(bytes, 0, bytes.Length); throw; }
    }
    internal static void Reply(object metadata, byte[] key)
    {
        var header = Encoding.UTF8.GetBytes(Json.Serialize(metadata));
        if (header.Length > HeaderLimit) throw new InvalidDataException();
        using (var output = Console.OpenStandardOutput())
        {
            var length = BitConverter.GetBytes(header.Length); if (BitConverter.IsLittleEndian) Array.Reverse(length);
            output.Write(length, 0, length.Length); output.Write(header, 0, header.Length);
            if (key != null) output.Write(key, 0, key.Length);
            output.Flush();
        }
    }
    private static Dictionary<string, object> Ok()
    { return new Dictionary<string, object> { { "v", Version }, { "status", "ok" } }; }
    internal static byte[] WrapDpapi(byte[] key, string identity)
    { return ProtectedData.Protect(key, Encoding.UTF8.GetBytes(identity), DataProtectionScope.CurrentUser); }
    internal static byte[] UnwrapDpapi(byte[] wrapped, string identity)
    { return ProtectedData.Unprotect(wrapped, Encoding.UTF8.GetBytes(identity), DataProtectionScope.CurrentUser); }
    private static bool DpapiAvailable()
    {
        var key = new byte[KeyBytes]; byte[] wrapped = null;
        try
        {
            using (var random = RandomNumberGenerator.Create()) random.GetBytes(key);
            wrapped = WrapDpapi(key, "MuseSparkVault.probe");
            return true;
        }
        catch { return false; }
        finally
        {
            Array.Clear(key, 0, key.Length);
            if (wrapped != null) Array.Clear(wrapped, 0, wrapped.Length);
        }
    }

    [STAThread]
    private static int Main(string[] args)
    {
        byte[] key = null; byte[] outputKey = null;
        try
        {
            if (!SetDefaultDllDirectories(System32Search)) throw new InvalidOperationException();
            if (args.Length != 0) throw new InvalidDataException();
            Dictionary<string, object> request;
            using (var input = Console.OpenStandardInput())
            {
                var lengthBytes = Read(input, sizeof(int)); if (BitConverter.IsLittleEndian) Array.Reverse(lengthBytes);
                var length = BitConverter.ToInt32(lengthBytes, 0);
                if (length <= 0 || length > HeaderLimit) throw new InvalidDataException();
                var header = Read(input, length);
                try { request = Object(Json.DeserializeObject(new UTF8Encoding(false, true).GetString(header))); }
                finally { Array.Clear(header, 0, header.Length); }
                Format(request);
                key = Read(input, Text(request, "operation") == "wrap" ? KeyBytes : 0);
                if (input.ReadByte() != -1) throw new InvalidDataException();
            }
            string operation = Text(request, "operation"); var reply = Ok();
            if (operation == "probe")
            {
                Fields(request, "v", "operation");
                var capabilities = VaultCng.Probe();
                reply.Add("rsa", capabilities[0]); reply.Add("ecc", capabilities[1]);
                reply.Add("hello", VaultHello.IsSupported());
                reply.Add("dpapi", DpapiAvailable());
            }
            else if (operation == "screenLock")
            {
                Fields(request, "v", "operation");
                VaultScreenLock.Wait(); reply.Add("locked", true);
            }
            else
            {
                var identity = Object(request["identity"]); string name = Identity(identity);
                string tier = Text(identity, "tier");
                if (operation == "delete")
                {
                    Fields(request, "v", "operation", "identity");
                    if (tier != "osStore") { VaultCng.Delete(name); if (tier == "presence") VaultHello.Delete(name); }
                }
                else if (operation == "wrap")
                {
                    Fields(request, "v", "operation", "identity", "title", "use");
                    Text(request, "title"); Text(request, "use");
                    var container = new Dictionary<string, object> { { "v", Version }, { "identity", identity } };
                    byte[] wrapped = null;
                    try
                    {
                        if (tier == "osStore") wrapped = WrapDpapi(key, name);
                        else
                        {
                            using (var window = VaultHello.Window(request, tier == "presence"))
                            {
                                string publicKey = tier == "presence" ? VaultHello.Create(name) : null;
                                try { wrapped = VaultCng.Wrap(name, key, window, Text(request, "title"), Text(request, "use")); }
                                catch { if (tier == "presence") VaultHello.Delete(name); throw; }
                                container.Add("helloPublicKey", publicKey);
                            }
                        }
                        if (tier == "osStore") container.Add("helloPublicKey", null);
                        container.Add("sealed", Convert.ToBase64String(wrapped)); reply.Add("container", container);
                    }
                    finally { if (wrapped != null) Array.Clear(wrapped, 0, wrapped.Length); }
                }
                else if (operation == "unwrap")
                {
                    Fields(request, "v", "operation", "identity", "container", "title", "use", "challenge");
                    Text(request, "title"); Text(request, "use");
                    var challenge = Bytes(Text(request, "challenge"), KeyBytes); Array.Clear(challenge, 0, challenge.Length);
                    var container = Object(request["container"]);
                    Fields(container, "v", "identity", "sealed", "helloPublicKey"); Format(container);
                    if (Identity(Object(container["identity"])) != name) throw new InvalidDataException();
                    if (tier != "presence" && container["helloPublicKey"] != null) throw new InvalidDataException();
                    var sealedKey = Bytes(Text(container, "sealed"), tier == "osStore" ? -1 : VaultCng.RsaBytes);
                    try
                    {
                        if (tier == "osStore") outputKey = UnwrapDpapi(sealedKey, name);
                        else using (var window = VaultHello.Window(request, tier == "presence"))
                        {
                            if (tier == "presence") reply.Add("presence", VaultHello.Sign(name, request, Text(container, "helloPublicKey")));
                            if (window != null && (window.IsDisposed || !window.Visible)) throw new CryptographicException();
                            outputKey = VaultCng.Unwrap(name, sealedKey, window, tier == "presence");
                        }
                    }
                    finally { Array.Clear(sealedKey, 0, sealedKey.Length); }
                    if (outputKey.Length != KeyBytes) throw new CryptographicException();
                }
                else throw new InvalidDataException();
            }
            Reply(reply, outputKey); return 0;
        }
        catch
        {
            // Never relay an exception, path, account, OS diagnostic or caller text.
            Reply(new { v = Version, status = "error", code = "refused" }, null); return 1;
        }
        finally
        {
            if (key != null) Array.Clear(key, 0, key.Length);
            if (outputKey != null) Array.Clear(outputKey, 0, outputKey.Length);
        }
    }
}
}
