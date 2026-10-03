using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Security.Principal;
using System.Text;
using Microsoft.Win32.SafeHandles;

namespace DualSurface.UiaReference;

// Only the harness-created Process is accepted. No PID/handle selector input.
internal sealed class WindowsAdmission
{
    private sealed record TokenIdentity(string User, string Integrity, int Session);
    private readonly Process owned;
    private readonly long birth;
    private readonly TokenIdentity admitted;

    public WindowsAdmission(Process owned)
    {
        this.owned = owned;
        birth = owned.StartTime.ToUniversalTime().Ticks;
        Program.Stage = "admission-subject-token";
        admitted = Token(owned.Handle);
        CheckTokenAndDesktop();
    }

    public nint CurrentWindow()
    {
        if (owned.HasExited || owned.StartTime.ToUniversalTime().Ticks != birth)
            throw new GuardException(GuardCode.SurfaceUnavailable);
        CheckTokenAndDesktop();
        owned.Refresh();
        nint window = owned.MainWindowHandle;
        uint thread = GetWindowThreadProcessId(window, out uint process);
        if (window == 0 || !IsWindow(window) || thread == 0 || process != (uint)owned.Id)
            throw new GuardException(GuardCode.SurfaceUnavailable);
        CheckDesktop(GetThreadDesktop(thread)); // borrowed handle: never close
        return window;
    }

    public void RequireUnchanged(nint window)
    {
        if (CurrentWindow() != window) throw new GuardException(GuardCode.StaleRevision);
    }

    internal static bool OwnedFormerWindowDestroyed(nint formerlyOwnedWindow) =>
        formerlyOwnedWindow != 0 && !IsWindow(formerlyOwnedWindow);

    private void CheckTokenAndDesktop()
    {
        Program.Stage = "admission-token";
        using var self = Process.GetCurrentProcess();
        var worker = Token(self.Handle);
        var subject = Token(owned.Handle);
        if (subject != admitted || subject != worker || subject.Session != owned.SessionId ||
            worker.Session != self.SessionId || !Environment.UserInteractive)
            throw new GuardException(GuardCode.NotAuthorized);
        nint state = 0;
        Program.Stage = "admission-session";
        try
        {
            // Current local session only; never enumerate or query another user.
            if (!WTSQuerySessionInformationW(0, subject.Session, 8, out state, out uint size) ||
                state == 0 || size != 4 || Marshal.ReadInt32(state) != 0)
                throw new GuardException(GuardCode.NotAuthorized);
        }
        finally { if (state != 0) WTSFreeMemory(state); }
        Program.Stage = "admission-station";
        if (ObjectName(GetProcessWindowStation()) != "WinSta0") throw new GuardException(GuardCode.NotAuthorized);
        Program.Stage = "admission-worker-desktop";
        CheckDesktop(GetThreadDesktop(GetCurrentThreadId()));
        Program.Stage = "admission-input-desktop";
        nint input = OpenInputDesktop(0, false, 1); // DESKTOP_READOBJECTS only
        if (input == 0) throw new GuardException(GuardCode.NotAuthorized);
        try { CheckDesktop(input); }
        finally { CloseDesktop(input); }
    }

