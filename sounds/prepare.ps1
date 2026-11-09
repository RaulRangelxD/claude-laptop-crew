# Makes the two alert sounds laptop-crew plays on Windows from one WAV:
#   big.wav   the source at -Volume (this chat)
#   small.wav the source resampled higher and shorter, at -Volume times -SmallVolume (other chats, subagents)
# Only 16-bit PCM WAV is read: it is also all Windows' SoundPlayer plays.
# shortcut: a plain PowerShell loop, a few seconds for a 30 s stereo clip; alert sounds are short.
param(
  [Parameter(Mandatory)] [string] $Source,
  [Parameter(Mandatory)] [string] $OutDir,
  [double] $Pitch = 1.5,
  [double] $SmallVolume = 0.45,
  [double] $Volume = 1
)
$ErrorActionPreference = 'Stop'

$bytes = [IO.File]::ReadAllBytes($Source)
if ($bytes.Length -lt 44 -or [Text.Encoding]::ASCII.GetString($bytes, 0, 4) -ne 'RIFF' -or [Text.Encoding]::ASCII.GetString($bytes, 8, 4) -ne 'WAVE') {
  throw "not a WAV file: $Source"
}

# Walk the chunks for fmt and data.
$pos = 12; $channels = 0; $rate = 0; $bits = 0; $format = 0; $dataAt = -1; $dataLen = 0
while ($pos + 8 -le $bytes.Length) {
  $id = [Text.Encoding]::ASCII.GetString($bytes, $pos, 4)
  $len = [BitConverter]::ToInt32($bytes, $pos + 4)
  if ($id -eq 'fmt ') {
    $format = [BitConverter]::ToUInt16($bytes, $pos + 8)
    $channels = [BitConverter]::ToUInt16($bytes, $pos + 10)
    $rate = [BitConverter]::ToInt32($bytes, $pos + 12)
    $bits = [BitConverter]::ToUInt16($bytes, $pos + 22)
  } elseif ($id -eq 'data') {
    $dataAt = $pos + 8; $dataLen = [Math]::Min($len, $bytes.Length - $dataAt)
  }
  $pos += 8 + $len + ($len % 2)
}
if ($format -ne 1 -or $bits -ne 16 -or $dataAt -lt 0 -or $channels -lt 1) {
  throw "only 16-bit PCM WAV is supported (got format $format, $bits bits)"
}

function Write-Wav([string] $path, [int16[]] $samples) {
  $out = New-Object IO.MemoryStream
  $w = New-Object IO.BinaryWriter($out)
  $w.Write([Text.Encoding]::ASCII.GetBytes('RIFF')); $w.Write([int](36 + $samples.Length * 2))
  $w.Write([Text.Encoding]::ASCII.GetBytes('WAVEfmt ')); $w.Write([int]16); $w.Write([int16]1)
  $w.Write([int16]$channels); $w.Write([int]$rate); $w.Write([int]($rate * $channels * 2))
  $w.Write([int16]($channels * 2)); $w.Write([int16]16)
  $w.Write([Text.Encoding]::ASCII.GetBytes('data')); $w.Write([int]($samples.Length * 2))
  foreach ($s in $samples) { $w.Write($s) }
  $w.Flush(); [IO.File]::WriteAllBytes($path, $out.ToArray())
}

$frames = [int][Math]::Floor($dataLen / (2 * $channels))
$src = New-Object 'int16[]' ($frames * $channels)
[Buffer]::BlockCopy($bytes, $dataAt, $src, 0, $frames * $channels * 2)

# Linear-interpolated resample: reading faster raises the pitch and shortens it.
$outFrames = [int][Math]::Floor(($frames - 1) / $Pitch)
$small = New-Object 'int16[]' ([Math]::Max(0, $outFrames) * $channels)
for ($i = 0; $i -lt $outFrames; $i++) {
  $p = $i * $Pitch; $j = [int][Math]::Floor($p); $f = $p - $j
  for ($c = 0; $c -lt $channels; $c++) {
    $a = $src[$j * $channels + $c]; $b = $src[($j + 1) * $channels + $c]
    $v = ($a + ($b - $a) * $f) * $SmallVolume * $Volume
    $small[$i * $channels + $c] = [int16][Math]::Max(-32768, [Math]::Min(32767, [Math]::Round($v)))
  }
}

New-Item -ItemType Directory -Force -Path $OutDir | Out-Null
$big = $src
if ($Volume -ne 1) {
  $big = New-Object 'int16[]' $src.Length
  for ($i = 0; $i -lt $src.Length; $i++) { $big[$i] = [int16][Math]::Round($src[$i] * $Volume) }
}
Write-Wav (Join-Path $OutDir 'big.wav') $big
Write-Wav (Join-Path $OutDir 'small.wav') $small
'ok'
