// Runtime WinRT projection uses Windows' own metadata: no SDK/provisioning dependency.
namespace MuseSparkVaultNative
{
using System;
using System.Collections.Generic;
using System.Reflection;
using System.Security.Cryptography;
using System.Text;
using System.Threading;
using System.Windows.Forms;

internal static class VaultHello
{
    private const int AsyncStarted = 0, AsyncCompleted = 1, PollMilliseconds = 10, DeadlineMilliseconds = 120000;
    private static Type Runtime(string name)
    { return Type.GetType(name + ", Windows, ContentType=WindowsRuntime", true); }
    private static object Await(MethodInfo method, object target, params object[] args)
    {
        var operation = method.Invoke(target, args);
        var info = Runtime("Windows.Foundation.IAsyncInfo");
        try
        {
            var deadline = Environment.TickCount;
            int status;
            while ((status = Convert.ToInt32(info.GetProperty("Status").GetValue(operation, null))) == AsyncStarted)
            {
                if (unchecked(Environment.TickCount - deadline) >= DeadlineMilliseconds)
                { info.GetMethod("Cancel").Invoke(operation, null); throw new CryptographicException(); }
                Application.DoEvents(); Thread.Sleep(PollMilliseconds);
            }
            if (status != AsyncCompleted) throw new CryptographicException();
            var results = method.ReturnType.GetMethod("GetResults");
            return results == null ? null : results.Invoke(operation, null);
        }
        finally { info.GetMethod("Close").Invoke(operation, null); }
    }
    private static object Manager(string method, params object[] args)
    { return Await(Runtime("Windows.Security.Credentials.KeyCredentialManager").GetMethod(method), null, args); }
    internal static bool IsSupported()
    { try { return (bool)Manager("IsSupportedAsync"); } catch { return false; } }
    internal static Form Window(Dictionary<string, object> request, bool needed)
    {
        if (!needed) return null;
        if (!IsSupported() || !Environment.UserInteractive) throw new CryptographicException();
        var form = new Form
        {
            Text = MuseSparkVault.Text(request, "title"), StartPosition = FormStartPosition.CenterScreen,
            FormBorderStyle = FormBorderStyle.FixedDialog, MinimizeBox = false, MaximizeBox = false,
        };
        form.Controls.Add(new TextBox { Text = MuseSparkVault.Text(request, "use"), Dock = DockStyle.Fill, Multiline = true, ReadOnly = true, ScrollBars = ScrollBars.Vertical });
        form.Show(); form.Activate(); Application.DoEvents(); return form;
    }
    private static object Credential(object result)
    {
        var type = result.GetType();
        if (Convert.ToInt32(type.GetProperty("Status").GetValue(result, null)) != 0) throw new CryptographicException();
        return type.GetProperty("Credential").GetValue(result, null);
    }
    private static byte[] BufferBytes(object buffer)
    {
        var cryptography = Runtime("Windows.Security.Cryptography.CryptographicBuffer");
        var args = new object[] { buffer, null };
        cryptography.GetMethod("CopyToByteArray").Invoke(null, args); return (byte[])args[1];
    }
    private static object BufferFrom(byte[] bytes)
    { return Runtime("Windows.Security.Cryptography.CryptographicBuffer").GetMethod("CreateFromByteArray").Invoke(null, new object[] { bytes }); }
    private static string PublicKey(object credential)
    {
        var format = Runtime("Windows.Security.Cryptography.Core.CryptographicPublicKeyBlobType");
        var method = credential.GetType().GetMethod("RetrievePublicKey", new[] { format });
        return Convert.ToBase64String(BufferBytes(method.Invoke(credential, new[] { Enum.Parse(format, "X509SubjectPublicKeyInfo") })));
    }
    internal static string Create(string name)
    {
        var option = Enum.Parse(Runtime("Windows.Security.Credentials.KeyCredentialCreationOption"), "FailIfExists");
        var credential = Credential(Manager("RequestCreateAsync", name + ".hello", option));
        try { return PublicKey(credential); }
        catch { Delete(name); throw; }
    }
    internal static void Delete(string name)
    { Manager("DeleteAsync", name + ".hello"); }
    internal static Dictionary<string, object> Sign(string name, Dictionary<string, object> request, string expectedPublicKey)
    {
        var credential = Credential(Manager("OpenAsync", name + ".hello"));
        string publicKey = PublicKey(credential);
        if (publicKey != expectedPublicKey) throw new CryptographicException();
        // New caller challenge binds the exact identity and named use; never a wrap key.
        byte[] message = Encoding.UTF8.GetBytes(name + "\n" + MuseSparkVault.Text(request, "use") + "\n" + MuseSparkVault.Text(request, "challenge"));
        var result = Await(credential.GetType().GetMethod("RequestSignAsync"), credential, BufferFrom(message));
        if (Convert.ToInt32(result.GetType().GetProperty("Status").GetValue(result, null)) != 0) throw new CryptographicException();
        var signature = BufferBytes(result.GetType().GetProperty("Result").GetValue(result, null));
        var format = Runtime("Windows.Security.Cryptography.Core.CryptographicPublicKeyBlobType");
        var retrieve = credential.GetType().GetMethod("RetrievePublicKey", new[] { format });
        var rsaBlob = BufferBytes(retrieve.Invoke(credential, new[] { Enum.Parse(format, "BCryptPublicKey") }));
        string padding;
        using (var key = CngKey.Import(rsaBlob, CngKeyBlobFormat.GenericPublicBlob))
        using (var rsa = new RSACng(key))
        {
            if (rsa.VerifyData(message, signature, HashAlgorithmName.SHA256, RSASignaturePadding.Pss)) padding = "pss";
            else if (rsa.VerifyData(message, signature, HashAlgorithmName.SHA256, RSASignaturePadding.Pkcs1)) padding = "pkcs1";
            else throw new CryptographicException();
        }
        return new Dictionary<string, object> { { "challenge", request["challenge"] }, { "signature", Convert.ToBase64String(signature) }, { "publicKey", publicKey }, { "padding", padding } };
    }
}
}
