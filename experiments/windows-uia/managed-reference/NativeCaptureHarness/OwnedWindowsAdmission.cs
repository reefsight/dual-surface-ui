using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Security.Principal;
using Microsoft.Win32.SafeHandles;

namespace DualSurface.UiaCapture;

internal enum AdmissionCheck { SubjectToken, WorkerToken, CurrentSubjectToken, ProcessLiveness,
    TokenContext, SessionActive, WindowStation, WorkerDesktop, InputDesktopOpen, InputDesktop, AnchoredMain, MainDesktop }
internal enum AdmissionGuard { TokenOpen, TokenElevationUiaccess, TokenBufferBound, TokenBufferResult,
    TokenIntegerShape, TokenSidSize, TokenSidPointer, TokenSidBody, Liveness, IdentitySession,
    SessionQueryState, NameQuery, NameValue, DesktopNameOrNull, DesktopInput, InputOpen, WindowBoundary }

// Constructor-only passive notification. No operation delegate/native value is
// received or returned; every refusal still throws the original closed code.
internal sealed class ConstructorAdmissionTrace(Action<AdmissionCheck, AdmissionGuard>? observer)
{
    private Action<AdmissionCheck, AdmissionGuard>? observer = observer;
    private AdmissionCheck? check;
    private static readonly string[] CheckLabels = ["subject-token", "worker-token", "current-subject-token", "process-liveness",
        "token-context", "session-active", "window-station", "worker-desktop", "input-desktop-open", "input-desktop", "anchored-main", "main-desktop"];
    private static readonly string[] GuardLabels = ["token-open", "token-elevation-uiaccess", "token-buffer-bound", "token-buffer-result",
        "token-integer-shape", "token-sid-size", "token-sid-pointer", "token-sid-body", "liveness", "identity-session",
        "session-query-state", "name-query", "name-value", "desktop-name-or-null", "desktop-input", "input-open", "window-boundary"];
    public void SetCheck(AdmissionCheck value) => check = value;
    public void Clear() { observer = null; check = null; }
    internal static bool TryLabels(AdmissionCheck check, AdmissionGuard guard, out string? checkLabel, out string? guardLabel)
    {
        checkLabel = null; guardLabel = null;
        bool allowed = check switch
        {
            AdmissionCheck.SubjectToken or AdmissionCheck.WorkerToken or AdmissionCheck.CurrentSubjectToken => guard is
                AdmissionGuard.TokenOpen or AdmissionGuard.TokenElevationUiaccess or AdmissionGuard.TokenBufferBound or AdmissionGuard.TokenBufferResult or
                AdmissionGuard.TokenIntegerShape or AdmissionGuard.TokenSidSize or AdmissionGuard.TokenSidPointer or AdmissionGuard.TokenSidBody,
            AdmissionCheck.ProcessLiveness => guard == AdmissionGuard.Liveness,
            AdmissionCheck.TokenContext => guard == AdmissionGuard.IdentitySession,
            AdmissionCheck.SessionActive => guard == AdmissionGuard.SessionQueryState,
            AdmissionCheck.WindowStation => guard is AdmissionGuard.NameQuery or AdmissionGuard.NameValue,
            AdmissionCheck.WorkerDesktop or AdmissionCheck.InputDesktop or AdmissionCheck.MainDesktop => guard is
                AdmissionGuard.NameQuery or AdmissionGuard.DesktopNameOrNull or AdmissionGuard.DesktopInput,
            AdmissionCheck.InputDesktopOpen => guard == AdmissionGuard.InputOpen,
            AdmissionCheck.AnchoredMain => guard == AdmissionGuard.WindowBoundary, _ => false,
        };
        if (!allowed) return false;
        checkLabel = CheckLabels[(int)check]; guardLabel = GuardLabels[(int)guard]; return true;
    }
    [System.Diagnostics.CodeAnalysis.DoesNotReturn]
    public void Refuse(AdmissionGuard guard)
    {
        try
        {
            if (observer != null && check is AdmissionCheck current && TryLabels(current, guard, out _, out _)) observer(current, guard);
        }
        catch { /* A passive observer fault cannot replace or permit the original refusal. */ }
        throw new CaptureException(CaptureCode.Unavailable);
    }
    [System.Diagnostics.CodeAnalysis.DoesNotReturn]
    public T Refuse<T>(AdmissionGuard guard) { Refuse(guard); throw new InvalidOperationException("unreachable"); }
}

// Internal constructor is for a future fixed launcher-created Process only.
// No CLI, model PID/HWND/thread, desktop traversal or external process lookup.
internal sealed class OwnedWindowsAdmission
{
    private sealed record TokenIdentity(string User, string Integrity, int Session);
    private readonly Process owned;
    private readonly long birth;
    private readonly TokenIdentity admitted;
    private readonly ConstructorAdmissionTrace trace;
    public nint Main { get; }
    public uint Thread { get; }
    public int ProcessId => owned.Id;
    public long Birth => birth;

