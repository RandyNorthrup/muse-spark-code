// Test-only injected software provider. Generated keys only; no TPM claim.
namespace MuseSparkVaultNative
{
using System;
using System.Collections.Generic;
using System.Reflection;
using System.Security.Cryptography;

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
    private static void Main()
    {
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
        Console.WriteLine(MuseSparkVault.Json.Serialize(result));
    }
}
}
