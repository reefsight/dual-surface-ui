using System.IO;
using System.Text.Json;

namespace DualSurface.UiaReference;

internal sealed record StartupSnapshot(string Stage, string Process, string Window,
    string StateRecords, string ResetAckRecords, string Cpu, string Resident);

// Failure-only development context. No category participates in admission,
// readiness, receipt eligibility, or success-report publication.
internal static class StartupDiagnostics
{
    internal const int MaximumBytes = 1024;
    internal const string FileName = "startup-diagnostic.json";

    internal static StartupSnapshot Collect(string stage, Func<bool> alive, Func<bool> window,
        Func<bool> stateRecords, Func<bool> resetAckRecords, Func<long> cpuTicks, Func<long> residentBytes)
    {
        RequireStage(stage); // Reject before optional observations.
        return new(stage, Read(() => alive() ? "alive" : "exited"),
            Read(() => window() ? "present" : "absent"),
            Read(() => stateRecords() ? "present" : "absent"),
            Read(() => resetAckRecords() ? "present" : "absent"),
            Read(() => Cpu(cpuTicks())), Read(() => Resident(residentBytes())));
    }

    internal static string Cpu(long ticks) => ticks switch
    {
        < 0 => "unknown", 0 => "zero", < 100 * TimeSpan.TicksPerMillisecond => "under_100ms",
        < TimeSpan.TicksPerSecond => "under_1s", _ => "at_least_1s"
    };
    internal static string Resident(long bytes) => bytes switch
    {
        < 0 => "unknown", < 64L * 1024 * 1024 => "under_64mib",
        < 256L * 1024 * 1024 => "under_256mib", _ => "at_least_256mib"
    };
    private static string Read(Func<string> observe)
    {
        try { return observe(); }
        catch { return "unknown"; } // No exception text/formatting or substitute zero.
    }
    private static void RequireStage(string stage)
    {
        if (stage is not ("launch-window" or "launch-state")) throw new GuardException(GuardCode.PreconditionFailed);
    }
    internal static byte[] Encode(StartupSnapshot value)
    {
        RequireStage(value.Stage);
        bool Presence(string category) => category is "present" or "absent" or "unknown";
        if (value.Process is not ("alive" or "exited" or "unknown") || !Presence(value.Window) ||
            !Presence(value.StateRecords) || !Presence(value.ResetAckRecords) ||
            value.Cpu is not ("zero" or "under_100ms" or "under_1s" or "at_least_1s" or "unknown") ||
            value.Resident is not ("under_64mib" or "under_256mib" or "at_least_256mib" or "unknown"))
            throw new GuardException(GuardCode.PreconditionFailed);
        byte[] bytes = JsonSerializer.SerializeToUtf8Bytes(new
        {
            schemaVersion = "0.1", kind = "p4.3-owned-startup-diagnostic", stage = value.Stage,
            process = value.Process, window = value.Window, stateRecords = value.StateRecords,
            resetAckRecords = value.ResetAckRecords, cpu = value.Cpu, resident = value.Resident
        });
        if (bytes.Length > MaximumBytes) throw new GuardException(GuardCode.ResourceExceeded);
        return bytes;
    }

    internal static bool TryPublish(string output, Func<StartupSnapshot> collect)
    {
        try
        {
            // Caller supplies only its already admitted output directory. Recheck
            // the root/directory alias flags; this is not an atomic filesystem fence.
            string directory = Path.GetFullPath(output);
            string evidenceRoot = Path.GetFullPath(Path.Combine(Path.GetTempPath(), "dual-surface-ui-native-evidence"));
            if (!directory.StartsWith(evidenceRoot + Path.DirectorySeparatorChar, StringComparison.OrdinalIgnoreCase) ||
                !Directory.Exists(directory) || Aliased(evidenceRoot) || Aliased(directory)) return false;
            byte[] bytes = Encode(collect()); // Shape/cap before creating a file.
            using var file = new FileStream(Path.Combine(directory, FileName), FileMode.CreateNew, FileAccess.Write, FileShare.None);
            file.Write(bytes);
            return true;
        }
        catch { return false; } // Optional faults/collision never replace terminal failure.
    }
    private static bool Aliased(string path) => (File.GetAttributes(path) & FileAttributes.ReparsePoint) != 0;
}
