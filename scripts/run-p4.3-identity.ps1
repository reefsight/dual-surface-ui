param([switch]$Native)

$ErrorActionPreference = 'Stop'
$repoRoot = Split-Path -Parent $PSScriptRoot
$referenceRoot = Join-Path $repoRoot 'experiments/windows-uia/managed-reference'
$sdkRoot = Join-Path ([IO.Path]::GetTempPath()) 'dual-surface-ui-dotnet-10.0.401'
$sdkExe = Join-Path $sdkRoot 'dotnet.exe'
$sdkMarker = Join-Path $sdkRoot '.p4.2-sdk-ready'
if (-not (Test-Path -LiteralPath $sdkExe) -or -not (Test-Path -LiteralPath $sdkMarker)) { throw 'Pinned P4.2 SDK is required; no installer/elevation is attempted.' }
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
    & $sdkExe build IdentityHarness/IdentityHarness.csproj -c Release --nologo
    if ($LASTEXITCODE -ne 0) { throw 'P4.3 identity build failed.' }
    $harness = Join-Path $referenceRoot 'IdentityHarness/bin/Release/net10.0-windows/DualSurface.UiaIdentityHarness.dll'
    function Invoke-OwnedWorker([string[]]$Arguments, [int]$Deadline) {
        $start = [Diagnostics.ProcessStartInfo]::new($sdkExe)
        $start.UseShellExecute = $false
        $start.CreateNoWindow = $true
        $start.RedirectStandardOutput = $true
        $start.RedirectStandardError = $true
        foreach ($argument in (@($harness) + $Arguments)) { $start.ArgumentList.Add($argument) }
        $worker = [Diagnostics.Process]::Start($start)
        try {
            $stdout = $worker.StandardOutput.ReadToEndAsync()
            $stderr = $worker.StandardError.ReadToEndAsync()
            if (-not $worker.WaitForExit($Deadline)) {
                $worker.Kill($true)
                $worker.WaitForExit(5000) | Out-Null
                throw 'P4.3 worker exceeded its fixed deadline; owned tree stopped and evidence retained.'
            }
            $out = $stdout.GetAwaiter().GetResult()
            $err = $stderr.GetAwaiter().GetResult()
            if ($out.Length -gt 16384 -or $err.Length -gt 256) { throw 'P4.3 worker output budget exceeded.' }
            if ($out) { Write-Output $out.TrimEnd() }
            if ($err) { Write-Output $err.TrimEnd() }
            if ($worker.ExitCode -ne 0) { throw 'P4.3 identity worker failed; no retry and no success artifact admission.' }
        } finally { $worker.Dispose() }
    }
    Invoke-OwnedWorker @('--unit') 30000
    if ($Native) {
        # Existing accepted P4.2 fixture binary is pinned by the worker. Do not
        # rebuild it and silently alter its accepted build provenance.
        $evidenceBase = Join-Path ([IO.Path]::GetTempPath()) 'dual-surface-ui-native-evidence'
        if ((Test-Path -LiteralPath $evidenceBase) -and ((Get-Item -LiteralPath $evidenceBase).Attributes -band [IO.FileAttributes]::ReparsePoint)) { throw 'Evidence root is aliased.' }
        New-Item -ItemType Directory -Path $evidenceBase -Force | Out-Null
        $runRoot = Join-Path $evidenceBase ('p4.3-identity-' + [guid]::NewGuid().ToString('N'))
        New-Item -ItemType Directory -Path $runRoot | Out-Null
        # Two planned serial captures, not retries. Stop on the first failure.
        Write-Output ('evidence-directory=' + $runRoot)
        foreach ($name in @('first', 'repeat')) {
            $output = Join-Path $runRoot $name
            New-Item -ItemType Directory -Path $output | Out-Null
            Invoke-OwnedWorker @('--native', '--repo', $repoRoot, '--output', $output) 240000
        }
    }
} finally { Pop-Location }
