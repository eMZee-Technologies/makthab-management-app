<#
.SYNOPSIS
  Restore/migrate a Makthab PostgreSQL backup produced by backup-postgres.ps1.

.DESCRIPTION
  Connects directly over TCP using native pg_restore/psql -- see
  backup-postgres.ps1's header for why this is not routed through
  `docker compose exec`: this machine has multiple Postgres processes
  (native services and a docker-compose container) that can each claim
  host port 5433, and only a direct TCP connection to DATABASE_URL's
  host:port is guaranteed to reach the database the app actually uses.

  Auto-detects format from the file extension:
    .dump          -> pg_restore (custom format)
    .sql           -> psql (plain SQL)
    .sql.gz        -> decompressed to a host temp file, then psql

  A full pg_dump-based backup already contains the Prisma migration-history
  table (_prisma_migrations), so a successful restore leaves the database in
  exactly the state `npx prisma migrate deploy` would have -- there is no
  need to re-run migrations or `npm run migrate:xlsx` afterwards.

.PARAMETER BackupFile
  Path to the .dump, .sql, or .sql.gz file to restore.

.PARAMETER TargetDb
  Database to restore into. Defaults to the source DB name embedded in the
  manifest, or the Db parsed from DATABASE_URL if no manifest is found.
  Use a scratch name (e.g. makthab_dev_verify) to dry-run a restore without
  touching the live database -- see the "verify" example below.

.PARAMETER DropExisting
  Drop and recreate TargetDb before restoring, for a guaranteed-clean slate.

.PARAMETER EnvFile
  Path to the .env file to read DATABASE_URL from (host/port/user/password).
  Default: server/.env. Ignored for any connection parameter passed below.

.PARAMETER PgHost / PgPort / PgUser / PgPassword
  Override individual connection parameters instead of parsing DATABASE_URL.

.PARAMETER PgBinDir
  Directory containing pg_restore.exe etc. Default: auto-detected -- see
  backup-postgres.ps1.

.PARAMETER Jobs
  Parallel restore jobs for the custom-format path (pg_restore -j). Default: 4.

.PARAMETER Force
  Skip the interactive confirmation prompt. Use in scripted/CI contexts only.

.EXAMPLE
  ./scripts/db/restore-postgres.ps1 -BackupFile .\backups\makthab_makthab_dev_20260803_120000.dump -DropExisting

.EXAMPLE
  # Dry-run a restore into a scratch DB to verify a backup before trusting it
  ./scripts/db/restore-postgres.ps1 -BackupFile .\backups\...sql.gz -TargetDb makthab_dev_verify -DropExisting
#>

param(
  [Parameter(Mandatory = $true)]
  [string]$BackupFile,
  [string]$TargetDb,
  [switch]$DropExisting,
  [string]$EnvFile,
  [string]$PgHost,
  [string]$PgPort,
  [string]$PgUser,
  [string]$PgPassword,
  [string]$PgBinDir,
  [int]$Jobs = 4,
  [switch]$Force
)

# NOTE: $EnvFile's default can't be set in the param block above -- Windows
# PowerShell 5.1 leaves $PSScriptRoot empty while evaluating a later
# parameter's default expression whenever an earlier parameter is marked
# Mandatory. Set it here instead, once the script body actually runs.
if (-not $EnvFile) { $EnvFile = Join-Path $PSScriptRoot "..\..\server\.env" }

$ErrorActionPreference = "Stop"
$RepoRoot = Resolve-Path (Join-Path $PSScriptRoot "..\..")

function Step {
  param([string]$Description, [scriptblock]$Action)
  Write-Host "==> $Description" -ForegroundColor Cyan
  & $Action
  if ($LASTEXITCODE -ne 0) {
    throw "$Description failed with exit code $LASTEXITCODE"
  }
}

function Resolve-PgBinDir {
  param([string]$Override)
  if ($Override) {
    if (-not (Test-Path (Join-Path $Override "pg_restore.exe"))) {
      throw "pg_restore.exe not found under -PgBinDir '$Override'"
    }
    return $Override
  }
  $onPath = Get-Command pg_restore.exe -ErrorAction SilentlyContinue
  if ($onPath) { return (Split-Path $onPath.Source -Parent) }

  $installs = Get-ChildItem "C:\Program Files\PostgreSQL" -Directory -ErrorAction SilentlyContinue |
    Where-Object { Test-Path (Join-Path $_.FullName "bin\pg_restore.exe") } |
    Sort-Object { [int]$_.Name } -Descending
  if ($installs.Count -gt 0) {
    return (Join-Path $installs[0].FullName "bin")
  }
  throw "Could not find pg_restore.exe on PATH or under C:\Program Files\PostgreSQL\*\bin. Pass -PgBinDir explicitly, or install the PostgreSQL client tools."
}