    public OwnedWindowsAdmission(Process owned, CaptureBudget budget, Action<AdmissionCheck, AdmissionGuard>? refusalObserver = null)
    {
        this.owned = owned;
        trace = new(refusalObserver);
        try
        {
            budget.CheckTime();
            birth = owned.StartTime.ToUniversalTime().Ticks;
            trace.SetCheck(AdmissionCheck.SubjectToken);
            admitted = Token(owned.Handle, budget);
            CheckContext(budget);
            // Read MainWindowHandle ONCE while trusted setup has no modal or popup.
            // Later captures/fences retain this exact main, not a refreshed candidate.
            trace.SetCheck(AdmissionCheck.AnchoredMain);
            owned.Refresh(); Main = owned.MainWindowHandle;
            Thread = GetWindowThreadProcessId(Main, out uint process);
            if (Main == 0 || !IsWindow(Main) || Thread == 0 || process != (uint)owned.Id ||
                GetWindow(Main, 4) != 0) Refuse(AdmissionGuard.WindowBoundary);
            trace.SetCheck(AdmissionCheck.MainDesktop);
            CheckDesktop(GetThreadDesktop(Thread), budget);
            budget.CheckTime();
        }
        finally { trace.Clear(); } // success, guard, deadline and SDK fault all expire the capability
    }

