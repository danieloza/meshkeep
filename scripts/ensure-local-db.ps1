$ErrorActionPreference = 'Stop'

# Przygotowuje LOKALNA baze deweloperska. Produkcyjne migracje naklada platforma
# z katalogu dist/.openai/drizzle - ten skrypt jej nie dotyka.
#
# Wczesniej kazda migracja miala tu wlasna, recznie dopisana galaz. Nowa migracja
# po prostu nie byla nakladana i lokalna baza cicho rozjezdzala sie ze schematem.
# Teraz skrypt sam przechodzi po drizzle\*.sql po kolei.

$appRoot = Split-Path -Parent $PSScriptRoot
Set-Location -LiteralPath $appRoot

if (-not (Test-Path -LiteralPath 'dist\server\wrangler.json')) {
  & npm.cmd run build
  if ($LASTEXITCODE -ne 0) { throw 'Nie udalo sie zbudowac aplikacji.' }
}

function Invoke-D1Command([string]$Sql) {
  return (& npx.cmd wrangler d1 execute site-creator-d1 --local --command $Sql --persist-to .wrangler\state --config dist\server\wrangler.json 2>&1 | Out-String)
}

function Invoke-D1File([string]$Path) {
  & npx.cmd wrangler d1 execute site-creator-d1 --local --file $Path --persist-to .wrangler\state --config dist\server\wrangler.json
  if ($LASTEXITCODE -ne 0) { throw "Nie udalo sie nalozyc migracji $Path." }
}

# Rejestr nalozonych migracji. Istnieje tylko lokalnie.
Invoke-D1Command "CREATE TABLE IF NOT EXISTS _local_migrations (file TEXT PRIMARY KEY, applied_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000));" | Out-Null

$files = Get-ChildItem -LiteralPath 'drizzle' -Filter '*.sql' | Sort-Object Name
foreach ($file in $files) {
  $name = $file.Name
  if ((Invoke-D1Command "SELECT 'JUZ_JEST' AS znacznik FROM _local_migrations WHERE file = '$name';") -match 'JUZ_JEST') {
    continue
  }

  # Baza moze pochodzic sprzed rejestru. Jesli tabela zakladana przez ta migracje
  # juz istnieje, migracja zostala nalozona wczesniej - tylko ja odnotowujemy.
  $firstTable = $null
  foreach ($line in Get-Content -LiteralPath $file.FullName) {
    # Nazwa tabely bywa w odwrotnych apostrofach, ktore w PowerShellu sa znakiem
    # ucieczki - dopasowujemy je przez \W, zeby nie wpisywac ich doslownie.
    if ($line -match 'CREATE TABLE\s+\W?(\w+)\W?\s*\(') { $firstTable = $Matches[1]; break }
  }

  $alreadyThere = $false
  if ($firstTable) {
    $alreadyThere = (Invoke-D1Command "SELECT 'TABELA_JEST' AS znacznik FROM sqlite_master WHERE type='table' AND name='$firstTable';") -match 'TABELA_JEST'
  }

  if ($alreadyThere) {
    Write-Host "Pomijam $name - tabela $firstTable juz istnieje." -ForegroundColor DarkGray
  } else {
    Write-Host "Nakladam $name" -ForegroundColor Cyan
    Invoke-D1File $file.FullName
  }

  Invoke-D1Command "INSERT OR IGNORE INTO _local_migrations (file) VALUES ('$name');" | Out-Null
}

Write-Host "Lokalna baza jest zgodna ze schematem ($($files.Count) migracji)." -ForegroundColor Green
