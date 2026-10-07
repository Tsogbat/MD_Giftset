# Starts Gift Set Studio (the app on 127.0.0.1:3200 and the office-network gateway on HQ-SJ07:3200) as
# background processes without windows, through Windows' process service, so closing a terminal or a tool
# session does not stop them. Output goes to data\logs. Already running parts are left alone.
#   powershell -ExecutionPolicy Bypass -File scripts\start-servers.ps1     (or double-click "Start Gift Set Studio.cmd")
$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
$port = 3200
$logs = Join-Path $root "data\logs"
New-Item -ItemType Directory -Force $logs | Out-Null

function Listening($address) {
  return [bool](Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue | Where-Object { $_.LocalAddress -eq $address })
}
function Start-Hidden($commandLine) {
  $r = Invoke-CimMethod -ClassName Win32_Process -MethodName Create -Arguments @{ CommandLine = $commandLine; CurrentDirectory = $root }
  if ($r.ReturnValue -ne 0) { throw "could not start: $commandLine (code $($r.ReturnValue))" }
  return $r.ProcessId
}

if (Listening "127.0.0.1") {
  Write-Host "The app is already running on http://127.0.0.1:$port"
} else {
  # a half-written dev cache (after a hard stop) makes the app fail with "Jest worker" errors: start clean
  $cache = Join-Path $root ".next\dev"
  if (Test-Path $cache) { Remove-Item -Recurse -Force $cache }
  $pid1 = Start-Hidden "cmd.exe /c npm run dev > `"$logs\dev-server.log`" 2>&1"
  Write-Host "Starting the app (process $pid1)..."
  for ($i = 0; $i -lt 60 -and -not (Listening "127.0.0.1"); $i++) { Start-Sleep -Seconds 1 }
  if (Listening "127.0.0.1") { Write-Host "The app is running on http://127.0.0.1:$port" } else { Write-Host "The app did not start: see data\logs\dev-server.log" }
}

$lan = Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue | Where-Object { $_.LocalAddress -ne "127.0.0.1" }
if ($lan) {
  Write-Host "The office-network gateway is already running on http://$($env:COMPUTERNAME):$port"
} else {
  $pid2 = Start-Hidden "cmd.exe /c npm run lan >> `"$logs\lan-gateway.out`" 2>&1"
  for ($i = 0; $i -lt 20 -and -not (Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue | Where-Object { $_.LocalAddress -ne "127.0.0.1" }); $i++) { Start-Sleep -Seconds 1 }
  if (Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue | Where-Object { $_.LocalAddress -ne "127.0.0.1" }) {
    Write-Host "The office-network gateway is running on http://$($env:COMPUTERNAME):$port (process $pid2)"
  } else {
    Write-Host "The gateway did not start: see data\logs\lan-gateway.out (is LAN_PASSWORD set in .env?)"
  }
}