    public OwnedWindowFrame Observe(ExpectedAuxiliary expected, CaptureBudget budget)
    {
        CheckContext(budget);
        if (!IsWindow(Main) || GetWindowThreadProcessId(Main, out uint process) != Thread ||
            process != (uint)owned.Id) Refuse(AdmissionGuard.WindowBoundary);
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
            if (!IsWindow(handle) || thread != Thread || pid != (uint)owned.Id) Refuse(AdmissionGuard.WindowBoundary);
            CheckDesktop(GetThreadDesktop(thread), budget);
            windows.Add(new(handle, thread, pid, GetWindow(handle, 4), IsWindowVisible(handle), IsWindowEnabled(handle)));
            if (!IsWindow(handle) || GetWindowThreadProcessId(handle, out uint finalPid) != thread || finalPid != pid) Refuse(AdmissionGuard.WindowBoundary);
        }
        budget.CheckTime();
        return OwnedWindowTopology.Admit(Main, Thread, (uint)owned.Id, expected, windows);
    }
    public void RequirePeerBoundary(int nativeWindow, OwnedWindowFrame frame, CaptureBudget budget)
    {
        budget.CheckTime();
        if (nativeWindow == 0) return; // logical node; cannot establish a new root
        nint handle = nativeWindow;
        if (!IsWindow(handle)) Refuse(AdmissionGuard.WindowBoundary);
        uint thread = GetWindowThreadProcessId(handle, out uint process);
        if (thread != Thread || process != (uint)owned.Id) Refuse(AdmissionGuard.WindowBoundary);
        CheckDesktop(GetThreadDesktop(thread), budget);
        nint root = GetAncestor(handle, 2); // GA_ROOT, exact owned handle only
        OwnedWindowTopology.RequirePeerBoundary(frame, new(handle, thread, process, 0, false, false), root);
        budget.CheckTime();
        if (!IsWindow(handle) || GetWindowThreadProcessId(handle, out uint finalProcess) != thread ||
            finalProcess != process || GetAncestor(handle, 2) != root) Refuse(AdmissionGuard.WindowBoundary);
    }

    private void CheckContext(CaptureBudget budget)
    {
        budget.CheckTime();
        trace.SetCheck(AdmissionCheck.ProcessLiveness);
        if (owned.HasExited || owned.StartTime.ToUniversalTime().Ticks != birth) Refuse(AdmissionGuard.Liveness);
        using var self = Process.GetCurrentProcess();
        trace.SetCheck(AdmissionCheck.WorkerToken);
        var worker = Token(self.Handle, budget);
        trace.SetCheck(AdmissionCheck.CurrentSubjectToken);
        var subject = Token(owned.Handle, budget);
        trace.SetCheck(AdmissionCheck.TokenContext);
        if (subject != admitted || subject != worker || subject.Session != owned.SessionId ||
            worker.Session != self.SessionId || !Environment.UserInteractive) Refuse(AdmissionGuard.IdentitySession);
        nint state = 0;
        trace.SetCheck(AdmissionCheck.SessionActive);
        try
        {
            budget.CheckTime();
            if (!WTSQuerySessionInformationW(0, subject.Session, 8, out state, out uint size) ||
                state == 0 || size != 4 || Marshal.ReadInt32(state) != 0) Refuse(AdmissionGuard.SessionQueryState);
        }
        finally { if (state != 0) WTSFreeMemory(state); }
        trace.SetCheck(AdmissionCheck.WindowStation);
        if (ObjectName(GetProcessWindowStation(), budget) != "WinSta0") Refuse(AdmissionGuard.NameValue);
        trace.SetCheck(AdmissionCheck.WorkerDesktop);
        CheckDesktop(GetThreadDesktop(GetCurrentThreadId()), budget);
        trace.SetCheck(AdmissionCheck.InputDesktopOpen);
        nint input = OpenInputDesktop(0, false, 1); // READOBJECTS only
        if (input == 0) Refuse(AdmissionGuard.InputOpen);
        trace.SetCheck(AdmissionCheck.InputDesktop);
        try { CheckDesktop(input, budget); }
        finally { CloseDesktop(input); }
        budget.CheckTime();
    }
    private void CheckDesktop(nint desktop, CaptureBudget budget)
    {
        if (desktop == 0 || ObjectName(desktop, budget) != "Default") Refuse(AdmissionGuard.DesktopNameOrNull);
        nint buffer = Marshal.AllocHGlobal(4);
        try
        {
            budget.CheckTime();
            if (!GetUserObjectInformationW(desktop, 6, buffer, 4, out uint size) ||
                size != 4 || Marshal.ReadInt32(buffer) == 0) Refuse(AdmissionGuard.DesktopInput);
        }
        finally { Marshal.FreeHGlobal(buffer); }
    }
    private string ObjectName(nint handle, CaptureBudget budget)
    {
        nint buffer = Marshal.AllocHGlobal(128);
        try
        {
            budget.CheckTime();
            if (handle == 0) Refuse(AdmissionGuard.NameQuery);
            if (!GetUserObjectInformationW(handle, 2, buffer, 128, out uint size) ||
                size is < 2 or > 128 || size % 2 != 0 || Marshal.ReadInt16(buffer, (int)size - 2) != 0) Refuse(AdmissionGuard.NameQuery);
            return Marshal.PtrToStringUni(buffer, (int)size / 2 - 1) ?? trace.Refuse<string>(AdmissionGuard.NameQuery);
        }
        finally { Marshal.FreeHGlobal(buffer); }
    }
    private TokenIdentity Token(nint process, CaptureBudget budget)
    {
        budget.CheckTime();
        if (!OpenProcessToken(process, 8, out var token)) Refuse(AdmissionGuard.TokenOpen);
        using (token)
        {
            if (TokenInteger(token, 20, budget) != 0 || TokenInteger(token, 26, budget) != 0) Refuse(AdmissionGuard.TokenElevationUiaccess);
            return new(TokenSid(token, 1, budget), TokenSid(token, 25, budget), TokenInteger(token, 12, budget));
        }
    }
    private T TokenBuffer<T>(TokenHandle token, int kind, int capacity, CaptureBudget budget, Func<nint, int, T> read)
    {
        budget.CheckTime();
        if (capacity is < 4 or > 4096) Refuse(AdmissionGuard.TokenBufferBound);
        nint buffer = Marshal.AllocHGlobal(capacity);
        try
        {
            if (!GetTokenInformation(token, kind, buffer, capacity, out int used) || used < 4 || used > capacity) Refuse(AdmissionGuard.TokenBufferResult);
            T result = read(buffer, used); budget.CheckTime(); return result;
        }
        finally { Marshal.FreeHGlobal(buffer); }
    }
    private int TokenInteger(TokenHandle token, int kind, CaptureBudget budget) =>
        TokenBuffer(token, kind, 4, budget, (buffer, used) => used == 4 ? Marshal.ReadInt32(buffer) : trace.Refuse<int>(AdmissionGuard.TokenIntegerShape));
    private string TokenSid(TokenHandle token, int kind, CaptureBudget budget)
    {
        budget.CheckTime();
        if (GetTokenInformation(token, kind, 0, 0, out int needed) || Marshal.GetLastPInvokeError() != 122 ||
            needed < nint.Size + 4 || needed > 4096) Refuse(AdmissionGuard.TokenSidSize);
        return TokenBuffer(token, kind, needed, budget, (buffer, used) =>
        {
            if (used < nint.Size + 4) Refuse(AdmissionGuard.TokenSidPointer);
            nint sid = Marshal.ReadIntPtr(buffer);
            long offset = sid.ToInt64() - buffer.ToInt64();
            if (offset < nint.Size + 4 || offset > used - 8 || Marshal.ReadByte(sid) != 1) Refuse(AdmissionGuard.TokenSidPointer);
            int count = Marshal.ReadByte(sid, 1), length = 8 + count * 4;
            if (count is < 1 or > 15 || length > used - offset) Refuse(AdmissionGuard.TokenSidBody);
            var bytes = new byte[length]; Marshal.Copy(sid, bytes, 0, length);
            return new SecurityIdentifier(bytes, 0).Value; // private, never serialized
        });
    }
    [System.Diagnostics.CodeAnalysis.DoesNotReturn]
    private void Refuse(AdmissionGuard guard) => trace.Refuse(guard);
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
