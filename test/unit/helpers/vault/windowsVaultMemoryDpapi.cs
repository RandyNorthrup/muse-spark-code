// Test-only authenticated box, for checking the native caller's scope/entropy.
// This does not prove OS encryption or user isolation, and writes no file.
namespace MuseSparkVaultNative
{
using System;
using System.Security.Cryptography;

internal static class VaultMemoryDpapi
{
    private static readonly byte[] Key = new byte[32];
    internal static bool OnlyCurrentUser = true;
    static VaultMemoryDpapi() { using (var random = RandomNumberGenerator.Create()) random.GetBytes(Key); }
    private static byte[] Mac(byte[] data, byte[] entropy, DataProtectionScope scope)
    {
        OnlyCurrentUser &= scope == DataProtectionScope.CurrentUser;
        var input = new byte[data.Length + (entropy == null ? 0 : entropy.Length) + sizeof(int)];
        Array.Copy(data, input, data.Length);
        if (entropy != null) Array.Copy(entropy, 0, input, data.Length, entropy.Length);
        Array.Copy(BitConverter.GetBytes((int)scope), 0, input, input.Length - sizeof(int), sizeof(int));
        try { using (var hmac = new HMACSHA256(Key)) return hmac.ComputeHash(input); }
        finally { Array.Clear(input, 0, input.Length); }
    }
    internal static byte[] Protect(byte[] data, byte[] entropy, DataProtectionScope scope)
    {
        var mac = Mac(data, entropy, scope);
        var result = new byte[mac.Length + data.Length];
        Array.Copy(mac, result, mac.Length); Array.Copy(data, 0, result, mac.Length, data.Length);
        Array.Clear(mac, 0, mac.Length); return result;
    }
    internal static byte[] Unprotect(byte[] wrapped, byte[] entropy, DataProtectionScope scope)
    {
        var result = new byte[wrapped.Length - Key.Length]; Array.Copy(wrapped, Key.Length, result, 0, result.Length);
        var mac = Mac(result, entropy, scope); int difference = 0;
        for (int index = 0; index < mac.Length; index++) difference |= mac[index] ^ wrapped[index];
        Array.Clear(mac, 0, mac.Length);
        if (difference != 0) { Array.Clear(result, 0, result.Length); throw new CryptographicException(); }
        return result;
    }
    internal static void Clear() { Array.Clear(Key, 0, Key.Length); }
}
}