function Parse-DatabaseUrl {
  param([string]$Path)
  if (-not (Test-Path $Path)) {
    throw "Env file not found: $Path (pass -EnvFile, or supply -PgHost/-PgPort/-PgUser/-PgPassword directly)"
  }
  $line = (Get-Content $Path) | Where-Object { $_ -match '^\s*DATABASE_URL\s*=' } | Select-Object -Last 1
  if (-not $line) { throw "No DATABASE_URL found in $Path" }
  $value = ($line -split '=', 2)[1].Trim().Trim('"')
  if ($value -notmatch '^postgres(ql)?://(?<user>[^:@/]+)(:(?<pass>[^@]*))?@(?<host>[^:/]+):(?<port>\d+)/(?<db>[^?]+)') {
    throw "DATABASE_URL in $Path is not a postgres:// connection string: $value"
  }
  return [ordered]@{
    Host = $Matches.host
    Port = $Matches.port
    User = $Matches.user
    Password = $Matches.pass
    Db = $Matches.db
  }
}

if (-not (Test-Path $BackupFile)) {
  throw "Backup file not found: $BackupFile"
}
$BackupFile = (Resolve-Path $BackupFile).Path

# --- Resolve manifest (row counts to verify against) ------------------------
$manifest = $null
$manifestGuess = [System.IO.Path]::Combine(
  (Split-Path $BackupFile -Parent),
  ((Split-Path $BackupFile -Leaf) -replace '\.(dump|sql|sql\.gz)$', '') + ".manifest.json"
)
if (Test-Path $manifestGuess) {
  $manifest = Get-Content $manifestGuess -Raw | ConvertFrom-Json
  Write-Host "Found manifest: $manifestGuess"
}

$isGz = $BackupFile -like "*.sql.gz"
$isCustom = $BackupFile -like "*.dump"
$isPlain = $BackupFile -like "*.sql" -and -not $isGz

if (-not ($isGz -or $isCustom -or $isPlain)) {
  throw "Unrecognized backup extension for '$BackupFile' -- expected .dump, .sql, or .sql.gz"
}

