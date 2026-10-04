using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Security.Principal;
using Microsoft.Win32.SafeHandles;

namespace DualSurface.UiaCapture;

// Internal constructor is for a future fixed launcher-created Process only.
// No CLI, model PID/HWND/thread, desktop traversal or external process lookup.
internal sealed class OwnedWindowsAdmission
{
    private sealed record TokenIdentity(string User, string Integrity, int Session);
    private readonly Process owned;
    private readonly long birth;
    private readonly TokenIdentity admitted;
    public nint Main { get; }
    public uint Thread { get; }
    public int ProcessId => owned.Id;
    public long Birth => birth;

    public OwnedWindowsAdmission(Process owned, CaptureBudget budget)
    {
        this.owned = owned;
        budget.CheckTime();
        birth = owned.StartTime.ToUniversalTime().Ticks;
        admitted = Token(owned.Handle, budget);
        CheckContext(budget);
        // Read MainWindowHandle ONCE while trusted setup has no modal or popup.
        // Later captures/fences retain this exact main, not a refreshed candidate.
        owned.Refresh(); Main = owned.MainWindowHandle;
        Thread = GetWindowThreadProcessId(Main, out uint process);
        if (Main == 0 || !IsWindow(Main) || Thread == 0 || process != (uint)owned.Id ||
            GetWindow(Main, 4) != 0) Refuse();
        CheckDesktop(GetThreadDesktop(Thread), budget);
        budget.CheckTime();
    }

    public OwnedWindowFrame Observe(ExpectedAuxiliary expected, CaptureBudget budget)
    {
        CheckContext(budget);
        if (!IsWindow(Main) || GetWindowThreadProcessId(Main, out uint process) != Thread ||
            process != (uint)owned.Id) Refuse();
        CheckDesktop(GetThreadDesktop(Thread), budget);
        var handles = OwnedWindowTopology.Enumerate(callback =>
        {
            EnumWindowCallback native = (handle, _) => callback(handle);
            bool result = EnumThreadWindows(Thread, native, 0);
            GC.KeepAlive(native);
            return result;
        }, budget);
        var windows = new List<OwnedWindow>();
        foreach (nint handle in handles)
        {
            budget.CheckTime();
            uint thread = GetWindowThreadProcessId(handle, out uint pid);
            if (!IsWindow(handle) || thread != Thread || pid != (uint)owned.Id) Refuse();
            CheckDesktop(GetThreadDesktop(thread), budget);
            windows.Add(new(handle, thread, pid, GetWindow(handle, 4), IsWindowVisible(handle), IsWindowEnabled(handle)));
            if (!IsWindow(handle) || GetWindowThreadProcessId(handle, out uint finalPid) != thread || finalPid != pid) Refuse();
        }
        budget.CheckTime();
        return OwnedWindowTopology.Admit(Main, Thread, (uint)owned.Id, expected, windows);
    }
    public void RequirePeerBoundary(int nativeWindow, OwnedWindowFrame frame, CaptureBudget budget)
    {
        budget.CheckTime();
        if (nativeWindow == 0) return; // logical node; cannot establish a new root
        nint handle = nativeWindow;
        if (!IsWindow(handle)) Refuse();
        uint thread = GetWindowThreadProcessId(handle, out uint process);
        if (thread != Thread || process != (uint)owned.Id) Refuse();
        CheckDesktop(GetThreadDesktop(thread), budget);
        nint root = GetAncestor(handle, 2); // GA_ROOT, exact owned handle only
        OwnedWindowTopology.RequirePeerBoundary(frame, new(handle, thread, process, 0, false, false), root);
        budget.CheckTime();
        if (!IsWindow(handle) || GetWindowThreadProcessId(handle, out uint finalProcess) != thread ||
            finalProcess != process || GetAncestor(handle, 2) != root) Refuse();
    }

