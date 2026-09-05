param(
  [Parameter(Mandatory = $true)][string]$ProjectId,
  [Parameter(Mandatory = $true)][string]$Folder,
  [Parameter(Mandatory = $true)][ValidatePattern('^https?://')][string]$ApiUrl,
  [switch]$Watch,
  [switch]$PropagateDeletes,
  [ValidateRange(10, 300)][int]$IntervalSeconds = 20
)

$ErrorActionPreference = 'Stop'
if ($PSVersionTable.PSVersion.Major -lt 5) {
  throw 'This agent requires Windows PowerShell 5.1 or newer.'
}
# Windows PowerShell 5.1 does not load System.Net.Http automatically. Without
# this, Send-ProjectFile fails before it can create HttpClient.
Add-Type -AssemblyName System.Net.Http
$allowedExtensions = @('.txt','.md','.json','.csv','.ts','.tsx','.js','.jsx','.mjs','.cjs','.py','.go','.rs','.java','.kt','.swift','.css','.scss','.html','.xml','.yaml','.yml','.toml','.sql','.sh','.ps1','.bat','.zip','.pdf','.rtf','.doc','.docx','.xls','.xlsx','.ppt','.pptx','.png','.jpg','.jpeg','.webp','.gif','.bmp')
$blockedDirectories = @('.git','.svn','.hg','.ssh','.aws','.azure','node_modules','.next','dist','build','coverage','.cache','tmp','temp','__pycache__')
$blockedNames = @('.env','.dev.vars','credentials.json','token.json','secret.json','secrets.json','service-account.json','service_account.json','serviceaccount.json','id_rsa','id_ed25519')
$root = (Resolve-Path -LiteralPath $Folder).Path.TrimEnd('\')
$api = $ApiUrl.TrimEnd('/')
$agentRoot = Join-Path $env:LOCALAPPDATA 'MeshKeep'
New-Item -ItemType Directory -Force -Path $agentRoot | Out-Null
$tokenPath = Join-Path $agentRoot 'sync-token.dat'

if (Test-Path -LiteralPath $tokenPath) {
  # ConvertTo-SecureString rejects the trailing CRLF added by Set-Content.
  $secureToken = (Get-Content -Raw -LiteralPath $tokenPath).Trim() | ConvertTo-SecureString
} else {
  $secureToken = Read-Host 'Paste the agent key from the dashboard once' -AsSecureString
  # Write UTF-8 without BOM or a trailing newline for reliable DPAPI restore.
  [IO.File]::WriteAllText($tokenPath, ($secureToken | ConvertFrom-SecureString), (New-Object Text.UTF8Encoding $false))
}

$pointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secureToken)
try { $token = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($pointer) } finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($pointer) }
if ($token -notmatch '^meshkeep_[A-Za-z0-9_-]{40,100}$') { throw 'The agent key has an invalid format.' }
$headers = @{ Authorization = "Bearer $token" }
$stateKeyBytes = [Text.Encoding]::UTF8.GetBytes("$api|$ProjectId|$root")
# Windows PowerShell 5.1 does not provide Convert.ToHexString or SHA256.HashData.
$sha = [Security.Cryptography.SHA256]::Create()
try {
  $stateKey = ([BitConverter]::ToString($sha.ComputeHash($stateKeyBytes)) -replace '-', '').ToLowerInvariant()
} finally {
  $sha.Dispose()
}
$statePath = Join-Path $agentRoot "$stateKey.json"
$known = @{}
if (Test-Path -LiteralPath $statePath) {
  # ConvertFrom-Json -AsHashtable requires PowerShell 7, so build the map here.
  $stored = Get-Content -Raw -LiteralPath $statePath | ConvertFrom-Json
  if ($stored) {
    foreach ($property in $stored.PSObject.Properties) { $known[$property.Name] = [string]$property.Value }
  }
}

