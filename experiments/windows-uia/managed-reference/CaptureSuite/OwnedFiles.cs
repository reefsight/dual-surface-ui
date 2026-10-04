using System.IO;
using System.Runtime.InteropServices;
using System.Text;
using Microsoft.Win32.SafeHandles;

namespace DualSurface.UiaCapture;

// Only launcher-admitted fixed paths. Limits constrain copied data, not a hostile
// local administrator/filesystem or all provider-internal allocations.
internal static class OwnedFiles
{
    public static string CanonicalDirectory(string path)
    {
        RequireDirectory(path);
        using var handle = CreateFile(Path.GetFullPath(path), 0, 7, 0, 3, 0x02200000, 0);
        if (handle.IsInvalid || !GetFileInformationByHandle(handle, out var info) ||
            (info.Attributes & (uint)FileAttributes.Directory) == 0 || (info.Attributes & (uint)FileAttributes.ReparsePoint) != 0) Refuse();
        var target = new StringBuilder(32768);
        uint length = GetFinalPathNameByHandle(handle, target, (uint)target.Capacity, 0);
        if (length == 0 || length >= target.Capacity || !target.ToString().StartsWith(@"\\?\", StringComparison.Ordinal) ||
            target.ToString().StartsWith(@"\\?\UNC\", StringComparison.OrdinalIgnoreCase)) Refuse();
        return Path.GetFullPath(target.ToString()[4..]);
    }
    public static void RequireDirectory(string path)
    {
        var current = new DirectoryInfo(Path.GetFullPath(path));
        while (current != null)
        {
            if (!current.Exists || (current.Attributes & FileAttributes.ReparsePoint) != 0) Refuse();
            current = current.Parent;
        }
    }
    public static byte[] Read(string path, int cap)
    {
        if (cap is < 1 or > 8388608) Refuse();
        RequireDirectory(Path.GetDirectoryName(path) ?? throw new CaptureException(CaptureCode.Unavailable));
        using var stream = new FileStream(path, FileMode.Open, FileAccess.Read, FileShare.Read, 4096, FileOptions.SequentialScan);
        RequireHandle(stream.SafeFileHandle, path);
        if (stream.Length > cap) Limit();
        var buffer = new byte[cap + 1]; int count = 0;
        while (count < buffer.Length)
        {
            int read = stream.Read(buffer, count, buffer.Length - count);
            if (read == 0) break;
            count += read;
            if (count > cap) Limit();
        }
        RequireHandle(stream.SafeFileHandle, path);
        return buffer.AsSpan(0, count).ToArray();
    }
    public static void WriteNew(string path, byte[] bytes, int cap)
    {
        if (cap is < 1 or > CaptureLimits.ReportBytes || bytes.Length > cap) Limit();
        RequireDirectory(Path.GetDirectoryName(path) ?? throw new CaptureException(CaptureCode.Unavailable));
        using var stream = new FileStream(path, FileMode.CreateNew, FileAccess.Write, FileShare.Read);
        RequireHandle(stream.SafeFileHandle, path); // before writing any payload
        stream.Write(bytes);
        RequireHandle(stream.SafeFileHandle, path);
    }
    private static void RequireHandle(SafeFileHandle handle, string path)
    {
        if (GetFileType(handle) != 1 || !GetFileInformationByHandle(handle, out var info) ||
            info.Links != 1 || (info.Attributes & (uint)(FileAttributes.Directory | FileAttributes.ReparsePoint)) != 0) Refuse();
        var target = new StringBuilder(32768);
        uint length = GetFinalPathNameByHandle(handle, target, (uint)target.Capacity, 0);
        if (length == 0 || length >= target.Capacity ||
            !string.Equals(target.ToString(), @"\\?\" + Path.Combine(CanonicalDirectory(Path.GetDirectoryName(path)!), Path.GetFileName(path)),
                StringComparison.OrdinalIgnoreCase)) Refuse();
    }
    [StructLayout(LayoutKind.Sequential)] private struct FileInfo
    {
        public uint Attributes;
        public System.Runtime.InteropServices.ComTypes.FILETIME Creation, Access, Write;
        public uint Volume, SizeHigh, SizeLow, Links, IndexHigh, IndexLow;
    }
    [DllImport("kernel32.dll")] private static extern uint GetFileType(SafeFileHandle file);
    [DllImport("kernel32.dll", EntryPoint = "CreateFileW", CharSet = CharSet.Unicode)] private static extern SafeFileHandle CreateFile(
        string path, uint access, uint sharing, nint security, uint creation, uint flags, nint template);
    [DllImport("kernel32.dll")] private static extern bool GetFileInformationByHandle(SafeFileHandle file, out FileInfo info);
    [DllImport("kernel32.dll", CharSet = CharSet.Unicode)] private static extern uint GetFinalPathNameByHandle(
        SafeFileHandle file, StringBuilder path, uint length, uint flags);
    [System.Diagnostics.CodeAnalysis.DoesNotReturn] private static void Refuse() => throw new CaptureException(CaptureCode.InvalidObservation);
    [System.Diagnostics.CodeAnalysis.DoesNotReturn] private static void Limit() => throw new CaptureException(CaptureCode.ResourceExceeded);
}
