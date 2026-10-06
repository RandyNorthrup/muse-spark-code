namespace MuseSparkVaultNative
{
using System;
using System.Runtime.InteropServices;
using System.Security.Cryptography;
using System.Text;
using System.Windows.Forms;

internal static class VaultCng
{
    internal const int RsaBits = 2048, RsaBytes = RsaBits / 8;
    private static readonly CngProvider Provider = new CngProvider("Microsoft Platform Crypto Provider");
    private const int Silent = 0x40;
    [DllImport("ncrypt.dll", CharSet = CharSet.Unicode)]
    private static extern int NCryptOpenStorageProvider(out IntPtr provider, string name, int flags);
    [DllImport("ncrypt.dll", CharSet = CharSet.Unicode)]
    private static extern int NCryptIsAlgSupported(IntPtr provider, string algorithm, int flags);
    [DllImport("ncrypt.dll")]
    private static extern int NCryptFreeObject(IntPtr handle);

    internal static bool[] Probe()
    {
        IntPtr provider;
        if (NCryptOpenStorageProvider(out provider, Provider.Provider, 0) != 0) return new[] { false, false };
        try { return new[] { NCryptIsAlgSupported(provider, "RSA", Silent) == 0, NCryptIsAlgSupported(provider, "ECDSA_P256", Silent) == 0 }; }
        finally { NCryptFreeObject(provider); }
    }
    internal static byte[] Wrap(string name, byte[] key, Form window, string title, string use)
    {
        if (CngKey.Exists(name, Provider)) throw new CryptographicException();
        var parameters = new CngKeyCreationParameters
        {
            Provider = Provider, KeyCreationOptions = CngKeyCreationOptions.None,
            ExportPolicy = CngExportPolicies.None, KeyUsage = CngKeyUsages.Decryption,
        };
        parameters.Parameters.Add(new CngProperty("Length", BitConverter.GetBytes(RsaBits), CngPropertyOptions.None));
        if (window != null)
        {
            parameters.ParentWindowHandle = window.Handle;
            parameters.UIPolicy = new CngUIPolicy(CngUIProtectionLevels.ForceHighProtection, title, use, use);
        }
        bool created = false;
        try
        {
            using (var resident = CngKey.Create(CngAlgorithm.Rsa, name, parameters))
            {
                created = true;
                Validate(resident, window != null);
                using (var rsa = new RSACng(resident)) return rsa.Encrypt(key, RSAEncryptionPadding.OaepSHA256);
            }
        }
        catch { if (created) Delete(name); throw; }
    }
    private static void Validate(CngKey key, bool presence)
    {
        if (key.Provider != Provider || key.KeySize != RsaBits || key.Algorithm != CngAlgorithm.Rsa ||
            key.ExportPolicy != CngExportPolicies.None || key.KeyUsage != CngKeyUsages.Decryption || key.IsMachineKey ||
            (presence && (key.UIPolicy.ProtectionLevel & CngUIProtectionLevels.ForceHighProtection) == 0))
            throw new CryptographicException();
    }
    internal static byte[] Unwrap(string name, byte[] wrapped, Form window, bool presence)
    {
        // No provider fallback: a software key can never satisfy the hardware tier.
        using (var resident = CngKey.Open(name, Provider, window == null ? CngKeyOpenOptions.Silent : CngKeyOpenOptions.None))
        {
            Validate(resident, presence);
            if (window != null) resident.ParentWindowHandle = window.Handle;
            using (var rsa = new RSACng(resident)) return rsa.Decrypt(wrapped, RSAEncryptionPadding.OaepSHA256);
        }
    }
    internal static void Delete(string name)
    {
        if (!CngKey.Exists(name, Provider)) return;
        using (var key = CngKey.Open(name, Provider, CngKeyOpenOptions.Silent)) key.Delete();
    }
}
}