function Test-SafeFile([IO.FileInfo]$File, [string]$RelativePath) {
  if ($File.Length -le 0 -or $File.Length -gt 15MB) { return $false }
  if ($allowedExtensions -notcontains $File.Extension.ToLowerInvariant()) { return $false }
  $parts = $RelativePath.Replace('\','/').Split('/')
  if ($parts | Where-Object { $blockedDirectories -contains $_.ToLowerInvariant() }) { return $false }
  $name = $File.Name.ToLowerInvariant()
  if ($blockedNames -contains $name -or $name -like '.env.*' -or $name -match '\.(pem|key|p12|pfx)$') { return $false }
  return $true
}

function Send-ProjectFile([IO.FileInfo]$File, [string]$RelativePath) {
  $client = [Net.Http.HttpClient]::new()
  $client.DefaultRequestHeaders.Authorization = [Net.Http.Headers.AuthenticationHeaderValue]::new('Bearer', $token)
  $multipart = [Net.Http.MultipartFormDataContent]::new()
  try {
    $fileContent = [Net.Http.ByteArrayContent]::new([IO.File]::ReadAllBytes($File.FullName))
    $fileContent.Headers.ContentType = [Net.Http.Headers.MediaTypeHeaderValue]::new('application/octet-stream')
    $fileDisposition = [Net.Http.Headers.ContentDispositionHeaderValue]::new('form-data')
    $fileDisposition.Name = '"files"'
    $fileDisposition.FileName = '"' + $File.Name.Replace('"', '') + '"'
    $fileContent.Headers.ContentDisposition = $fileDisposition
    $multipart.Add($fileContent)
    $pathContent = [Net.Http.StringContent]::new((ConvertTo-Json @($RelativePath) -Compress))
    $pathDisposition = [Net.Http.Headers.ContentDispositionHeaderValue]::new('form-data')
    $pathDisposition.Name = '"paths"'
    $pathContent.Headers.ContentDisposition = $pathDisposition
    $multipart.Add($pathContent)
    $response = $client.PostAsync("$api/api/projects/$ProjectId/files", $multipart).GetAwaiter().GetResult()
    if (-not $response.IsSuccessStatusCode) {
      $message = $response.Content.ReadAsStringAsync().GetAwaiter().GetResult()
      throw "The server rejected file $RelativePath ($([int]$response.StatusCode)): $message"
    }
  } finally {
    $multipart.Dispose()
    $client.Dispose()
  }
}

function Remove-CloudFiles([string[]]$Paths) {
  $body = @{ paths = @($Paths) } | ConvertTo-Json -Compress
  try {
    return Invoke-RestMethod -Method Delete -Uri "$api/api/projects/$ProjectId/files" -Headers $headers -Body $body -ContentType 'application/json'
  } catch {
    $message = $_.Exception.Message
    try {
      $reader = New-Object IO.StreamReader($_.Exception.Response.GetResponseStream())
      $parsed = $reader.ReadToEnd() | ConvertFrom-Json
      $reader.Close()
      if ($parsed.error) { $message = $parsed.error }
    } catch { }
    Write-Warning "The server rejected deletion: $message"
    return $null
  }
}

function Invoke-SyncPass {
  $setting = Invoke-RestMethod -Method Get -Uri "$api/api/sync" -Headers $headers
  if (-not $setting.enabled) { Write-Host 'Sync is disabled in the dashboard.'; return }
  $uploaded = 0
  $seen = @{}
  foreach ($file in Get-ChildItem -LiteralPath $root -File -Recurse) {
    $relative = $file.FullName.Substring($root.Length).TrimStart('\').Replace('\','/')
    # Notujemy KAZDY plik obecny na dysku, jeszcze przed filtrem bezpieczenstwa.
    # Plik, ktory istnieje, ale przestal sie kwalifikowac (urosl ponad 15 MB,
    # dostal zablokowana nazwe), ma zostac w chmurze - on nie zniknal.
    $seen[$relative] = $true
    if (-not (Test-SafeFile $file $relative)) { continue }
    $hash = (Get-FileHash -LiteralPath $file.FullName -Algorithm SHA256).Hash.ToLowerInvariant()
    if ($known[$relative] -eq $hash) { continue }
    Send-ProjectFile $file $relative
    $known[$relative] = $hash
    $uploaded += 1
    Write-Host "Uploaded: $relative"
  }
  $removed = 0
  if ($PropagateDeletes) {
    $gone = @($known.Keys | Where-Object { -not $seen.ContainsKey($_) })
    if ($gone.Count -gt 0 -and $seen.Count -eq 0) {
      # Folder istnieje, ale nie ma w nim ani jednego pliku. Prawie zawsze znaczy
      # to odmontowany dysk, zmieniona litera albo brak uprawnien, a nie
      # skasowanie calej zawartosci. Z poziomu skryptu te dwa przypadki wygladaja
      # identycznie, wiec nie zgadujemy - to jest ta pomylka, ktora kasuje dane.
      Write-Warning "Folder $root contains no files, while the agent tracks $($gone.Count). Cloud deletion was skipped. If you intentionally emptied the folder, delete the files in the dashboard."
    } elseif ($gone.Count -gt 0) {
      for ($offset = 0; $offset -lt $gone.Count; $offset += 200) {
        $chunk = @($gone[$offset..([Math]::Min($offset + 199, $gone.Count - 1))])
        $result = Remove-CloudFiles $chunk
        if ($null -eq $result) { break }
        # Odpowiedz 2xx zamyka sprawe calej paczki: pliki albo zostaly usuniete,
        # albo juz ich w chmurze nie bylo. Zdejmujemy je ze stanu, zeby agent nie
        # pytal o nie w kolko. Po bledzie stanu NIE ruszamy, wiec nastepny
        # przebieg sprobuje jeszcze raz.
        foreach ($item in $chunk) { $known.Remove($item); Write-Host "Deleted from cloud: $item" }
        $removed += [int]$result.deleted
      }
    }
  }
  [IO.File]::WriteAllText($statePath, ($known | ConvertTo-Json), (New-Object Text.UTF8Encoding $false))
  Write-Host "Sync complete. Changed files: $uploaded. Deleted from cloud: $removed"
}

do {
  Invoke-SyncPass
  if ($Watch) { Start-Sleep -Seconds $IntervalSeconds }
} while ($Watch)
