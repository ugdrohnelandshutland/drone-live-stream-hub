<#
.SYNOPSIS
  Removes the Drone Live Stream Hub service and its firewall rules.

.DESCRIPTION
  Needs administrator rights and asks for them if missing. Removes the service and the
  firewall rules, then the program files. config\drones.json, data\ and the logs are kept unless
  -Purge is given.

.PARAMETER InstallDir
  Install directory. Default: C:\Program Files\DroneLiveStreamHub

.PARAMETER Purge
  Also delete the configuration, the device names and the logs (the whole install directory).

.PARAMETER Pause
  Wait for Enter before closing (used by uninstall.cmd).
#>
[CmdletBinding()]
param(
  [string]$InstallDir = (Join-Path $env:ProgramFiles 'DroneLiveStreamHub'),
  [switch]$Purge,
  [switch]$Pause
)

# Windows PowerShell 5.1 compatible. Keep this file ASCII-only (5.1 reads it as ANSI).
$ErrorActionPreference = 'Stop'
$ServiceName = 'DroneLiveStreamHub'
$FirewallGroup = 'Drone Live Stream Hub'

function Write-Step([string]$Text) { Write-Host "==> $Text" -ForegroundColor Cyan }

function Exit-Script([int]$Code) {
  if ($Pause) { [void](Read-Host 'Press Enter to close') }
  exit $Code
}

$principal = New-Object Security.Principal.WindowsPrincipal([Security.Principal.WindowsIdentity]::GetCurrent())
if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
  Write-Host 'Administrator rights are required, asking for elevation...'
  $arguments = @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', "`"$PSCommandPath`"", '-InstallDir', "`"$InstallDir`"", '-Pause')
  if ($Purge) { $arguments += '-Purge' }
  Start-Process -FilePath 'powershell.exe' -Verb RunAs -ArgumentList $arguments
  exit 0
}

try {
  $InstallDir = [IO.Path]::GetFullPath($InstallDir)
  $service = Get-Service -Name $ServiceName -ErrorAction SilentlyContinue
  if ($service) {
    if ($service.Status -ne 'Stopped') {
      Write-Step "Stopping service $ServiceName"
      Stop-Service -Name $ServiceName -Force
      $service.WaitForStatus('Stopped', [TimeSpan]::FromSeconds(30))
    }
    Write-Step "Removing service $ServiceName"
    $cim = Get-CimInstance -ClassName Win32_Service -Filter "Name='$ServiceName'"
    $result = Invoke-CimMethod -InputObject $cim -MethodName Delete
    if ($result.ReturnValue -ne 0) { throw "Removing the service failed (Win32_Service.Delete returned $($result.ReturnValue))" }
  } else {
    Write-Step "Service $ServiceName is not installed"
  }

  Write-Step 'Removing firewall rules'
  Get-NetFirewallRule -Group $FirewallGroup -ErrorAction SilentlyContinue | Remove-NetFirewallRule

  if (Test-Path $InstallDir) {
    # This script may live in the install directory; PowerShell has already read it.
    if ($Purge) {
      Write-Step "Deleting $InstallDir"
      Remove-Item -Recurse -Force -Path $InstallDir
    } else {
      Write-Step "Deleting program files in $InstallDir (keeping config, data and logs)"
      Get-ChildItem -Path $InstallDir | Where-Object { @('config', 'data', 'logs') -notcontains $_.Name } |
        Remove-Item -Recurse -Force
    }
  }
  Write-Host 'Drone Live Stream Hub has been removed.' -ForegroundColor Green
  Exit-Script 0
} catch {
  Write-Host ''
  Write-Host "Uninstall failed: $($_.Exception.Message)" -ForegroundColor Red
  Exit-Script 1
}
