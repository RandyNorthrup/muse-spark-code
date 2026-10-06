namespace MuseSparkVaultNative
{
using System;
using System.Runtime.InteropServices;
using System.Windows.Forms;

internal sealed class VaultScreenLock : Form
{
    private const int WmSessionChange = 0x2b1, SessionLock = 0x7, NotifyThisSession = 0;
    [DllImport("wtsapi32.dll", SetLastError = true)]
    private static extern bool WTSRegisterSessionNotification(IntPtr window, int flags);
    [DllImport("wtsapi32.dll")]
    private static extern bool WTSUnRegisterSessionNotification(IntPtr window);
    private VaultScreenLock() { ShowInTaskbar = false; }
    protected override void SetVisibleCore(bool value) { base.SetVisibleCore(false); }
    protected override void WndProc(ref Message message)
    {
        if (message.Msg == WmSessionChange && message.WParam.ToInt32() == SessionLock) Close();
        base.WndProc(ref message);
    }
    internal static void Wait()
    {
        using (var window = new VaultScreenLock())
        {
            var handle = window.Handle;
            if (!WTSRegisterSessionNotification(handle, NotifyThisSession)) throw new InvalidOperationException();
            try { Application.Run(window); }
            finally { WTSUnRegisterSessionNotification(handle); }
        }
    }
}
}