    private void CheckContext(CaptureBudget budget)
    {
        budget.CheckTime();
        if (owned.HasExited || owned.StartTime.ToUniversalTime().Ticks != birth) Refuse();
        using var self = Process.GetCurrentProcess();
        var worker = Token(self.Handle, budget);
        var subject = Token(owned.Handle, budget);
        if (subject != admitted || subject != worker || subject.Session != owned.SessionId ||
            worker.Session != self.SessionId || !Environment.UserInteractive) Refuse();
        nint state = 0;
        try
        {
            budget.CheckTime();
            if (!WTSQuerySessionInformationW(0, subject.Session, 8, out state, out uint size) ||
                state == 0 || size != 4 || Marshal.ReadInt32(state) != 0) Refuse();
        }
        finally { if (state != 0) WTSFreeMemory(state); }
        if (ObjectName(GetProcessWindowStation(), budget) != "WinSta0") Refuse();
        CheckDesktop(GetThreadDesktop(GetCurrentThreadId()), budget);
        nint input = OpenInputDesktop(0, false, 1); // READOBJECTS only
        if (input == 0) Refuse();
        try { CheckDesktop(input, budget); }
        finally { CloseDesktop(input); }
        budget.CheckTime();
    }
    private static void CheckDesktop(nint desktop, CaptureBudget budget)
    {
        if (desktop == 0 || ObjectName(desktop, budget) != "Default") Refuse();
        nint buffer = Marshal.AllocHGlobal(4);
        try
        {
            budget.CheckTime();
            if (!GetUserObjectInformationW(desktop, 6, buffer, 4, out uint size) ||
                size != 4 || Marshal.ReadInt32(buffer) == 0) Refuse();
        }
        finally { Marshal.FreeHGlobal(buffer); }
    }
    private static string ObjectName(nint handle, CaptureBudget budget)
    {
        nint buffer = Marshal.AllocHGlobal(128);
        try
        {
            budget.CheckTime();
            if (handle == 0) Refuse();
            if (!GetUserObjectInformationW(handle, 2, buffer, 128, out uint size) ||
                size is < 2 or > 128 || size % 2 != 0 || Marshal.ReadInt16(buffer, (int)size - 2) != 0) Refuse();
            return Marshal.PtrToStringUni(buffer, (int)size / 2 - 1) ?? throw new CaptureException(CaptureCode.Unavailable);
        }
        finally { Marshal.FreeHGlobal(buffer); }
    }
    private static TokenIdentity Token(nint process, CaptureBudget budget)
    {
        budget.CheckTime();
        if (!OpenProcessToken(process, 8, out var token)) Refuse();
        using (token)
        {
            if (TokenInteger(token, 20, budget) != 0 || TokenInteger(token, 26, budget) != 0) Refuse();
            return new(TokenSid(token, 1, budget), TokenSid(token, 25, budget), TokenInteger(token, 12, budget));
        }
    }
    private static T TokenBuffer<T>(TokenHandle token, int kind, int capacity, CaptureBudget budget, Func<nint, int, T> read)
    {
        budget.CheckTime();
        if (capacity is < 4 or > 4096) Refuse();
        nint buffer = Marshal.AllocHGlobal(capacity);
        try
        {
            if (!GetTokenInformation(token, kind, buffer, capacity, out int used) || used < 4 || used > capacity) Refuse();
            T result = read(buffer, used); budget.CheckTime(); return result;
        }
        finally { Marshal.FreeHGlobal(buffer); }
    }
    private static int TokenInteger(TokenHandle token, int kind, CaptureBudget budget) =>
        TokenBuffer(token, kind, 4, budget, (buffer, used) => used == 4 ? Marshal.ReadInt32(buffer) : throw new CaptureException(CaptureCode.Unavailable));
    private static string TokenSid(TokenHandle token, int kind, CaptureBudget budget)
    {
        budget.CheckTime();
        if (GetTokenInformation(token, kind, 0, 0, out int needed) || Marshal.GetLastPInvokeError() != 122 ||
            needed < nint.Size + 4 || needed > 4096) Refuse();
        return TokenBuffer(token, kind, needed, budget, (buffer, used) =>
        {
            if (used < nint.Size + 4) Refuse();
            nint sid = Marshal.ReadIntPtr(buffer);
            long offset = sid.ToInt64() - buffer.ToInt64();
            if (offset < nint.Size + 4 || offset > used - 8 || Marshal.ReadByte(sid) != 1) Refuse();
            int count = Marshal.ReadByte(sid, 1), length = 8 + count * 4;
            if (count is < 1 or > 15 || length > used - offset) Refuse();
            var bytes = new byte[length]; Marshal.Copy(sid, bytes, 0, length);
            return new SecurityIdentifier(bytes, 0).Value; // private, never serialized
        });
    }
    [System.Diagnostics.CodeAnalysis.DoesNotReturn]
    private static void Refuse() => throw new CaptureException(CaptureCode.Unavailable);
    private sealed class TokenHandle() : SafeHandleZeroOrMinusOneIsInvalid(true)
    { protected override bool ReleaseHandle() => CloseHandle(handle); }
    private delegate bool EnumWindowCallback(nint window, nint state);
    [DllImport("user32.dll")] [return: MarshalAs(UnmanagedType.Bool)] private static extern bool EnumThreadWindows(uint thread, EnumWindowCallback callback, nint state);
    [DllImport("advapi32.dll", SetLastError = true)] [return: MarshalAs(UnmanagedType.Bool)] private static extern bool OpenProcessToken(nint process, uint access, out TokenHandle token);
    [DllImport("advapi32.dll", SetLastError = true)] [return: MarshalAs(UnmanagedType.Bool)] private static extern bool GetTokenInformation(TokenHandle token, int kind, nint buffer, int length, out int used);
    [DllImport("kernel32.dll")] [return: MarshalAs(UnmanagedType.Bool)] private static extern bool CloseHandle(nint handle);
    [DllImport("kernel32.dll")] private static extern uint GetCurrentThreadId();
    [DllImport("user32.dll")] private static extern nint GetProcessWindowStation();
    [DllImport("user32.dll")] private static extern nint GetThreadDesktop(uint thread);
    [DllImport("user32.dll")] private static extern nint OpenInputDesktop(uint flags, [MarshalAs(UnmanagedType.Bool)] bool inherit, uint access);
    [DllImport("user32.dll")] [return: MarshalAs(UnmanagedType.Bool)] private static extern bool CloseDesktop(nint desktop);
    [DllImport("user32.dll")] [return: MarshalAs(UnmanagedType.Bool)] private static extern bool IsWindow(nint window);
    [DllImport("user32.dll")] [return: MarshalAs(UnmanagedType.Bool)] private static extern bool IsWindowVisible(nint window);
    [DllImport("user32.dll")] [return: MarshalAs(UnmanagedType.Bool)] private static extern bool IsWindowEnabled(nint window);
    [DllImport("user32.dll")] private static extern uint GetWindowThreadProcessId(nint window, out uint process);
    [DllImport("user32.dll")] private static extern nint GetWindow(nint window, uint command);
    [DllImport("user32.dll")] private static extern nint GetAncestor(nint window, uint flags);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] [return: MarshalAs(UnmanagedType.Bool)] private static extern bool GetUserObjectInformationW(nint handle, int kind, nint buffer, uint capacity, out uint used);
    [DllImport("wtsapi32.dll", CharSet = CharSet.Unicode)] [return: MarshalAs(UnmanagedType.Bool)] private static extern bool WTSQuerySessionInformationW(nint server, int session, int kind, out nint buffer, out uint used);
    [DllImport("wtsapi32.dll")] private static extern void WTSFreeMemory(nint buffer);
}