Push-Location $RepoRoot
try {
  $conn = Parse-DatabaseUrl -Path $EnvFile
  if (-not $PgHost) { $PgHost = $conn.Host }
  if (-not $PgPort) { $PgPort = $conn.Port }
  if (-not $PgUser) { $PgUser = $conn.User }
  if (-not $PgPassword) { $PgPassword = $conn.Password }
  if (-not $TargetDb) {
    $TargetDb = if ($manifest) { $manifest.database } else { $conn.Db }
  }

  $bin = Resolve-PgBinDir -Override $PgBinDir
  $pgRestore = Join-Path $bin "pg_restore.exe"
  $pgIsReady = Join-Path $bin "pg_isready.exe"
  $psql = Join-Path $bin "psql.exe"

  Write-Host "Target: $PgUser@$PgHost`:$PgPort/$TargetDb  (tools: $bin)"

  $env:PGPASSWORD = $PgPassword
  try {
    Step "Checking Postgres is reachable" {
      & $pgIsReady -h $PgHost -p $PgPort -U $PgUser | Out-Null
    }

    # --- Confirmation -----------------------------------------------------
    $verb = if ($DropExisting) { "DROP AND RECREATE" } else { "restore into (existing objects kept)" }
    Write-Host ""
    Write-Host "About to $verb database '$TargetDb' on $PgHost`:$PgPort from:" -ForegroundColor Yellow
    Write-Host "  $BackupFile"
    if (-not $Force) {
      $answer = Read-Host "Type the database name ('$TargetDb') to confirm"
      if ($answer -ne $TargetDb) {
        throw "Confirmation did not match '$TargetDb' -- aborting."
      }
    }

    $sourcePath = $BackupFile
    if ($isGz) {
      $decompressed = [System.IO.Path]::Combine([System.IO.Path]::GetTempPath(), ([System.IO.Path]::GetFileNameWithoutExtension($BackupFile)))
      Step "Decompressing $(Split-Path $BackupFile -Leaf)" {
        $inFile = New-Object System.IO.FileStream($BackupFile, [System.IO.FileMode]::Open, [System.IO.FileAccess]::Read)
        $gz = New-Object System.IO.Compression.GZipStream($inFile, [System.IO.Compression.CompressionMode]::Decompress)
        $outFile = [System.IO.File]::Create($decompressed)
        $gz.CopyTo($outFile)
        $outFile.Close(); $gz.Close(); $inFile.Close()
      }
      $sourcePath = $decompressed
    }

    # --- Drop/create target DB --------------------------------------------
    if ($DropExisting) {
      Step "Dropping existing connections to '$TargetDb' (if any)" {
        $sql = "select pg_terminate_backend(pid) from pg_stat_activity where datname = '$TargetDb' and pid <> pg_backend_pid();"
        & $psql -h $PgHost -p $PgPort -U $PgUser -d postgres -c $sql | Out-Null
        $global:LASTEXITCODE = 0
      }
      Step "Dropping database '$TargetDb' if it exists" {
        & $psql -h $PgHost -p $PgPort -U $PgUser -d postgres -c "drop database if exists `"$TargetDb`";"
      }
      Step "Creating database '$TargetDb'" {
        & $psql -h $PgHost -p $PgPort -U $PgUser -d postgres -c "create database `"$TargetDb`" encoding 'UTF8';"
      }
    } else {
      Step "Ensuring database '$TargetDb' exists" {
        $exists = & $psql -h $PgHost -p $PgPort -U $PgUser -d postgres -t -A -c "select 1 from pg_database where datname = '$TargetDb';"
        if ($exists.Trim() -ne "1") {
          & $psql -h $PgHost -p $PgPort -U $PgUser -d postgres -c "create database `"$TargetDb`" encoding 'UTF8';"
        }
      }
    }

    # --- Restore -----------------------------------------------------------
    if ($isCustom) {
      Step "pg_restore (custom format, $Jobs parallel jobs)" {
        & $pgRestore -h $PgHost -p $PgPort -U $PgUser -d $TargetDb `
          --no-owner --no-privileges -j $Jobs --exit-on-error $sourcePath
      }
    } else {
      Step "psql restore (plain SQL, ON_ERROR_STOP)" {
        & $psql -h $PgHost -p $PgPort -U $PgUser -d $TargetDb -v ON_ERROR_STOP=1 -f $sourcePath
      }
    }

    if ($isGz -and (Test-Path $sourcePath)) {
      Remove-Item $sourcePath
    }

    # --- Post-restore verification ------------------------------------------
    Write-Host ""
    Write-Host "==> Verifying row counts" -ForegroundColor Cyan
    $sql = @"
select table_name, (xpath('/row/c/text()', query_to_xml(format('select count(*) as c from %I.%I', table_schema, table_name), false, true, '')))[1]::text::int as row_count
from information_schema.tables
where table_schema = 'public' and table_type = 'BASE TABLE'
order by table_name;
"@
    $out = & $psql -h $PgHost -p $PgPort -U $PgUser -d $TargetDb -t -A -F"," -c $sql
    $mismatch = $false
    foreach ($line in ($out -split "`n" | Where-Object { $_.Trim() })) {
      $parts = $line -split ","
      if ($parts.Count -ne 2) { continue }
      $table = $parts[0].Trim(); $count = [int]$parts[1].Trim()
      if ($manifest -and $manifest.tableCounts.$table -ne $null) {
        $expected = [int]$manifest.tableCounts.$table
        if ($expected -ne $count) {
          Write-Host "  MISMATCH  $table : expected $expected, got $count" -ForegroundColor Red
          $mismatch = $true
        } else {
          Write-Host "  OK        $table : $count"
        }
      } else {
        Write-Host "  (no baseline) $table : $count"
      }
    }

    if ($mismatch) {
      throw "Row count verification failed -- restored data does not match the backup manifest."
    }

    Write-Host ""
    Write-Host "Restore complete and verified." -ForegroundColor Green
    if ($manifest) {
      Write-Host "Database '$TargetDb' now matches the backup taken at $($manifest.createdAtUtc)."
    }
    Write-Host "No need to run 'npm run db:deploy:pg' or 'npm run migrate:xlsx' -- the dump already includes schema + _prisma_migrations history."
  }
  finally {
    Remove-Item Env:\PGPASSWORD -ErrorAction SilentlyContinue
  }
}
finally {
  Pop-Location
}
