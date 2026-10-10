// Test-only named-key persistence over real ephemeral CNG keys. No profile files.
namespace MuseSparkVaultNative
{
using System;
using System.Collections.Generic;
using System.Security.Cryptography;

internal static class VaultMemoryKsp
{
    private static readonly Dictionary<string, CngKey> Keys = new Dictionary<string, CngKey>();
    internal static bool OnlyCurrentUser = true;
    internal static bool Exists(string name, CngProvider provider) { return Keys.ContainsKey(name); }
    private static CngKey Copy(CngKey key)
    {
        using (var handle = key.Handle) return CngKey.Open(handle, CngKeyHandleOpenOptions.EphemeralKey);
    }
    internal static CngKey Create(CngAlgorithm algorithm, string name, CngKeyCreationParameters parameters)
    {
        OnlyCurrentUser &= (parameters.KeyCreationOptions & CngKeyCreationOptions.MachineKey) == 0;
        if (Keys.ContainsKey(name))
        {
            if ((parameters.KeyCreationOptions & CngKeyCreationOptions.OverwriteExistingKey) == 0) throw new CryptographicException();
            Delete(name);
        }
        // The fake persists only in this process; crypto and key properties are real CNG.
        parameters.KeyCreationOptions = CngKeyCreationOptions.None;
        var key = CngKey.Create(algorithm, null, parameters);
        Keys.Add(name, key);
        return Copy(key);
    }
    internal static CngKey Open(string name, CngProvider provider, CngKeyOpenOptions options)
    {
        CngKey key;
        if (!Keys.TryGetValue(name, out key)) throw new CryptographicException();
        return Copy(key);
    }
    internal static void Delete(string name)
    {
        CngKey key;
        if (Keys.TryGetValue(name, out key)) { Keys.Remove(name); key.Dispose(); }
    }
}
}
