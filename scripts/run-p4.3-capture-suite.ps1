param([switch]$Native)
$ErrorActionPreference = 'Stop'
$taskRepo = Split-Path -Parent $PSScriptRoot
$taskReference = Join-Path $taskRepo 'experiments/windows-uia/managed-reference'
$taskSdk = Join-Path ([IO.Path]::GetTempPath()) 'dual-surface-ui-dotnet-10.0.401'
$taskSdkExe = Join-Path $taskSdk 'dotnet.exe'
$taskMarker = Join-Path $taskSdk '.p4.2-sdk-ready'
if (-not (Test-Path -LiteralPath $taskSdkExe) -or -not (Test-Path -LiteralPath $taskMarker)) { throw 'Pinned SDK unavailable; no installation/elevation attempted.' }
if ([IO.File]::ReadAllText($taskMarker) -ne '24b670ad3d923bfcf47df6c3b034152398b42f6dbc388e10d783aee1cfb5e5817d399fc0ae2a12cfa822a55e61d34830ccb15c50ef6efee437ab874bb7c79430') { throw 'SDK marker mismatch.' }
if ((Get-Item -LiteralPath $taskSdk).Attributes -band [IO.FileAttributes]::ReparsePoint) { throw 'SDK cache is aliased.' }
$env:DOTNET_ROOT = $taskSdk
$env:DOTNET_CLI_HOME = Join-Path $taskRepo '.tools/cli-home'
$env:NUGET_PACKAGES = Join-Path $taskRepo '.tools/nuget-packages'
$env:DOTNET_CLI_TELEMETRY_OPTOUT = '1'
$env:DOTNET_GENERATE_ASPNET_CERTIFICATE = 'false'
# Read at most capacity+1 original bytes. An overflowing or faulted stream is
# refused while collecting, not after an unbounded ReadToEnd allocation.
function New-BoundedPipe([IO.Stream]$Stream, [int]$Capacity) {
    if ($Capacity -lt 1 -or $Capacity -gt 1024) { throw 'Pipe capacity refused.' }
    $taskPipe = [pscustomobject]@{ Stream = $Stream; Capacity = $Capacity; Buffer = [byte[]]::new($Capacity + 1); Length = 0; Ended = $false; Pending = $null }
    $taskPipe.Pending = $Stream.ReadAsync($taskPipe.Buffer, 0, $Capacity + 1)
    return $taskPipe
}
function Receive-BoundedPipe($Pipe) {
    if ($Pipe.Ended -or -not $Pipe.Pending.IsCompleted) { return }
    $taskRead = $Pipe.Pending.GetAwaiter().GetResult()
    if ($taskRead -eq 0) { $Pipe.Ended = $true; return }
    $Pipe.Length += $taskRead
    if ($Pipe.Length -gt $Pipe.Capacity) { throw 'Pipe overflow refused.' }
    $Pipe.Pending = $Pipe.Stream.ReadAsync($Pipe.Buffer, $Pipe.Length, $Pipe.Capacity + 1 - $Pipe.Length)
}
function Complete-BoundedPipe($Pipe) {
    if (-not $Pipe.Ended -or $Pipe.Length -gt $Pipe.Capacity) { throw 'Incomplete pipe refused.' }
    return [Text.UTF8Encoding]::new($false, $true).GetString($Pipe.Buffer, 0, $Pipe.Length)
}
function Test-BoundedPipes {
    $taskCases = 0
    foreach ($taskBytes in @([byte[]]@(), [Text.Encoding]::UTF8.GetBytes('four'))) {
        $taskStream = [IO.MemoryStream]::new([byte[]]$taskBytes)
        try {
            $taskPipe = New-BoundedPipe $taskStream 4
            while (-not $taskPipe.Ended) { Receive-BoundedPipe $taskPipe }
            if ((Complete-BoundedPipe $taskPipe) -ne [Text.Encoding]::UTF8.GetString($taskBytes)) { throw 'Pipe unit mismatch.' }
            $taskCases++
        } finally { $taskStream.Dispose() }
    }
    foreach ($taskBytes in @([Text.Encoding]::UTF8.GetBytes('large'), [byte[]]@(0xc0, 0xaf))) {
        $taskStream = [IO.MemoryStream]::new([byte[]]$taskBytes)
        try {
            $taskDenied = $false
            try {
                $taskPipe = New-BoundedPipe $taskStream 4
                while (-not $taskPipe.Ended) { Receive-BoundedPipe $taskPipe }
                Complete-BoundedPipe $taskPipe | Out-Null
            } catch { $taskDenied = $true }
            if (-not $taskDenied -or $taskPipe.Buffer.Length -ne 5) { throw 'Pipe negative unit mismatch.' }
            $taskCases++
        } finally { $taskStream.Dispose() }
    }
    $taskStream = [IO.MemoryStream]::new()
    try {
        $taskPipe = New-BoundedPipe $taskStream 4
        $taskDenied = $false
        try { Complete-BoundedPipe $taskPipe | Out-Null } catch { $taskDenied = $true }
        if (-not $taskDenied) { throw 'Incomplete pipe unit mismatch.' }
        $taskCases++
    } finally { $taskStream.Dispose() }
    $taskStream = [IO.MemoryStream]::new()
    $taskStream.Dispose()
    $taskDenied = $false
    try {
        $taskPipe = New-BoundedPipe $taskStream 4
        while (-not $taskPipe.Ended) { Receive-BoundedPipe $taskPipe }
    } catch { $taskDenied = $true }
    if (-not $taskDenied) { throw 'Pipe read-fault unit mismatch.' }
    $taskCases++
    Write-Output ('p4.3-worker-pipe-unit-cases=' + $taskCases + ';nativeExecuted=false')
}
Test-BoundedPipes
Push-Location $taskReference
try {
    if ((& $taskSdkExe --version) -ne '10.0.401') { throw 'SDK version mismatch.' }
    & $taskSdkExe build CaptureSuite/CaptureSuite.csproj -c Release --nologo
    if ($LASTEXITCODE -ne 0) { throw 'P4.3 capture-suite build failed.' }
    $taskWorkerDll = Join-Path $taskReference 'CaptureSuite/bin/Release/net10.0-windows/DualSurface.UiaCaptureSuite.dll'
    function Invoke-CaptureWorker([string[]]$Arguments, [int]$Deadline, [string]$Mode) {
        $taskStart = [Diagnostics.ProcessStartInfo]::new($taskSdkExe)
        $taskStart.UseShellExecute = $false
        $taskStart.CreateNoWindow = $true
        $taskStart.RedirectStandardOutput = $true
        $taskStart.RedirectStandardError = $true
        foreach ($taskArgument in (@($taskWorkerDll) + $Arguments)) { $taskStart.ArgumentList.Add($taskArgument) }
        $taskWorker = [Diagnostics.Process]::Start($taskStart)
        try {
            try {
                $taskClock = [Diagnostics.Stopwatch]::StartNew()
                $taskOut = New-BoundedPipe $taskWorker.StandardOutput.BaseStream 1024
                $taskErr = New-BoundedPipe $taskWorker.StandardError.BaseStream 256
                while ($true) {
                    Receive-BoundedPipe $taskOut
                    Receive-BoundedPipe $taskErr
                    if ($taskClock.ElapsedMilliseconds -gt $Deadline) { throw 'Owned worker deadline refused.' }
                    if ($taskWorker.HasExited -and $taskOut.Ended -and $taskErr.Ended) { break }
                    if (-not $taskWorker.HasExited) { $taskWorker.WaitForExit(20) | Out-Null }
                    else { Start-Sleep -Milliseconds 5 }
                }
                $taskRaw = Complete-BoundedPipe $taskOut
                $taskFailure = Complete-BoundedPipe $taskErr
                if ($taskWorker.ExitCode -ne 0 -or $taskFailure.Length -ne 0) { throw 'Worker refused; raw output withheld, no retry.' }
                if ($Mode -eq 'native') {
                    if ($taskRaw.TrimEnd("`r", "`n") -ne 'p4.3_native_suite_captured') { throw 'Native summary refused.' }
                    return
                }
                Push-Location $taskRepo
                try {
                    if ($Mode -eq 'unit') {
                        $taskRaw | node --input-type=module -e 'import {parseCapturePublication} from "./scripts/p4.3-capture-contracts.mjs";let b=[];for await(const c of process.stdin){b.push(c);if(Buffer.concat(b).length>1024)throw Error("closed")}const v=parseCapturePublication(Buffer.concat(b));if(Object.keys(v).sort().join(",")!=="cases,kind,nativeExecuted"||v.kind!=="p4.3-native-suite-unit"||!Number.isInteger(v.cases)||v.cases<1||v.cases>256||v.nativeExecuted!==false)throw Error("closed");console.log(JSON.stringify(v));'
                    } else {
                        $taskRaw | node --input-type=module -e 'import {parseCapturePublication} from "./scripts/p4.3-capture-contracts.mjs";import {nativeSuiteBinding} from "./scripts/p4.3-native-suite-source.mjs";let b=[];for await(const c of process.stdin){b.push(c);if(Buffer.concat(b).length>1024)throw Error("closed")}const v=parseCapturePublication(Buffer.concat(b));if(Object.keys(v).join(",")!=="sourceDigest"||v.sourceDigest!==(await nativeSuiteBinding(process.cwd())).digest)throw Error("closed");console.log(JSON.stringify({kind:"p4.3-suite-binding-interop",sourceDigest:v.sourceDigest,nativeExecuted:false}));'
                    }
                    if ($LASTEXITCODE -ne 0) { throw 'Unit/binding interoperability refused.' }
                } finally { Pop-Location }
            } catch { throw 'P4.3 capture-suite worker refused; raw output withheld and partial evidence retained.' }
        } finally {
            try {
                if (-not $taskWorker.HasExited) {
                    $taskWorker.Kill($true)
                    if (-not $taskWorker.WaitForExit(5000)) { throw 'Owned worker did not stop; evidence retained.' }
                }
            } finally { $taskWorker.StandardOutput.Dispose(); $taskWorker.StandardError.Dispose(); $taskWorker.Dispose() }
        }
    }
    Invoke-CaptureWorker @('--unit') 30000 'unit'
    Invoke-CaptureWorker @('--binding') 30000 'binding'
    if ($Native) {
        Push-Location $taskRepo
        try {
            node scripts/p4.3-native-suite-source.mjs --admit
            if ($LASTEXITCODE -ne 0) { throw 'Actual reviewed source/binary freeze required before native launch.' }
            $taskEvidenceBase = Join-Path ([IO.Path]::GetTempPath()) 'dual-surface-ui-native-evidence'
            if (Test-Path -LiteralPath $taskEvidenceBase) {
                if ((Get-Item -LiteralPath $taskEvidenceBase).Attributes -band [IO.FileAttributes]::ReparsePoint) { throw 'Evidence base aliased.' }
            } else { New-Item -ItemType Directory -Path $taskEvidenceBase | Out-Null }
            $taskRunRoot = Join-Path $taskEvidenceBase ('p4.3-capture-' + [guid]::NewGuid().ToString('N'))
            New-Item -ItemType Directory -Path $taskRunRoot | Out-Null
            Write-Output ('evidence-directory=' + $taskRunRoot)
            foreach ($taskRun in @('first', 'repeat')) {
                node scripts/p4.3-native-suite-source.mjs --admit
                if ($LASTEXITCODE -ne 0) { throw 'Reviewed candidate drift; native launch refused.' }
                $taskOutput = Join-Path $taskRunRoot $taskRun
                New-Item -ItemType Directory -Path $taskOutput | Out-Null
                Invoke-CaptureWorker @('--native', '--output', $taskOutput) 240000 'native'
                node scripts/verify-p4.3-native-suite.mjs --directory $taskOutput
                if ($LASTEXITCODE -ne 0) { throw 'Original native artifacts refused; no next run or retry.' }
            }
            node scripts/verify-p4.3-native-suite.mjs --pair-root $taskRunRoot
            if ($LASTEXITCODE -ne 0) { throw 'Original serial pair refused.' }
        } finally { Pop-Location }
    }
} finally { Pop-Location }
