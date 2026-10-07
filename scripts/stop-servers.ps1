# Stops Gift Set Studio's app and office-network gateway (the processes listening on port 3200) and their
# parent npm / cmd processes. An agent turn that is running stops with the app; its project unlocks by itself
# after 40 minutes, or on the next turn.
#   powershell -ExecutionPolicy Bypass -File scripts\stop-servers.ps1
$port = 3200
$owners = Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue | Select-Object -ExpandProperty OwningProcess -Unique
$all = Get-CimInstance Win32_Process
foreach ($p in $owners) {
  $chain = @()
  $cur = $all | Where-Object { $_.ProcessId -eq $p }
  # the listening node process, then its node / npm / cmd parents
  while ($cur -and ($cur.Name -in @("node.exe", "cmd.exe"))) {
    $chain += $cur.ProcessId
    $cur = $all | Where-Object { $_.ProcessId -eq $cur.ParentProcessId }
  }
  foreach ($id in $chain) { try { Stop-Process -Id $id -Force -ErrorAction Stop; Write-Host "stopped $id" } catch {} }
}
if (-not $owners) { Write-Host "Nothing is running on port $port." }
