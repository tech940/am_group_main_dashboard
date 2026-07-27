# AM Group Dashboard - Direct Print setup (Path 1: Chrome kiosk-printing)
#
# Run this ONCE on each office PC that should print vendor payment orders (and any other
# dashboard printout) WITHOUT the print dialog. It creates a desktop shortcut:
#
#     "AM Dashboard (Direct Print)"
#
# Opening the dashboard through that shortcut makes every Print button in the app send the
# job STRAIGHT to the machine's DEFAULT WINDOWS PRINTER - no dialog, paper just comes out.
#
# How it works: Chromium's --kiosk-printing flag auto-approves window.print() to the default
# printer. The flag only applies to a fresh browser process, so the shortcut also uses a
# dedicated profile folder (--user-data-dir) - that way it works even while normal Chrome is
# already open. The dedicated profile means a ONE-TIME dashboard login on first use.
#
# After running:
#   1. Windows Settings -> Bluetooth & devices -> Printers: set the office printer as DEFAULT
#      on this PC (that is where jobs will go).
#   2. Open the new desktop shortcut, log in to the dashboard once.
#   3. Click any Print button - it prints immediately.
#
# Usage:
#   powershell -ExecutionPolicy Bypass -File setup-direct-print.ps1
#   powershell -ExecutionPolicy Bypass -File setup-direct-print.ps1 -DashboardUrl "https://your-dashboard-domain"

param(
  [string]$DashboardUrl = "https://REPLACE-WITH-YOUR-DASHBOARD-URL"
)

$ErrorActionPreference = 'Stop'

# Find a Chromium browser: Chrome first, Edge as the always-installed fallback (same flag).
$candidates = @(
  "$env:ProgramFiles\Google\Chrome\Application\chrome.exe",
  "${env:ProgramFiles(x86)}\Google\Chrome\Application\chrome.exe",
  "$env:LOCALAPPDATA\Google\Chrome\Application\chrome.exe",
  "$env:ProgramFiles(x86)\Microsoft\Edge\Application\msedge.exe",
  "$env:ProgramFiles\Microsoft\Edge\Application\msedge.exe"
)
$browser = $candidates | Where-Object { $_ -and (Test-Path $_) } | Select-Object -First 1
if (-not $browser) {
  Write-Error "Neither Google Chrome nor Microsoft Edge was found on this PC. Install Chrome and re-run."
}

$profileDir = Join-Path $env:LOCALAPPDATA 'AMGroupDirectPrint'
New-Item -ItemType Directory -Force -Path $profileDir | Out-Null

$desktop = [Environment]::GetFolderPath('Desktop')
$lnkPath = Join-Path $desktop 'AM Dashboard (Direct Print).lnk'

$shell = New-Object -ComObject WScript.Shell
$shortcut = $shell.CreateShortcut($lnkPath)
$shortcut.TargetPath = $browser
$shortcut.Arguments = "--kiosk-printing --user-data-dir=`"$profileDir`" --app=$DashboardUrl"
$shortcut.WorkingDirectory = Split-Path $browser
$shortcut.IconLocation = "$browser,0"
$shortcut.Description = 'AM Group dashboard with silent printing to the default printer'
$shortcut.Save()

Write-Host ""
Write-Host "Created: $lnkPath"
Write-Host "Browser: $browser"
Write-Host "Opens:   $DashboardUrl"
Write-Host ""
Write-Host "NEXT STEPS on this PC:"
Write-Host "  1. Set the office printer as the DEFAULT printer in Windows Settings."
Write-Host "  2. Open the shortcut and log in to the dashboard (one time only)."
Write-Host "  3. Every Print button now prints directly - no dialog."
