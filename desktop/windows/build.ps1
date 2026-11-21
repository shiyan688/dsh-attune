param(
    [string]$OutputDirectory = (Join-Path $PSScriptRoot '../../lib/native')
)

$ErrorActionPreference = 'Stop'
$attuneFramework = Join-Path $env:WINDIR 'Microsoft.NET/Framework64/v4.0.30319'
$attuneCompiler = Join-Path $attuneFramework 'csc.exe'
if (-not (Test-Path -LiteralPath $attuneCompiler -PathType Leaf)) {
    throw 'This build needs the 64-bit .NET Framework compiler on Windows.'
}

$attuneOutput = [IO.Path]::GetFullPath($OutputDirectory)
$attuneStage = Join-Path $PSScriptRoot '../../work/desktop-windows/assets'
& python (Join-Path $PSScriptRoot 'prepare-assets.py') $attuneStage
if ($LASTEXITCODE -ne 0) { throw 'Could not prepare the bundled sprites. The build uses Python and Pillow.' }
New-Item -ItemType Directory -Path $attuneOutput -Force | Out-Null

$attuneExe = Join-Path $attuneOutput 'AttuneDesktop.exe'
$attuneIcon = Join-Path $attuneStage 'pet.ico'
$attuneManifest = Join-Path $PSScriptRoot 'app.manifest'
$attuneArgs = @('/nologo', '/target:winexe', '/platform:anycpu', '/codepage:65001', '/optimize+',
    "/out:$attuneExe", "/win32icon:$attuneIcon", "/win32manifest:$attuneManifest")
foreach ($attuneRef in @('System.Drawing.dll','System.Windows.Forms.dll','System.Xaml.dll','System.Runtime.Serialization.dll',
    'WPF/WindowsBase.dll','WPF/PresentationCore.dll','WPF/PresentationFramework.dll')) {
    $attuneReference = Join-Path $attuneFramework $attuneRef
    if (-not (Test-Path -LiteralPath $attuneReference)) { throw "Missing .NET Framework assembly: $attuneRef" }
    $attuneArgs += "/reference:$attuneReference"
}
foreach ($attuneAsset in @('idle.png','blink.png','curious.png','happy.png','pet.ico')) {
    $attuneResource = Join-Path $attuneStage $attuneAsset
    $attuneArgs += "/resource:$attuneResource,Attune.$attuneAsset"
}
$attuneArgs += @(Get-ChildItem -LiteralPath $PSScriptRoot -File -Filter '*.cs' | ForEach-Object FullName)
& $attuneCompiler @attuneArgs
if ($LASTEXITCODE -ne 0) { throw 'Could not compile AttuneDesktop.exe.' }
Write-Output $attuneExe
