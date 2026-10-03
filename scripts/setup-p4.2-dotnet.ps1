param()

$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
if (-not $IsWindows -or [System.Runtime.InteropServices.RuntimeInformation]::OSArchitecture -ne 'X64') {
    throw 'P4.2 SDK setup requires Windows x64.'
}
$sdkVersion = '10.0.401'
$sdkHash = '24b670ad3d923bfcf47df6c3b034152398b42f6dbc388e10d783aee1cfb5e5817d399fc0ae2a12cfa822a55e61d34830ccb15c50ef6efee437ab874bb7c79430'
$sdkUrl = 'https://builds.dotnet.microsoft.com/dotnet/Sdk/10.0.401/dotnet-sdk-10.0.401-win-x64.zip'
$repoRoot = Split-Path -Parent $PSScriptRoot
$toolsRoot = Join-Path $repoRoot '.tools'
$sdkRoot = Join-Path ([IO.Path]::GetTempPath()) 'dual-surface-ui-dotnet-10.0.401'
$archivePath = Join-Path $toolsRoot 'dotnet-sdk-10.0.401-win-x64.zip'
$sdkExe = Join-Path $sdkRoot 'dotnet.exe'
foreach ($path in @($toolsRoot, $sdkRoot, $archivePath)) {
    if ((Test-Path -LiteralPath $path) -and ((Get-Item -LiteralPath $path).Attributes -band [IO.FileAttributes]::ReparsePoint)) {
        throw 'SDK cache must not contain a reparse-point target.'
    }
}
if ((Test-Path -LiteralPath $sdkExe) -and (Test-Path -LiteralPath (Join-Path $sdkRoot '.p4.2-sdk-ready'))) {
    if ([IO.File]::ReadAllText((Join-Path $sdkRoot '.p4.2-sdk-ready')) -ne $sdkHash) { throw 'SDK ready marker does not match the pinned archive.' }
    $currentVersion = & $sdkExe --version
    if ($LASTEXITCODE -ne 0 -or $currentVersion -ne $sdkVersion) { throw 'Existing SDK cache does not match the pinned version.' }
    Write-Output ('workspace SDK ready: ' + $currentVersion)
    exit 0
}
if ((Test-Path -LiteralPath $sdkRoot) -and (Get-ChildItem -LiteralPath $sdkRoot -Force | Select-Object -First 1)) {
    throw 'SDK cache contains a partial extraction; preserve it for diagnosis before retrying.'
}
$releaseData = Invoke-RestMethod -Uri 'https://builds.dotnet.microsoft.com/dotnet/release-metadata/10.0/releases.json'
$sdk = $releaseData.releases | ForEach-Object { $_.sdks } | Where-Object { $_.version -eq $sdkVersion } | Select-Object -First 1
$release = $sdk.files | Where-Object { $_.rid -eq 'win-x64' -and $_.name -eq 'dotnet-sdk-win-x64.zip' } | Select-Object -First 1
if ($release.url -ne $sdkUrl -or $release.hash -ne $sdkHash) { throw 'Official SDK metadata does not match the pinned candidate.' }
New-Item -ItemType Directory -Path $toolsRoot -Force | Out-Null
if (-not (Test-Path -LiteralPath $archivePath)) {
    Invoke-WebRequest -Uri $sdkUrl -OutFile $archivePath
}
if ((Get-FileHash -LiteralPath $archivePath -Algorithm SHA512).Hash.ToLowerInvariant() -ne $sdkHash) {
    throw 'Downloaded SDK SHA-512 mismatch; archive preserved for diagnosis.'
}
Write-Output 'SDK ZIP checksum verified; extracting with 8 workers.'
0..7 | ForEach-Object -Parallel {
    $ErrorActionPreference = 'Stop'
    $archive = [IO.Compression.ZipFile]::OpenRead($using:archivePath)
    try {
        $root = [IO.Path]::GetFullPath($using:sdkRoot) + [IO.Path]::DirectorySeparatorChar
        for ($index = $_; $index -lt $archive.Entries.Count; $index += 8) {
            $entry = $archive.Entries[$index]
            $target = [IO.Path]::GetFullPath([IO.Path]::Combine($root, $entry.FullName))
            if (-not $target.StartsWith($root, [StringComparison]::OrdinalIgnoreCase)) { throw 'SDK ZIP entry escaped the cache boundary.' }
            if ($entry.Name -eq '') { [IO.Directory]::CreateDirectory($target) | Out-Null; continue }
            [IO.Directory]::CreateDirectory([IO.Path]::GetDirectoryName($target)) | Out-Null
            [IO.Compression.ZipFileExtensions]::ExtractToFile($entry, $target)
        }
    } finally { $archive.Dispose() }
} -ThrottleLimit 8
$env:DOTNET_CLI_HOME = Join-Path $toolsRoot 'cli-home'
$env:DOTNET_CLI_TELEMETRY_OPTOUT = '1'
$env:DOTNET_SKIP_FIRST_TIME_EXPERIENCE = '1'
$env:DOTNET_GENERATE_ASPNET_CERTIFICATE = 'false'
$currentVersion = & $sdkExe --version
if ($LASTEXITCODE -ne 0 -or $currentVersion -ne $sdkVersion) { throw 'Extracted SDK did not pass the pinned-version check.' }
[IO.File]::WriteAllText((Join-Path $sdkRoot '.p4.2-sdk-ready'), $sdkHash)
Write-Output ('workspace SDK ready: ' + $currentVersion)
