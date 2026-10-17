// Test-only WinRT stand-ins. Real ephemeral RSA signs; no enrollment or OS prompt.
namespace MuseSparkVaultNative
{
using System;
using System.Collections.Generic;
using System.Reflection;
using System.Security.Cryptography;
using System.Text;
using System.Windows.Forms;

internal enum VaultMemoryFormat { X509SubjectPublicKeyInfo, BCryptPublicKey }
internal enum VaultMemoryOption { FailIfExists, ReplaceExisting }
internal class VaultMemoryOperation
{
    private int reads;
    public int Status { get { return VaultMemoryHello.AsyncMode != 0 ? VaultMemoryHello.AsyncMode : ++reads < 30 ? 0 : 2; } }
    public object GetResults() { return Value; }
    public object Value;
    public void Cancel() { VaultMemoryHello.Canceled = true; }
    public void Close() { VaultMemoryHello.Closed = true; }
}
internal class VaultMemoryResult
{
    public int Status { get; set; }
    public VaultMemoryCredential Credential { get { return new VaultMemoryCredential(); } }
    public byte[] Result { get; set; }
}
internal class VaultMemoryCredential
{
    public byte[] RetrievePublicKey(VaultMemoryFormat format)
    {
        if (VaultMemoryHello.ThrowPublic) throw new CryptographicException();
        // The projection fixture uses the public CNG blob for both formats.
        // Production's SPKI is independently verified by Node's actual DER tests.
        return VaultMemoryHello.Key.Export(CngKeyBlobFormat.GenericPublicBlob);
    }
    public VaultMemoryOperation RequestSignAsync(byte[] message)
    {
        VaultMemoryHello.SignCount++;
        VaultMemoryHello.Message = Encoding.UTF8.GetString(message);
        byte[] signature;
        using (var rsa = new RSACng(VaultMemoryHello.Key))
            signature = rsa.SignData(message, HashAlgorithmName.SHA256, VaultMemoryHello.Padding);
        if (VaultMemoryHello.BadSignature) signature[0] ^= 1;
        return new VaultMemoryOperation { Value = new VaultMemoryResult { Status = VaultMemoryHello.SignStatus, Result = signature } };
    }
}
internal static class VaultMemoryManager
{
    public static VaultMemoryOperation IsSupportedAsync()
    { return new VaultMemoryOperation { Value = VaultMemoryHello.Supported }; }
    public static VaultMemoryOperation RequestCreateAsync(string name, VaultMemoryOption option)
    {
        VaultMemoryHello.FailIfExists = option == VaultMemoryOption.FailIfExists;
        VaultMemoryHello.Exists = true;
        return new VaultMemoryOperation { Value = new VaultMemoryResult { Status = VaultMemoryHello.CredentialStatus } };
    }
    public static VaultMemoryOperation OpenAsync(string name)
    { return new VaultMemoryOperation { Value = new VaultMemoryResult { Status = VaultMemoryHello.CredentialStatus } }; }
    public static VaultMemoryOperation DeleteAsync(string name)
    { VaultMemoryHello.Exists = false; return new VaultMemoryOperation(); }
}
internal static class VaultMemoryBuffer
{
    public static byte[] CreateFromByteArray(byte[] value) { return value; }
    public static void CopyToByteArray(byte[] value, out byte[] copy) { copy = (byte[])value.Clone(); }
}
internal class VaultMemoryWindow : Form
{
    protected override void SetVisibleCore(bool value) { base.SetVisibleCore(false); }
}
internal static class VaultMemoryLock
{
    internal static bool Available, Released;
    internal static bool Register(IntPtr window, int flags) { return Available; }
    internal static bool Unregister(IntPtr window) { Released = true; return true; }
    internal static void Run(Form window) { }
}
internal static class VaultMemoryHello
{
    internal static bool Supported = true, UserInteractive = true, ThrowPublic, BadSignature, Canceled, Closed, Exists, FailIfExists;
    internal static int AsyncMode = 1, CredentialStatus, SignStatus, SignCount;
    internal static string Message;
    internal static CngKey Key;
    internal static RSASignaturePadding Padding = RSASignaturePadding.Pss;
    internal static Type Runtime(string name)
    {
        switch (name)
        {
            case "Windows.Foundation.IAsyncInfo": return typeof(VaultMemoryOperation);
            case "Windows.Security.Credentials.KeyCredentialManager": return typeof(VaultMemoryManager);
            case "Windows.Security.Credentials.KeyCredentialCreationOption": return typeof(VaultMemoryOption);
            case "Windows.Security.Cryptography.CryptographicBuffer": return typeof(VaultMemoryBuffer);
            case "Windows.Security.Cryptography.Core.CryptographicPublicKeyBlobType": return typeof(VaultMemoryFormat);
            default: throw new InvalidOperationException();
        }
    }
    private static bool Refuses(Action action) { try { action(); return false; } catch { return true; } }
    internal static void Capture(Dictionary<string, object> result)
    {
        var parameters = new CngKeyCreationParameters { Provider = CngProvider.MicrosoftSoftwareKeyStorageProvider, KeyUsage = CngKeyUsages.Signing };
        parameters.Parameters.Add(new CngProperty("Length", BitConverter.GetBytes(2048), CngPropertyOptions.None));
        using (Key = CngKey.Create(CngAlgorithm.Rsa, null, parameters))
        {
            var request = new Dictionary<string, object> { { "title", "Generated test" }, { "use", "First exact use" }, { "challenge", Convert.ToBase64String(new byte[32]) } };
            result.Add("helloSupported", VaultHello.IsSupported());
            Supported = false;
            result.Add("helloSupportRefused", Refuses(() => { using (VaultHello.Window(request, true)) { } }));
            Supported = true; UserInteractive = false;
            result.Add("helloInteractiveRefused", Refuses(() => { using (VaultHello.Window(request, true)) { } }));
            UserInteractive = true;
            result.Add("helloSilentNoWindow", VaultHello.Window(request, false) == null);
            AsyncMode = 2; result.Add("helloAsyncFailureRefused", !VaultHello.IsSupported());
            AsyncMode = 0; Canceled = false;
            result.Add("helloDeadlineCanceled", !VaultHello.IsSupported() && Canceled);
            AsyncMode = 1; Closed = false;
            VaultHello.IsSupported(); result.Add("helloOperationClosed", Closed);
            CredentialStatus = 1;
            result.Add("helloCredentialFailureRefused", Refuses(() => VaultHello.Create("GeneratedTest")));
            CredentialStatus = 0;
            string publicKey = VaultHello.Create("GeneratedTest");
            result.Add("helloCreationNoOverwrite", FailIfExists);
            ThrowPublic = true;
            result.Add("helloFailedCreationCleaned", Refuses(() => VaultHello.Create("GeneratedOther")) && !Exists);
            ThrowPublic = false;
            var first = VaultHello.Sign("GeneratedTest", request, publicKey);
            result.Add("helloPssVerified", (string)first["padding"] == "pss");
            result.Add("helloUseChallengeBound", Message == "GeneratedTest\nFirst exact use\n" + request["challenge"]);
            request["use"] = "Second exact use";
            Padding = RSASignaturePadding.Pkcs1;
            var second = VaultHello.Sign("GeneratedTest", request, publicKey);
            result.Add("helloPkcs1Verified", (string)second["padding"] == "pkcs1");
            result.Add("helloFreshSignEveryUse", SignCount == 2 && Message.Contains("Second exact use"));
            result.Add("helloForeignKeyRefused", Refuses(() => VaultHello.Sign("GeneratedTest", request, "foreign")));
            SignStatus = 1;
            result.Add("helloSignFailureRefused", Refuses(() => VaultHello.Sign("GeneratedTest", request, publicKey)));
            SignStatus = 0; BadSignature = true;
            result.Add("helloBadSignatureRefused", Refuses(() => VaultHello.Sign("GeneratedTest", request, publicKey)));
            BadSignature = false;
        }
        result.Add("lockSubscriptionFailureRefused", Refuses(() => VaultScreenLock.Wait()));
        VaultMemoryLock.Available = true;
        VaultScreenLock.Wait(); result.Add("lockSubscriptionReleased", VaultMemoryLock.Released);
        var constructor = typeof(VaultScreenLock).GetConstructor(BindingFlags.NonPublic | BindingFlags.Instance, null, Type.EmptyTypes, null);
        var handler = typeof(VaultScreenLock).GetMethod("WndProc", BindingFlags.NonPublic | BindingFlags.Instance);
        using (var window = (VaultScreenLock)constructor.Invoke(null))
        {
            var foreign = System.Windows.Forms.Message.Create(window.Handle, 0, new IntPtr(7), IntPtr.Zero);
            handler.Invoke(window, new object[] { foreign });
            result.Add("lockForeignMessageIgnored", !window.IsDisposed);
            var unlock = System.Windows.Forms.Message.Create(window.Handle, 0x2b1, new IntPtr(8), IntPtr.Zero);
            handler.Invoke(window, new object[] { unlock });
            result.Add("lockOtherEventIgnored", !window.IsDisposed);
            var locked = System.Windows.Forms.Message.Create(window.Handle, 0x2b1, new IntPtr(7), IntPtr.Zero);
            handler.Invoke(window, new object[] { locked });
            result.Add("lockOwnEventClosed", window.IsDisposed);
        }
    }
}
}
