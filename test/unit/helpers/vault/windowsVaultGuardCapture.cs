// Test-only injected software provider. Generated keys only; no TPM claim.
namespace MuseSparkVaultNative
{
using System;
using System.Collections.Generic;
using System.Reflection;
using System.Security.Cryptography;
using System.Security.AccessControl;
using System.Security.Principal;

internal static class VaultGuardCapture
{
    private static bool Refuses(Action action)
    { try { action(); return false; } catch { return true; } }
    private static CngKey Ephemeral(int bits, CngExportPolicies export, CngKeyUsages usage)
    {
        var parameters = new CngKeyCreationParameters { Provider = CngProvider.MicrosoftSoftwareKeyStorageProvider, ExportPolicy = export, KeyUsage = usage };
        parameters.Parameters.Add(new CngProperty("Length", BitConverter.GetBytes(bits), CngPropertyOptions.None));
        return CngKey.Create(CngAlgorithm.Rsa, null, parameters);
    }
    private static void Validate(CngKey key, bool presence)
    { typeof(VaultCng).GetMethod("Validate", BindingFlags.NonPublic | BindingFlags.Static).Invoke(null, new object[] { key, presence }); }
    private static int Main(string[] args)
    {
        if (args.Length == 1 && args[0] == "childWait")
        {
            Console.WriteLine(System.Diagnostics.Process.GetCurrentProcess().Id);
            Console.Out.Flush();
            System.Threading.Thread.Sleep(System.Threading.Timeout.Infinite);
            return 0;
        }
        if (args.Length == 2 && args[0] == "aclCapture")
        {
            var owner = WindowsIdentity.GetCurrent().User;
            var users = new SecurityIdentifier("S-1-5-32-545");
            var acl = new RawAcl(GenericAcl.AclRevision, 2);
            uint mask = args[1] == "usersGenericAll" ? 0x10000000u : args[1] == "usersGenericExecute" ? 0x20000000u : 0x40000000u;
            // ACE masks are unsigned native bit patterns, preserved in CommonAce's signed storage.
            var allow = new CommonAce(AceFlags.None, AceQualifier.AccessAllowed, unchecked((int)mask), users, false, null);
            var deny = new CommonAce(AceFlags.None, AceQualifier.AccessDenied, unchecked((int)mask), users, false, null);
            if (args[1] == "denyThenAllow") acl.InsertAce(acl.Count, deny);
            if (args[1] == "denyOtherGroup") acl.InsertAce(acl.Count, new CommonAce(AceFlags.None, AceQualifier.AccessDenied, unchecked((int)mask), new SecurityIdentifier("S-1-5-32-546"), false, null));
            if (args[1] != "safeDacl") acl.InsertAce(acl.Count, allow);
            if (args[1] == "allowThenDeny") acl.InsertAce(acl.Count, deny);
            var descriptor = new RawSecurityDescriptor(ControlFlags.DiscretionaryAclPresent, owner, owner, null, args[1] == "nullDacl" ? null : acl);
            Console.WriteLine((!Refuses(() => VaultPathGuard.AssertDescriptor(descriptor, "fixture", true))).ToString().ToLowerInvariant());
            return 0;
        }
        if (args.Length == 1 && (args[0] == "protocol" || args[0] == "dllCapture"))
        {
            // This declared entry point returns int; reflection is used only by the test fixture.
            int code = (int)typeof(MuseSparkVault).GetMethod("Main", BindingFlags.NonPublic | BindingFlags.Static).Invoke(null, new object[] { new string[0] });
            if (args[0] == "dllCapture")
            {
                bool system = false, foreign = false;
                string windows = Environment.GetFolderPath(Environment.SpecialFolder.Windows);
                using (var process = System.Diagnostics.Process.GetCurrentProcess())
                foreach (System.Diagnostics.ProcessModule module in process.Modules)
                {
                    if (!String.Equals(System.IO.Path.GetFileName(module.FileName), "ncrypt.dll", StringComparison.OrdinalIgnoreCase)) continue;
                    string directory = System.IO.Path.GetDirectoryName(module.FileName);
                    bool trusted = String.Equals(directory, System.IO.Path.Combine(windows, "System32"), StringComparison.OrdinalIgnoreCase) ||
                        String.Equals(directory, System.IO.Path.Combine(windows, "SysWOW64"), StringComparison.OrdinalIgnoreCase);
                    system |= trusted; foreign |= !trusted;
                }
                MuseSparkVault.Reply(new { systemNcryptLoaded = system, foreignNcryptLoaded = foreign }, null);
            }
            return code;
        }
        var result = new Dictionary<string, object>();
        var identity = new Dictionary<string, object> { { "slotId", new String('1', 32) }, { "vaultId", new String('2', 32) }, { "tier", "hardware" } };
        result.Add("identityAcceptsOwn", MuseSparkVault.Identity(identity).StartsWith("MuseSparkVault."));
        identity["slotId"] = "../foreign"; result.Add("identityRefusesForeign", Refuses(() => MuseSparkVault.Identity(identity)));
        identity["slotId"] = new String('1', 32); identity["tier"] = "software";
        result.Add("identityRefusesTier", Refuses(() => MuseSparkVault.Identity(identity)));
        result.Add("formatRefusesVersion", Refuses(() => MuseSparkVault.Format(new Dictionary<string, object> { { "v", 2 } })));
        result.Add("formatRefusesCoercion", Refuses(() => MuseSparkVault.Format(new Dictionary<string, object> { { "v", "1" } })));
        result.Add("fieldsRefuseExtra", Refuses(() => MuseSparkVault.Fields(new Dictionary<string, object> { { "one", 1 }, { "extra", 2 } }, "one")));
        result.Add("fieldsRefuseMissing", Refuses(() => MuseSparkVault.Fields(new Dictionary<string, object> { { "extra", 2 } }, "one")));
        foreach (var invalid in new[] { "", "a\0b", "a\nb", "a\rb", new String('x', MuseSparkVault.HeaderLimit + 1) })
            result["textRefuses" + Array.IndexOf(new[] { "", "a\0b", "a\nb", "a\rb", new String('x', MuseSparkVault.HeaderLimit + 1) }, invalid)] = Refuses(() => MuseSparkVault.Text(new Dictionary<string, object> { { "use", invalid } }, "use"));
        result.Add("bytesRefuseLength", Refuses(() => MuseSparkVault.Bytes("YQ==", 32)));
        result.Add("bytesRefuseNoncanonical", Refuses(() => MuseSparkVault.Bytes("Y Q==", 1)));

        using (var key = Ephemeral(2048, CngExportPolicies.None, CngKeyUsages.Decryption))
            result.Add("providerRefusesSoftware", Refuses(() => Validate(key, false)));
        // Only test material uses this injected provider; production never falls back.
        typeof(VaultCng).GetField("Provider", BindingFlags.NonPublic | BindingFlags.Static).SetValue(null, CngProvider.MicrosoftSoftwareKeyStorageProvider);
        using (var key = Ephemeral(2048, CngExportPolicies.None, CngKeyUsages.Decryption))
        {
            result.Add("validRsaAccepted", !Refuses(() => Validate(key, false)));
            result.Add("presenceRefusesUnprotected", Refuses(() => Validate(key, true)));
        }
        using (var key = Ephemeral(1024, CngExportPolicies.None, CngKeyUsages.Decryption))
            result.Add("sizeRefusesWeakRsa", Refuses(() => Validate(key, false)));
        using (var key = Ephemeral(2048, CngExportPolicies.AllowPlaintextExport, CngKeyUsages.Decryption))
            result.Add("exportRefusesExportable", Refuses(() => Validate(key, false)));
        using (var key = Ephemeral(2048, CngExportPolicies.None, CngKeyUsages.Signing))
            result.Add("usageRefusesSigning", Refuses(() => Validate(key, false)));
        using (var key = CngKey.Create(CngAlgorithm.ECDsaP256))
            result.Add("algorithmRefusesEccWrap", Refuses(() => Validate(key, false)));

        string name = "MuseSparkVault." + Guid.NewGuid().ToString("N") + "." + Guid.NewGuid().ToString("N") + ".hardware";
        var secret = new byte[MuseSparkVault.KeyBytes]; RandomNumberGenerator.Create().GetBytes(secret);
        byte[] wrapped = null; byte[] unwrapped = null;
        try
        {
            var dpapi = MuseSparkVault.WrapDpapi(secret, name);
            try
            {
                var decoded = MuseSparkVault.UnwrapDpapi(dpapi, name);
                result.Add("dpapiOwnedRoundtrip", Convert.ToBase64String(decoded) == Convert.ToBase64String(secret));
                Array.Clear(decoded, 0, decoded.Length);
                result.Add("dpapiIdentityBound", Refuses(() => MuseSparkVault.UnwrapDpapi(dpapi, name + ".foreign")));
                result.Add("dpapiCurrentUser", VaultMemoryDpapi.OnlyCurrentUser);
            }
            finally { Array.Clear(dpapi, 0, dpapi.Length); VaultMemoryDpapi.Clear(); }
            wrapped = VaultCng.Wrap(name, secret, null, "", "");
            unwrapped = VaultCng.Unwrap(name, wrapped, null, false);
            result.Add("oaepRoundtrip", Convert.ToBase64String(secret) == Convert.ToBase64String(unwrapped));
            result.Add("overwriteRefused", Refuses(() => VaultCng.Wrap(name, secret, null, "", "")));
            using (var key = VaultMemoryKsp.Open(name, CngProvider.MicrosoftSoftwareKeyStorageProvider, CngKeyOpenOptions.Silent))
            using (var rsa = new RSACng(key))
            {
                result.Add("privateExportRefused", Refuses(() => key.Export(CngKeyBlobFormat.GenericPrivateBlob)));
                result.Add("currentUserKey", !key.IsMachineKey);
                result.Add("oaepSha256Verified", !Refuses(() => rsa.Decrypt(wrapped, RSAEncryptionPadding.OaepSHA256)));
            }
            wrapped[0] ^= 1;
            result.Add("oaepTamperRefused", Refuses(() => VaultCng.Unwrap(name, wrapped, null, false)));
        }
        finally
        {
            Array.Clear(secret, 0, secret.Length);
            if (wrapped != null) Array.Clear(wrapped, 0, wrapped.Length);
            if (unwrapped != null) Array.Clear(unwrapped, 0, unwrapped.Length);
            VaultCng.Delete(name);
        }
        result.Add("generatedKeyDeleted", !VaultMemoryKsp.Exists(name, CngProvider.MicrosoftSoftwareKeyStorageProvider));
        result.Add("currentUserCreation", VaultMemoryKsp.OnlyCurrentUser);
        VaultMemoryHello.Capture(result);
        Console.WriteLine(MuseSparkVault.Json.Serialize(result));
        return 0;
    }
}
}
