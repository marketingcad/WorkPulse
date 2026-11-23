# What a Windows install of the desktop app put on the computer (the "Desktop installer" workflow).
# Fails on what would break the app; warns on what is known to be pending (code signing).
param(
  [Parameter(Mandatory = $true)][string]$Exe,
  [Parameter(Mandatory = $true)][string]$Version
)
$ErrorActionPreference = 'Stop'
$failed = $false
function Fail([string]$m) { Write-Host "::error::$m"; $script:failed = $true }

if (-not (Test-Path $Exe)) { Fail "app not found: $Exe"; exit 1 }
$dir = Split-Path $Exe -Parent
Write-Host "installed in $dir"

# The version that was built (the file's product version is "0.3.0" or "0.3.0.0").
$pv = (Get-Item $Exe).VersionInfo.ProductVersion
Write-Host "product version $pv"
if (-not $pv.StartsWith($Version)) { Fail "installed version $pv, built $Version" }

# The app itself, and the native modules the trackers need (unpacked next to the archive).
foreach ($p in @('resources\app.asar', 'resources\app.asar.unpacked\node_modules\uiohook-napi', 'resources\app.asar.unpacked\node_modules\get-windows')) {
  if (Test-Path (Join-Path $dir $p)) { Write-Host "ok: $p" } else { Fail "missing: $p" }
}

# A Start menu entry, for the person or for every user (per-machine .msi).
$menus = @("$env:APPDATA\Microsoft\Windows\Start Menu\Programs", "$env:ProgramData\Microsoft\Windows\Start Menu\Programs")
$link = Get-ChildItem $menus -Recurse -Filter 'Tallywork*.lnk' -ErrorAction SilentlyContinue | Select-Object -First 1
if ($link) { Write-Host "Start menu: $($link.FullName)" } else { Write-Host '::warning::no Start menu shortcut found' }

# Authenticode: until signing is set up, NotSigned is expected (SmartScreen warns people on first run).
# A broken signature (HashMismatch) means the file was changed after signing: that fails.
$sig = Get-AuthenticodeSignature $Exe
Write-Host "signature: $($sig.Status) $($sig.SignerCertificate.Subject)"
switch ($sig.Status) {
  'Valid' { Write-Host 'signed' }
  'NotSigned' { Write-Host '::warning::the app is not code-signed yet: Windows SmartScreen warns people on first run' }
  default { Fail "signature status $($sig.Status)" }
}

if ($failed) { exit 1 }
Write-Host 'install checks passed'