    private static void CheckDesktop(nint desktop)
    {
        if (desktop == 0 || ObjectName(desktop) != "Default") throw new GuardException(GuardCode.NotAuthorized);
        nint buffer = Marshal.AllocHGlobal(4);
        try
        {
            if (!GetUserObjectInformationW(desktop, 6, buffer, 4, out uint size) || size != 4 ||
                Marshal.ReadInt32(buffer) == 0) throw new GuardException(GuardCode.NotAuthorized);
        }
        finally { Marshal.FreeHGlobal(buffer); }
    }
    private static string ObjectName(nint handle)
    {
        nint buffer = Marshal.AllocHGlobal(128);
        try
        {
            if (handle == 0 || !GetUserObjectInformationW(handle, 2, buffer, 128, out uint size) ||
                size is < 2 or > 128 || size % 2 != 0 || Marshal.ReadInt16(buffer, (int)size - 2) != 0)
                throw new GuardException(GuardCode.NotAuthorized);
            return Marshal.PtrToStringUni(buffer, (int)size / 2 - 1) ?? throw new GuardException(GuardCode.NotAuthorized);
        }
        finally { Marshal.FreeHGlobal(buffer); }
    }
    private static TokenIdentity Token(nint process)
    {
        if (!OpenProcessToken(process, 8, out var token)) throw new GuardException(GuardCode.NotAuthorized);
        using (token)
        {
            Program.Stage = "admission-token-elevation";
            if (TokenInteger(token, 20) != 0) throw new GuardException(GuardCode.NotAuthorized);
            Program.Stage = "admission-token-uiaccess";
            if (TokenInteger(token, 26) != 0) throw new GuardException(GuardCode.NotAuthorized);
            Program.Stage = "admission-token-user";
            string user = TokenSid(token, 1);
            Program.Stage = "admission-token-integrity";
            string integrity = TokenSid(token, 25);
            Program.Stage = "admission-token-session";
            return new(user, integrity, TokenInteger(token, 12));
        }
    }
    private static T TokenBuffer<T>(TokenHandle token, int kind, int capacity, Func<nint, int, T> read)
    {
        if (capacity is < 4 or > 4096) throw new GuardException(GuardCode.ResourceExceeded);
        nint buffer = Marshal.AllocHGlobal(capacity);
        try
        {
            if (!GetTokenInformation(token, kind, buffer, capacity, out int used) || used < 4 || used > capacity)
                throw new GuardException(GuardCode.NotAuthorized);
            return read(buffer, used);
        }
        finally { Marshal.FreeHGlobal(buffer); }
    }
    private static int TokenInteger(TokenHandle token, int kind) => TokenBuffer(token, kind, 4, (buffer, used) =>
        used == 4 ? Marshal.ReadInt32(buffer) : throw new GuardException(GuardCode.NotAuthorized));
    private static string TokenSid(TokenHandle token, int kind)
    {
        // The documented size query is bounded before allocation. A scalar
        // token field uses exactly four bytes; variable SID fields use exactly
        // the reported size, never an unchecked provider-selected allocation.
        if (GetTokenInformation(token, kind, 0, 0, out int needed) || Marshal.GetLastPInvokeError() != 122 ||
            needed < nint.Size + 4 || needed > 4096) throw new GuardException(GuardCode.NotAuthorized);
        return TokenBuffer(token, kind, needed, (buffer, used) =>
    {
        if (used < nint.Size + 4) throw new GuardException(GuardCode.NotAuthorized);
        nint sid = Marshal.ReadIntPtr(buffer);
        long offset = sid.ToInt64() - buffer.ToInt64();
        if (offset < nint.Size + 4 || offset > used - 8 || Marshal.ReadByte(sid) != 1)
            throw new GuardException(GuardCode.NotAuthorized);
        int count = Marshal.ReadByte(sid, 1), length = 8 + count * 4;
        if (count is < 1 or > 15 || length > used - offset) throw new GuardException(GuardCode.NotAuthorized);
        var bytes = new byte[length]; Marshal.Copy(sid, bytes, 0, length);
        return new SecurityIdentifier(bytes, 0).Value; // private identity, never report/log
    });
    }

    private sealed class TokenHandle() : SafeHandleZeroOrMinusOneIsInvalid(true)
    {
        protected override bool ReleaseHandle() => CloseHandle(handle);
    }
    [DllImport("advapi32.dll", SetLastError = true)] [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool OpenProcessToken(nint process, uint access, out TokenHandle token);
    [DllImport("advapi32.dll", SetLastError = true)] [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool GetTokenInformation(TokenHandle token, int kind, nint buffer, int length, out int used);
    [DllImport("kernel32.dll")] [return: MarshalAs(UnmanagedType.Bool)] private static extern bool CloseHandle(nint handle);
    [DllImport("kernel32.dll")] private static extern uint GetCurrentThreadId();
    [DllImport("user32.dll")] private static extern nint GetProcessWindowStation();
    [DllImport("user32.dll")] private static extern nint GetThreadDesktop(uint thread);
    [DllImport("user32.dll")] private static extern nint OpenInputDesktop(uint flags, [MarshalAs(UnmanagedType.Bool)] bool inherit, uint access);
    [DllImport("user32.dll")] [return: MarshalAs(UnmanagedType.Bool)] private static extern bool CloseDesktop(nint desktop);
    [DllImport("user32.dll")] [return: MarshalAs(UnmanagedType.Bool)] private static extern bool IsWindow(nint window);
    [DllImport("user32.dll")] private static extern uint GetWindowThreadProcessId(nint window, out uint process);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool GetUserObjectInformationW(nint handle, int kind, nint buffer, uint capacity, out uint used);
    [DllImport("wtsapi32.dll", CharSet = CharSet.Unicode)] [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool WTSQuerySessionInformationW(nint server, int session, int kind, out nint buffer, out uint used);
    [DllImport("wtsapi32.dll")] private static extern void WTSFreeMemory(nint buffer);
}
