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
    & $sdkExe build NativeCaptureHarness/NativeCaptureHarness.csproj -c Release --nologo
    if ($LASTEXITCODE -ne 0) { throw 'Native collector candidate build failed.' }
    $harness = Join-Path $referenceRoot 'NativeCaptureHarness/bin/Release/net10.0-windows/DualSurface.UiaNativeCaptureHarness.dll'
    $start = [Diagnostics.ProcessStartInfo]::new($sdkExe)
    $start.UseShellExecute = $false
    $start.CreateNoWindow = $true
    $start.RedirectStandardOutput = $true
    $start.RedirectStandardError = $true
    foreach ($argument in @($harness, '--unit')) { $start.ArgumentList.Add($argument) }
    $worker = [Diagnostics.Process]::Start($start)
    try {
        # Reject malformed UTF-8 and preserve any BOM for strict Node refusal.
        # This is still post-buffered unit output, not COM allocation containment.
        $strictOutput = [IO.StreamReader]::new($worker.StandardOutput.BaseStream, [Text.UTF8Encoding]::new($false, $true), $false, 1024, $true)
        $stdout = $strictOutput.ReadToEndAsync()
        $stderr = $worker.StandardError.ReadToEndAsync()
        if (-not $worker.WaitForExit(30000)) {
            $worker.Kill($true)
            $worker.WaitForExit(5000) | Out-Null
            throw 'Collector unit worker exceeded fixed 30-second deadline.'
        }
        try {
            $out = $stdout.GetAwaiter().GetResult()
            $err = $stderr.GetAwaiter().GetResult()
        } catch { throw 'Collector unit output decoding failed; raw diagnostic withheld.' }
        if ($out.Length -gt 1024 -or $err.Length -gt 256) { throw 'Collector unit output budget exceeded.' }
        if ($err) { throw 'Collector unit worker reported stderr; raw diagnostic withheld.' }
        if ($worker.ExitCode -ne 0) { throw 'Collector deterministic units failed; no native capture occurred.' }
        Push-Location $repoRoot
        try {
            $out | & node scripts/verify-p4.3-native-capture-unit.mjs
            if ($LASTEXITCODE -ne 0) { throw 'Collector unit summary admission failed; raw output withheld.' }
        } finally { Pop-Location }
    } finally {
        if ($null -ne $strictOutput) { $strictOutput.Dispose() }
        $worker.Dispose()
    }
} finally { Pop-Location }
