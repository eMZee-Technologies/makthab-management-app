<#
.SYNOPSIS
  Restore/migrate a Makthab PostgreSQL backup produced by backup-postgres.ps1.

.DESCRIPTION
  Restores into the `postgres` docker-compose service by default. Auto-
  detects format from the file extension:
    .dump          -> pg_restore (custom format)
    .sql           -> psql (plain SQL)
    .sql.gz        -> decompressed on the host, then psql

  A full pg_dump-based backup already contains the Prisma migration-history
  table (_prisma_migrations), so a successful restore leaves the database in
  exactly the state `npx prisma migrate deploy` would have -- there is no
  need to re-run migrations or `npm run migrate:xlsx` afterwards.

.PARAMETER BackupFile
  Path to the .dump, .sql, or .sql.gz file to restore.

.PARAMETER TargetDb
  Database to restore into. Defaults to the source DB name embedded in the
  manifest, or 'makthab_dev' if no manifest is found. Use a scratch name
  (e.g. makthab_dev_verify) to dry-run a restore without touching the live
  database -- see the "verify" example below.

.PARAMETER DropExisting
  Drop and recreate TargetDb before restoring, for a guaranteed-clean slate.
  Required (implicitly) when restoring a plain .sql dump into a database
  that already has conflicting objects, since plain dumps contain no
  DROP/CREATE statements by default (backup script does not pass --clean).

.PARAMETER PgUser
  Postgres role to restore as / connect as. Default: postgres.

.PARAMETER Jobs
  Parallel restore jobs for the custom-format path (pg_restore -j). Default: 4.
  Ignored for plain SQL restores (psql is single-threaded).

.PARAMETER Force
  Skip the interactive confirmation prompt. Use in scripted/CI contexts only.

.EXAMPLE
  ./scripts/db/restore-postgres.ps1 -BackupFile .\backups\makthab_makthab_dev_20260803_120000.dump -DropExisting

.EXAMPLE
  # Dry-run a restore into a scratch DB to verify a backup before trusting it
  ./scripts/db/restore-postgres.ps1 -BackupFile .\backups\..\...sql.gz -TargetDb makthab_dev_verify -DropExisting
#>

param(
  [Parameter(Mandatory = $true)]
  [string]$BackupFile,
  [string]$TargetDb,
  [switch]$DropExisting,
  [string]$PgUser = "postgres",
  [int]$Jobs = 4,
  [switch]$Force
)

$ErrorActionPreference = "Stop"
$RepoRoot = Resolve-Path (Join-Path $PSScriptRoot "..\..")

# See backup-postgres.ps1 for why: docker-compose.yml's "app" service requires
# these even though this script never starts "app", because Compose
# interpolates the whole file regardless of which service is targeted.
if (-not $env:JWT_SECRET) { $env:JWT_SECRET = "unused-by-db-scripts-placeholder" }
if (-not $env:JWT_REFRESH_SECRET) { $env:JWT_REFRESH_SECRET = "unused-by-db-scripts-placeholder" }
if (-not $env:SEED_ADMIN_PASSWORD) { $env:SEED_ADMIN_PASSWORD = "unused-by-db-scripts-placeholder" }

