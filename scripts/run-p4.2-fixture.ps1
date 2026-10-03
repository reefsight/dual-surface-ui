param()

$ErrorActionPreference = 'Stop'
$repoRoot = Split-Path -Parent $PSScriptRoot
$sdkRoot = Join-Path ([IO.Path]::GetTempPath()) 'dual-surface-ui-dotnet-10.0.401'
$sdkExe = Join-Path $sdkRoot 'dotnet.exe'
$fixtureRoot = Join-Path $repoRoot 'fixtures/native/windows-app'
if (-not (Test-Path -LiteralPath $sdkExe) -or -not (Test-Path -LiteralPath (Join-Path $sdkRoot '.p4.2-sdk-ready'))) { throw 'Run scripts/setup-p4.2-dotnet.ps1 first.' }
if ([IO.File]::ReadAllText((Join-Path $sdkRoot '.p4.2-sdk-ready')) -ne '24b670ad3d923bfcf47df6c3b034152398b42f6dbc388e10d783aee1cfb5e5817d399fc0ae2a12cfa822a55e61d34830ccb15c50ef6efee437ab874bb7c79430') { throw 'P4.2 SDK ready marker mismatch.' }
if ((Get-Item -LiteralPath $sdkRoot).Attributes -band [IO.FileAttributes]::ReparsePoint) { throw 'P4.2 SDK cache must not be a reparse-point target.' }
$env:DOTNET_ROOT = Split-Path -Parent $sdkExe
$env:DOTNET_CLI_HOME = Join-Path $repoRoot '.tools/cli-home'
$env:NUGET_PACKAGES = Join-Path $repoRoot '.tools/nuget-packages'
$env:DOTNET_CLI_TELEMETRY_OPTOUT = '1'
$env:DOTNET_SKIP_FIRST_TIME_EXPERIENCE = '1'
$env:DOTNET_GENERATE_ASPNET_CERTIFICATE = 'false'
Push-Location $fixtureRoot
try {
    if ((& $sdkExe --version) -ne '10.0.401') { throw 'P4.2 requires SDK 10.0.401.' }
    foreach ($project in @('Fixture/Fixture.csproj', 'Capture/Capture.csproj')) {
        & $sdkExe build $project --configuration Release --nologo
        if ($LASTEXITCODE -ne 0) { throw 'P4.2 fixture build failed.' }
    }
    $evidenceRoot = Join-Path ([IO.Path]::GetTempPath()) 'dual-surface-ui-native-evidence'
    if ((Test-Path -LiteralPath $evidenceRoot) -and ((Get-Item -LiteralPath $evidenceRoot).Attributes -band [IO.FileAttributes]::ReparsePoint)) {
        throw 'P4.2 evidence root must not be a reparse-point target.'
    }
    New-Item -ItemType Directory -Path $evidenceRoot -Force | Out-Null
    $runRoot = Join-Path $evidenceRoot ('p4.2-' + [guid]::NewGuid().ToString('N'))
    New-Item -ItemType Directory -Path $runRoot | Out-Null
    foreach ($name in @('first', 'repeat')) {
        $outputRoot = Join-Path $runRoot $name
        New-Item -ItemType Directory -Path $outputRoot | Out-Null
        $start = [Diagnostics.ProcessStartInfo]::new($sdkExe)
        $start.UseShellExecute = $false
        $start.CreateNoWindow = $true
        $start.RedirectStandardOutput = $true
        $start.RedirectStandardError = $true
        foreach ($argument in @((Join-Path $fixtureRoot 'Capture/bin/Release/net10.0-windows/DualSurface.FixtureCapture.dll'), '--fixture', (Join-Path $fixtureRoot 'Fixture/bin/Release/net10.0-windows/DualSurface.Fixture.dll'), '--output', $outputRoot, '--manifest', (Join-Path $fixtureRoot 'manifest-0.1.json'))) { $start.ArgumentList.Add($argument) }
        $capture = [Diagnostics.Process]::Start($start)
        try {
            $stdout = $capture.StandardOutput.ReadToEndAsync()
            $stderr = $capture.StandardError.ReadToEndAsync()
            if (-not $capture.WaitForExit(240000)) {
                $capture.Kill($true)
                $capture.WaitForExit(5000) | Out-Null
                throw 'P4.2 capture exceeded its process deadline; owned process tree stopped, evidence retained.'
            }
            Write-Output $stdout.GetAwaiter().GetResult()
            $errorOutput = $stderr.GetAwaiter().GetResult()
            if ($errorOutput) { Write-Output $errorOutput }
            if ($capture.ExitCode -ne 0) {
                $failurePath = Join-Path $outputRoot 'fixture-failure.json'
                if ((Test-Path -LiteralPath $failurePath) -and (Get-Item -LiteralPath $failurePath).Length -le 256) {
                    $failure = Get-Content -LiteralPath $failurePath -Raw | ConvertFrom-Json
                    if ($failure.kind -eq 'p4.2-fixture-failure' -and $failure.category -in @('io_sharing', 'io_other', 'access', 'unexpected')) { Write-Output ('fixture-failure-category=' + $failure.category) }
                }
                throw 'P4.2 real UI Automation capture failed; local evidence retained.'
            }
        } finally { $capture.Dispose() }
    }
    Write-Output ('evidence-directory=' + $runRoot)
}
finally { Pop-Location }
