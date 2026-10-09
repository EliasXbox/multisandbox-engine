param(
    [string]$OutputPath = (Join-Path $PSScriptRoot '..\dist\multisandbox-engine-mindustry-1.3.0.zip')
)
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.IO.Compression.FileSystem
Add-Type -AssemblyName System.IO.Compression
$mseSource = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\clients\mindustry-bridge\zip mod'))
$mseOutput = [IO.Path]::GetFullPath($OutputPath)
New-Item -ItemType Directory -Force -Path (Split-Path $mseOutput) | Out-Null
if (Test-Path -LiteralPath $mseOutput) {
    Copy-Item -LiteralPath $mseOutput -Destination ($mseOutput + '.before-package-fix-' + (Get-Date -Format 'yyyyMMdd-HHmmss') + '.bak')
}
$mseStream = [IO.File]::Open($mseOutput, [IO.FileMode]::Create, [IO.FileAccess]::Write)
$mseZip = [IO.Compression.ZipArchive]::new($mseStream, [IO.Compression.ZipArchiveMode]::Create)
try {
    # Explicit forward-slash entry names are required by Mindustry on Windows too.
    # Only shipping sources are included; local .bak files are not mod scripts.
    foreach ($mseEntryName in @('mod.json', 'scripts/main.js')) {
        [IO.Compression.ZipFileExtensions]::CreateEntryFromFile($mseZip,
            (Join-Path $mseSource $mseEntryName), $mseEntryName,
            [IO.Compression.CompressionLevel]::Optimal) | Out-Null
    }
} finally { $mseZip.Dispose(); $mseStream.Dispose() }
$mseCheck = [IO.Compression.ZipFile]::OpenRead($mseOutput)
try {
    if ($mseCheck.Entries.Count -ne 2 -or $null -eq $mseCheck.GetEntry('scripts/main.js') -or
        $null -eq $mseCheck.GetEntry('mod.json')) { throw 'Invalid Mindustry ZIP entry layout' }
    foreach ($mseEntryName in @('mod.json', 'scripts/main.js')) {
        $mseReader = [IO.StreamReader]::new($mseCheck.GetEntry($mseEntryName).Open())
        try { $mseText = $mseReader.ReadToEnd() } finally { $mseReader.Dispose() }
        if ($mseText -cne [IO.File]::ReadAllText((Join-Path $mseSource $mseEntryName))) {
            throw "ZIP source mismatch: $mseEntryName"
        }
    }
} finally { $mseCheck.Dispose() }
Write-Output "PASS: verified mod.json and scripts/main.js; no backup files. Package: $mseOutput"