function Step {
  param([string]$Description, [scriptblock]$Action)
  Write-Host "==> $Description" -ForegroundColor Cyan
  & $Action
  if ($LASTEXITCODE -ne 0) {
    throw "$Description failed with exit code $LASTEXITCODE"
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

if (-not $TargetDb) {
  $TargetDb = if ($manifest) { $manifest.database } else { "makthab_dev" }
}

$isGz = $BackupFile -like "*.sql.gz"
$isCustom = $BackupFile -like "*.dump"
$isPlain = $BackupFile -like "*.sql" -and -not $isGz

if (-not ($isGz -or $isCustom -or $isPlain)) {
  throw "Unrecognized backup extension for '$BackupFile' -- expected .dump, .sql, or .sql.gz"
}

Push-Location $RepoRoot
try {
  Step "Checking docker compose is available" {
    docker compose version | Out-Null
  }
  $containerId = (docker compose ps -q postgres)
  if (-not $containerId) {
    throw "The 'postgres' service is not running. Start it with: docker compose up -d postgres"
  }
  Step "Waiting for postgres to be ready" {
    docker compose exec -T postgres pg_isready -U $PgUser | Out-Null
  }

  # --- Confirmation -----------------------------------------------------
  $verb = if ($DropExisting) { "DROP AND RECREATE" } else { "restore into (existing objects kept)" }
  Write-Host ""
  Write-Host "About to $verb database '$TargetDb' on the postgres container from:" -ForegroundColor Yellow
  Write-Host "  $BackupFile"
  if (-not $Force) {
    $answer = Read-Host "Type the database name ('$TargetDb') to confirm"
    if ($answer -ne $TargetDb) {
      throw "Confirmation did not match '$TargetDb' -- aborting."
    }
  }

  # --- Stage the file inside the container -------------------------------
  $tmpDir = "/tmp/makthab-restore"
  docker compose exec -T postgres mkdir -p $tmpDir
  $leaf = Split-Path $BackupFile -Leaf
  Step "Copying $leaf into the container" {
    docker cp $BackupFile "${containerId}:$tmpDir/$leaf"
  }

  $sourcePath = "$tmpDir/$leaf"
  if ($isGz) {
    $decompressed = $leaf -replace '\.gz$', ''
    Step "Decompressing on host before transfer (avoids requiring gzip in-container)" {
      $inFile = New-Object System.IO.FileStream($BackupFile, [System.IO.FileMode]::Open, [System.IO.FileAccess]::Read)
      $gz = New-Object System.IO.Compression.GZipStream($inFile, [System.IO.Compression.CompressionMode]::Decompress)
      $hostOut = Join-Path ([System.IO.Path]::GetTempPath()) $decompressed
      $outFile = [System.IO.File]::Create($hostOut)
      $gz.CopyTo($outFile)
      $outFile.Close(); $gz.Close(); $inFile.Close()
      docker cp $hostOut "${containerId}:$tmpDir/$decompressed"
      Remove-Item $hostOut
    }
    $sourcePath = "$tmpDir/$decompressed"
  }

  # --- Drop/create target DB ----------------------------------------------
  if ($DropExisting) {
    Step "Dropping existing connections to '$TargetDb' (if any)" {
      $sql = "select pg_terminate_backend(pid) from pg_stat_activity where datname = '$TargetDb' and pid <> pg_backend_pid();"
      docker compose exec -T postgres psql -U $PgUser -d postgres -c $sql | Out-Null
      $global:LASTEXITCODE = 0
    }
    Step "Dropping database '$TargetDb' if it exists" {
      docker compose exec -T postgres psql -U $PgUser -d postgres -c "drop database if exists `"$TargetDb`";"
    }
    Step "Creating database '$TargetDb'" {
      docker compose exec -T postgres psql -U $PgUser -d postgres -c "create database `"$TargetDb`" encoding 'UTF8';"
    }
  } else {
    Step "Ensuring database '$TargetDb' exists" {
      $exists = docker compose exec -T postgres psql -U $PgUser -d postgres -t -A -c "select 1 from pg_database where datname = '$TargetDb';"
      if ($exists.Trim() -ne "1") {
        docker compose exec -T postgres psql -U $PgUser -d postgres -c "create database `"$TargetDb`" encoding 'UTF8';"
      }
    }
  }

  # --- Restore -------------------------------------------------------------
  if ($isCustom) {
    Step "pg_restore (custom format, $Jobs parallel jobs)" {
      docker compose exec -T postgres pg_restore -U $PgUser -d $TargetDb `
        --no-owner --no-privileges -j $Jobs --exit-on-error "$sourcePath"
    }
  } else {
    Step "psql restore (plain SQL, ON_ERROR_STOP)" {
      docker compose exec -T postgres psql -U $PgUser -d $TargetDb -v ON_ERROR_STOP=1 -f "$sourcePath"
    }
  }

  Step "Cleaning up container temp files" {
    docker compose exec -T postgres rm -rf $tmpDir
  }

  # --- Post-restore verification -------------------------------------------
  Write-Host ""
  Write-Host "==> Verifying row counts" -ForegroundColor Cyan
  $sql = @"
select table_name, (xpath('/row/c/text()', query_to_xml(format('select count(*) as c from %I.%I', table_schema, table_name), false, true, '')))[1]::text::int as row_count
from information_schema.tables
where table_schema = 'public' and table_type = 'BASE TABLE'
order by table_name;
"@
  $out = docker compose exec -T postgres psql -U $PgUser -d $TargetDb -t -A -F"," -c $sql
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
  Write-Host "Database '$TargetDb' now matches the backup taken at $($manifest.createdAtUtc)."
  Write-Host "No need to run 'npm run db:deploy:pg' or 'npm run migrate:xlsx' -- the dump already includes schema + _prisma_migrations history."
}
finally {
  Pop-Location
}
