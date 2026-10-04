param()

$ErrorActionPreference = 'Stop'
$repoRoot = Split-Path -Parent $PSScriptRoot
$referenceRoot = Join-Path $repoRoot 'experiments/windows-uia/managed-reference'
$sdkRoot = Join-Path ([IO.Path]::GetTempPath()) 'dual-surface-ui-dotnet-10.0.401'
$sdkExe = Join-Path $sdkRoot 'dotnet.exe'
$sdkMarker = Join-Path $sdkRoot '.p4.2-sdk-ready'
if (-not (Test-Path -LiteralPath $sdkExe) -or -not (Test-Path -LiteralPath $sdkMarker)) { throw 'Pinned cached SDK required; no installation attempted.' }
if ([IO.File]::ReadAllText($sdkMarker) -ne '24b670ad3d923bfcf47df6c3b034152398b42f6dbc388e10d783aee1cfb5e5817d399fc0ae2a12cfa822a55e61d34830ccb15c50ef6efee437ab874bb7c79430') { throw 'SDK marker mismatch.' }
if ((Get-Item -LiteralPath $sdkRoot).Attributes -band [IO.FileAttributes]::ReparsePoint) { throw 'SDK cache is aliased.' }
$env:DOTNET_ROOT = $sdkRoot
$env:DOTNET_CLI_HOME = Join-Path $repoRoot '.tools/cli-home'
$env:NUGET_PACKAGES = Join-Path $repoRoot '.tools/nuget-packages'
$env:DOTNET_CLI_TELEMETRY_OPTOUT = '1'
$env:DOTNET_GENERATE_ASPNET_CERTIFICATE = 'false'
Push-Location $referenceRoot
try {
    if ((& $sdkExe --version) -ne '10.0.401') { throw 'SDK version mismatch.' }
    & $sdkExe build CaptureHarness/CaptureHarness.csproj -c Release --nologo
    if ($LASTEXITCODE -ne 0) { throw 'Capture foundation build failed.' }
    $harness = Join-Path $referenceRoot 'CaptureHarness/bin/Release/net10.0-windows/DualSurface.UiaCaptureHarness.dll'
    $start = [Diagnostics.ProcessStartInfo]::new($sdkExe)
    $start.UseShellExecute = $false
    $start.CreateNoWindow = $true
    $start.RedirectStandardOutput = $true
    $start.RedirectStandardError = $true
    foreach ($argument in @($harness, '--unit')) { $start.ArgumentList.Add($argument) }
    $worker = [Diagnostics.Process]::Start($start)
    try {
        $stdout = $worker.StandardOutput.ReadToEndAsync()
        $stderr = $worker.StandardError.ReadToEndAsync()
        if (-not $worker.WaitForExit(30000)) {
            $worker.Kill($true)
            $worker.WaitForExit(5000) | Out-Null
            throw 'Capture unit worker exceeded fixed 30-second deadline.'
        }
        $out = $stdout.GetAwaiter().GetResult()
        $err = $stderr.GetAwaiter().GetResult()
        if ($out.Length -gt 16384 -or $err.Length -gt 256) { throw 'Unit worker output budget exceeded.' }
        # SDK/CLR crash stderr is not guaranteed to follow Program's fixed codes.
        # Refuse it without echoing arbitrary exception/profile/path text.
        if ($err) { throw 'Capture unit worker reported stderr; raw diagnostic withheld.' }
        if ($worker.ExitCode -ne 0) { throw 'Capture unit worker failed; no native execution occurred.' }
        # Validate the actual C# publication, not an oracle-generated sample.
        Push-Location $repoRoot
        try {
            $out | & node scripts/verify-p4.3-capture-unit.mjs
            if ($LASTEXITCODE -ne 0) { throw 'Capture unit serialization/core/protocol admission failed.' }
        } finally { Pop-Location }
    } finally { $worker.Dispose() }
} finally { Pop-Location }
