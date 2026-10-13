<#
.SYNOPSIS
  Installs or updates the Drone Live Stream Hub as a Windows service.

.DESCRIPTION
  Run from the unpacked release folder (or double-click install.cmd). Needs administrator
  rights and asks for them if missing. Safe to run again: an update keeps
  config\drones.json and the logs.

  - Checks that Node.js 24 LTS is installed (not part of the package, see ADR 0008).
  - Copies the package to the install directory.
  - Creates config\drones.json from the example if it is missing and validates it.
  - Registers the service "DroneLiveStreamHub" (automatic start at boot, runs as
    LocalService, no admin rights at runtime). shawl wraps node.exe, restarts it after a
    crash and writes the logs with rotation to <install dir>\logs.
  - Creates inbound firewall rules for the RTMP and HTTP ports (private networks only).
  - Starts the service and checks /healthz.

.PARAMETER InstallDir
  Target directory. Default: C:\Program Files\DroneLiveStreamHub

.PARAMETER NodePath
  Path to node.exe. Default: C:\Program Files\nodejs\node.exe, else node.exe on PATH

.PARAMETER NoStart
  Install, but do not start the service.

.PARAMETER Pause
  Wait for Enter before closing (used by install.cmd so the window stays readable).

.EXAMPLE
  powershell -ExecutionPolicy Bypass -File .\install-windows.ps1
#>
[CmdletBinding()]
param(
  [string]$InstallDir = (Join-Path $env:ProgramFiles 'DroneLiveStreamHub'),
  [string]$NodePath = '',
  [switch]$NoStart,
  [switch]$Pause
)

# Windows PowerShell 5.1 compatible. Keep this file ASCII-only (5.1 reads it as ANSI).
$ErrorActionPreference = 'Stop'
$ServiceName = 'DroneLiveStreamHub'
$DisplayName = 'Drone Live Stream Hub'
$FirewallGroup = 'Drone Live Stream Hub'
$LocalServiceSid = '*S-1-5-19' # NT AUTHORITY\LocalService, independent of the Windows language
$ExitConfigError = 2
# Must match NODE_MAJOR in scripts/package-windows.ts: the version the package was tested with.
$RequiredNodeMajor = 24

function Write-Step([string]$Text) { Write-Host "==> $Text" -ForegroundColor Cyan }
function Write-Warn([string]$Text) { Write-Host "WARNING: $Text" -ForegroundColor Yellow }

# The installed Node.js the service runs with; throws with download advice if it is unsuitable.
function Find-Node([string]$Requested) {
  $candidates = @()
  if ($Requested) {
    $candidates += $Requested
  } else {
    # The official installer's location first: readable for the LocalService account.
    $candidates += (Join-Path $env:ProgramFiles 'nodejs\node.exe')
    $onPath = Get-Command -Name 'node.exe' -CommandType Application -ErrorAction SilentlyContinue | Select-Object -First 1
    if ($onPath) { $candidates += $onPath.Source }
  }
  $advice = "Install Node.js $RequiredNodeMajor LTS (Windows Installer .msi, x64) from https://nodejs.org/ and run this script again, or pass -NodePath."
  foreach ($candidate in $candidates) {
    if (-not (Test-Path -PathType Leaf $candidate)) { continue }
    $path = [IO.Path]::GetFullPath($candidate)
    if ($env:USERPROFILE -and $path.StartsWith($env:USERPROFILE, [StringComparison]::OrdinalIgnoreCase)) {
      throw "$path is in a user profile (e.g. nvm-windows), which the service account cannot read. $advice"
    }
    $version = (& $path -p 'process.versions.node' 2>$null | Out-String).Trim()
    if (-not ($version -match '^(\d+)\.')) { throw "$path does not report a Node.js version. $advice" }
    if ([int]$Matches[1] -ne $RequiredNodeMajor) {
      throw "Found Node.js $version at $path, but this release needs Node.js $RequiredNodeMajor.x. $advice"
    }
    return @{ Path = $path; Version = $version }
  }
  throw "Node.js was not found. $advice"
}

function Test-Admin {
  $principal = New-Object Security.Principal.WindowsPrincipal([Security.Principal.WindowsIdentity]::GetCurrent())
  return $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
}

function Exit-Script([int]$Code) {
  if ($Pause) { [void](Read-Host 'Press Enter to close') }
  exit $Code
}

