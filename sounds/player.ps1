# laptop-crew's sound player on Windows, started ahead of time so a sound needs no
# PowerShell start-up (0.3 to 0.6 s): the mod writes a WAV's path into -Trigger the
# moment the "!" pops, and this plays it within ~30 ms.
# It leaves on its own once the mod stops touching -Heartbeat for 30 s (session over,
# mod unloaded, engine gone), so it never outlives the chat for long.
param(
  [Parameter(Mandatory)] [string] $Trigger,
  [Parameter(Mandatory)] [string] $Heartbeat
)
$ErrorActionPreference = 'SilentlyContinue'
$player = New-Object Media.SoundPlayer
$tick = 0
while ($true) {
  if (Test-Path -LiteralPath $Trigger) {
    $path = ''
    try {
      $path = [IO.File]::ReadAllText($Trigger).Trim()
      Remove-Item -LiteralPath $Trigger -Force
    } catch {}
    if ($path -and (Test-Path -LiteralPath $path)) {
      $player.SoundLocation = $path
      $player.Play()
    }
  }
  # About once a second: still wanted?
  if ((++$tick % 33) -eq 0) {
    $beat = Get-Item -LiteralPath $Heartbeat
    if (-not $beat -or ((Get-Date) - $beat.LastWriteTime).TotalSeconds -gt 30) { break }
  }
  Start-Sleep -Milliseconds 30
}