if (-not (Test-Admin)) {
  Write-Host 'Administrator rights are required, asking for elevation...'
  $arguments = @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', "`"$PSCommandPath`"", '-InstallDir', "`"$InstallDir`"", '-Pause')
  if ($NodePath) { $arguments += @('-NodePath', "`"$NodePath`"") }
  if ($NoStart) { $arguments += '-NoStart' }
  Start-Process -FilePath 'powershell.exe' -Verb RunAs -ArgumentList $arguments
  exit 0
}

try {
  $source = $PSScriptRoot
  foreach ($required in @('shawl\shawl.exe', 'app\server.mjs', 'config\drones.example.json')) {
    if (-not (Test-Path (Join-Path $source $required))) {
      throw "Incomplete package: $required is missing next to this script. Run it from the unpacked release folder."
    }
  }
  # No trailing backslash: in the service command line, \" would escape the closing quote.
  $InstallDir = [IO.Path]::GetFullPath($InstallDir).TrimEnd('\')
  if ($InstallDir.Length -le 2) { throw 'Install into a folder, not the root of a drive.' }
  $node = Find-Node $NodePath
  $nodeExe = $node.Path
  Write-Step "Using Node.js $($node.Version) at $nodeExe"
  $shawlExe = Join-Path $InstallDir 'shawl\shawl.exe'
  $serverJs = Join-Path $InstallDir 'app\server.mjs'
  $configDir = Join-Path $InstallDir 'config'
  $configFile = Join-Path $configDir 'drones.json'
  $logDir = Join-Path $InstallDir 'logs'

  # 1. Stop a running instance so its files can be replaced.
  $existing = Get-Service -Name $ServiceName -ErrorAction SilentlyContinue
  if ($existing -and $existing.Status -ne 'Stopped') {
    Write-Step "Stopping service $ServiceName"
    Stop-Service -Name $ServiceName -Force
    $existing.WaitForStatus('Stopped', [TimeSpan]::FromSeconds(30))
  }

  # 2. Copy the package. The app folder is replaced as a whole; config and logs are kept.
  Write-Step "Copying files to $InstallDir"
  New-Item -ItemType Directory -Force -Path $InstallDir, $configDir, $logDir | Out-Null
  $samePlace = ([IO.Path]::GetFullPath($source).TrimEnd('\') -ieq $InstallDir)
  if (-not $samePlace) {
    foreach ($dir in @('shawl', 'app')) {
      $target = Join-Path $InstallDir $dir
      if (Test-Path $target) { Remove-Item -Recurse -Force $target }
      Copy-Item -Recurse -Path (Join-Path $source $dir) -Destination $target
    }
    foreach ($file in @('install-windows.ps1', 'uninstall-windows.ps1', 'install.cmd', 'uninstall.cmd', 'README.md', 'THIRD-PARTY-NOTICES.txt', 'build-info.json')) {
      $path = Join-Path $source $file
      if (Test-Path $path) { Copy-Item -Force -Path $path -Destination $InstallDir }
    }
    Copy-Item -Force -Path (Join-Path $source 'config\drones.example.json') -Destination $configDir
  }
  # Packages up to 0.4.0 shipped their own Node.js; it is no longer used.
  $oldNode = Join-Path $InstallDir 'node'
  if (Test-Path $oldNode) {
    Write-Step 'Removing the Node.js copy of an older package'
    Remove-Item -Recurse -Force $oldNode
  }
  # Files from a downloaded ZIP carry the "from the internet" mark.
  Get-ChildItem -Recurse -File -Path $InstallDir | Unblock-File

  # 3. Configuration.
  if (-not (Test-Path $configFile)) {
    Write-Step 'Creating config\drones.json from the example'
    Copy-Item -Path (Join-Path $configDir 'drones.example.json') -Destination $configFile
  } else {
    Write-Step 'Keeping existing config\drones.json'
  }
  & $nodeExe $serverJs --check-config --config $configFile
  if ($LASTEXITCODE -ne 0) {
    throw "config\drones.json is invalid (see above). Fix $configFile and run this script again."
  }
  $config = Get-Content -Raw -Path $configFile | ConvertFrom-Json
  $rtmpPort = 1935
  $httpPort = 8080
  if ($config.rtmpPort) { $rtmpPort = [int]$config.rtmpPort }
  if ($config.httpPort) { $httpPort = [int]$config.httpPort }

  # 4. Permissions: the service account may read the program and write only the logs.
  Write-Step 'Setting folder permissions for LocalService'
  & icacls.exe $InstallDir /grant "${LocalServiceSid}:(OI)(CI)RX" /T /C /Q | Out-Null
  & icacls.exe $logDir /grant "${LocalServiceSid}:(OI)(CI)M" /T /C /Q | Out-Null

  # 5. Service. shawl stops node.exe with Ctrl+C, restarts it after a crash (but not after a
  #    configuration error) and writes its output to rotating log files.
  $q = '"'
  $binaryPath = "$q$shawlExe$q run --name $ServiceName --cwd $q$InstallDir$q" +
    " --stop-timeout 10000 --restart-delay 2000 --restart-if-not 0,$ExitConfigError" +
    " --log-dir $q$logDir$q --log-as wrapper --log-cmd-as service --log-rotate bytes=10485760 --log-retain 9" +
    " --env NODE_ENV=production" +
    " -- $q$nodeExe$q $q$serverJs$q --config $q$configFile$q"
  if (-not $existing) {
    Write-Step "Registering service $ServiceName"
    New-Service -Name $ServiceName -BinaryPathName $binaryPath -DisplayName $DisplayName -StartupType Automatic `
      -Description 'Receives RTMP live video from drones and serves it to browsers in the local network.' | Out-Null
  } else {
    Write-Step "Updating service $ServiceName"
  }
  # Win32_Service.Change avoids the quoting pitfalls of sc.exe in Windows PowerShell.
  $service = Get-CimInstance -ClassName Win32_Service -Filter "Name='$ServiceName'"
  $result = Invoke-CimMethod -InputObject $service -MethodName Change -Arguments @{
    PathName = $binaryPath; StartMode = 'Automatic'; StartName = 'NT AUTHORITY\LocalService'; StartPassword = ''
  }
  if ($result.ReturnValue -ne 0) { throw "Configuring the service failed (Win32_Service.Change returned $($result.ReturnValue))" }
  # If the wrapper itself dies, Windows restarts it.
  & sc.exe failure $ServiceName reset= 86400 actions= restart/5000/restart/10000/restart/30000 | Out-Null

  # 6. Firewall: inbound TCP for the installed node.exe on both ports, private network profile
  #    only. The rule allows that node.exe, so any Node.js program on this PC could use them.
  Write-Step "Firewall rules for TCP $rtmpPort (RTMP) and $httpPort (web), private networks"
  Get-NetFirewallRule -Group $FirewallGroup -ErrorAction SilentlyContinue | Remove-NetFirewallRule
  New-NetFirewallRule -DisplayName "$DisplayName - RTMP ingest (TCP $rtmpPort)" -Group $FirewallGroup `
    -Direction Inbound -Action Allow -Protocol TCP -LocalPort $rtmpPort -Profile Private -Program $nodeExe | Out-Null
  New-NetFirewallRule -DisplayName "$DisplayName - Web and video (TCP $httpPort)" -Group $FirewallGroup `
    -Direction Inbound -Action Allow -Protocol TCP -LocalPort $httpPort -Profile Private -Program $nodeExe | Out-Null
  $public = @(Get-NetConnectionProfile | Where-Object { $_.NetworkCategory -eq 'Public' })
  foreach ($network in $public) {
    $message = "Network '$($network.Name)' ($($network.InterfaceAlias)) is set to Public: drones and tablets cannot connect through it. " +
      "If this is the field Wi-Fi, run: Set-NetConnectionProfile -InterfaceAlias '$($network.InterfaceAlias)' -NetworkCategory Private"
    Write-Warn $message
  }

  # 7. Start and check.
  if ($NoStart) {
    Write-Step "Installed. Start with: Start-Service $ServiceName"
    Exit-Script 0
  }
  Write-Step "Starting service $ServiceName"
  Start-Service -Name $ServiceName
  $healthy = $false
  $deadline = (Get-Date).AddSeconds(20)
  while ((Get-Date) -lt $deadline) {
    try {
      $health = Invoke-RestMethod -UseBasicParsing -TimeoutSec 2 -Uri "http://127.0.0.1:$httpPort/healthz"
      if ($health.status -eq 'ok') { $healthy = $true; break }
    } catch {
      Start-Sleep -Milliseconds 500
    }
  }
  if (-not $healthy) {
    throw "The service did not answer on http://127.0.0.1:$httpPort/healthz. See $logDir\service_rCURRENT.log and $logDir\wrapper_rCURRENT.log"
  }

  $addresses = @(Get-NetIPAddress -AddressFamily IPv4 -ErrorAction SilentlyContinue |
      Where-Object { $_.IPAddress -notlike '127.*' -and $_.IPAddress -notlike '169.254.*' } |
      Select-Object -ExpandProperty IPAddress)
  Write-Host ''
  Write-Host 'Drone Live Stream Hub is running.' -ForegroundColor Green
  Write-Host "  Web UI on this PC:  http://localhost:$httpPort/"
  foreach ($ip in $addresses) {
    Write-Host "  Web UI in the LAN:  http://${ip}:$httpPort/"
    Write-Host "  RC Plus RTMP URL:   rtmp://${ip}:$rtmpPort/live/<drone id>"
  }
  Write-Host "  Drones:             $configFile (restart the service after changes: Restart-Service $ServiceName)"
  Write-Host "  Logs:               $logDir"
  Exit-Script 0
} catch {
  Write-Host ''
  Write-Host "Installation failed: $($_.Exception.Message)" -ForegroundColor Red
  Exit-Script 1
}
