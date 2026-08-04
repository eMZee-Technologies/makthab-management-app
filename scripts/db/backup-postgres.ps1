<#
.SYNOPSIS
  Full backup (schema + data) of the Makthab PostgreSQL database.

.DESCRIPTION
  Connects directly over TCP to whatever host:port server/.env's
  DATABASE_URL points at, using native pg_dump/pg_restore/psql/pg_dumpall.
  This is deliberately NOT routed through `docker compose exec`: this
  machine runs native Windows PostgreSQL services (17 on 5432, 18 on 5433)
  alongside a docker-compose Postgres container that *also* claims host
  port 5433. Whichever process actually owns that port at the OS level is
  the one the app, Prisma, and any DB GUI client are really talking to; a
  `docker compose exec` backup silently dumps the *container's* database
  instead, which can be a stale, disconnected copy. Connecting over TCP to
  DATABASE_URL's host:port guarantees we back up the database the app
  actually uses, whichever process that turns out to be.

  Two backup formats are produced by default:
    - Custom format (.dump)  -- `pg_dump -Fc`, compressed, supports parallel
      and selective restore via `pg_restore`. Best when restoring to the
      same or a newer Postgres major version with pg_restore available.
    - Plain SQL (.sql[.gz])  -- portable, diffable, restorable with nothing
      but `psql`. Works against managed providers (RDS, Cloud SQL,
      Supabase, ...) that don't expose shell access for pg_restore.

  Does not read or depend on docs/source-data/Maktab Detailed - Report.xlsx;
  it backs up only what's live in the database.

.PARAMETER OutDir
  Host directory to write backups to. Default: <repo>/backups (gitignored).

.PARAMETER Format
  Custom, Plain, or Both (default Both).

.PARAMETER EnvFile
  Path to the .env file to read DATABASE_URL from. Default: server/.env.
  Ignored for any connection parameter explicitly passed below.

.PARAMETER PgHost / PgPort / PgUser / PgPassword / Db
  Override individual connection parameters instead of parsing them from
  DATABASE_URL. Useful for backing up a different environment.

.PARAMETER PgBinDir
  Directory containing pg_dump.exe etc. Default: auto-detected -- first
  tries PATH, then scans "C:\Program Files\PostgreSQL\*\bin" for the
  highest version.

.PARAMETER IncludeGlobals
  Also dump cluster-level roles/grants via `pg_dumpall --globals-only`.
  Only useful when migrating to a brand-new cluster.

.PARAMETER Gzip
  Gzip-compress the plain SQL dump on the host (pure .NET GZipStream, no
  external gzip dependency). Ignored for -Format Custom (already compressed).

.EXAMPLE
  ./scripts/db/backup-postgres.ps1
  Reads server/.env, backs up whatever DATABASE_URL points at, both formats.

.EXAMPLE
  ./scripts/db/backup-postgres.ps1 -Format Plain -Gzip -IncludeGlobals
  Portable-only backup, gzipped, plus a globals dump -- good before a
  cross-server migration.
#>

param(
  [string]$OutDir = (Join-Path $PSScriptRoot "..\..\backups"),
  [ValidateSet("Custom", "Plain", "Both")]
  [string]$Format = "Both",
  [string]$EnvFile = (Join-Path $PSScriptRoot "..\..\server\.env"),
  [string]$PgHost,
  [string]$PgPort,
  [string]$PgUser,
  [string]$PgPassword,
  [string]$Db,
  [string]$PgBinDir,
  [switch]$IncludeGlobals,
  [switch]$Gzip
)

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

function Get-Sha256Hex {
  param([string]$Path)
  $sha = [System.Security.Cryptography.SHA256]::Create()
  try {
    $stream = [System.IO.File]::OpenRead($Path)
    try { $bytes = $sha.ComputeHash($stream) } finally { $stream.Close() }
  } finally { $sha.Dispose() }
  return -join ($bytes | ForEach-Object { $_.ToString("x2") })
}

function Resolve-PgBinDir {
  param([string]$Override)
  if ($Override) {
    if (-not (Test-Path (Join-Path $Override "pg_dump.exe"))) {
      throw "pg_dump.exe not found under -PgBinDir '$Override'"
    }
    return $Override
  }
  $onPath = Get-Command pg_dump.exe -ErrorAction SilentlyContinue
  if ($onPath) { return (Split-Path $onPath.Source -Parent) }

  $installs = Get-ChildItem "C:\Program Files\PostgreSQL" -Directory -ErrorAction SilentlyContinue |
    Where-Object { Test-Path (Join-Path $_.FullName "bin\pg_dump.exe") } |
    Sort-Object { [int]$_.Name } -Descending
  if ($installs.Count -gt 0) {
    return (Join-Path $installs[0].FullName "bin")
  }
  throw "Could not find pg_dump.exe on PATH or under C:\Program Files\PostgreSQL\*\bin. Pass -PgBinDir explicitly, or install the PostgreSQL client tools."
}

function Parse-DatabaseUrl {
  param([string]$Path)
  if (-not (Test-Path $Path)) {
    throw "Env file not found: $Path (pass -EnvFile, or supply -PgHost/-PgPort/-PgUser/-PgPassword/-Db directly)"
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

Push-Location $RepoRoot
try {
  $conn = Parse-DatabaseUrl -Path $EnvFile
  if (-not $PgHost) { $PgHost = $conn.Host }
  if (-not $PgPort) { $PgPort = $conn.Port }
  if (-not $PgUser) { $PgUser = $conn.User }
  if (-not $PgPassword) { $PgPassword = $conn.Password }
  if (-not $Db) { $Db = $conn.Db }

  $bin = Resolve-PgBinDir -Override $PgBinDir
  $pgDump = Join-Path $bin "pg_dump.exe"
  $pgRestore = Join-Path $bin "pg_restore.exe"
  $pgDumpall = Join-Path $bin "pg_dumpall.exe"
  $pgIsReady = Join-Path $bin "pg_isready.exe"
  $psql = Join-Path $bin "psql.exe"

  Write-Host "Target: $PgUser@$PgHost`:$PgPort/$Db  (tools: $bin)"

  $env:PGPASSWORD = $PgPassword
  try {
    Step "Checking Postgres is reachable" {
      & $pgIsReady -h $PgHost -p $PgPort -U $PgUser -d $Db | Out-Null
    }

    New-Item -ItemType Directory -Force -Path $OutDir | Out-Null
    $stamp = Get-Date -Format "yyyyMMdd_HHmmss"
    $base = "makthab_${Db}_${stamp}"

    $manifest = [ordered]@{
      createdAtUtc = (Get-Date).ToUniversalTime().ToString("o")
      database     = $Db
      host         = "$PgHost`:$PgPort"
      format       = $Format
      files        = @()
      tableCounts  = [ordered]@{}
    }

    # --- Row-count manifest (pre-dump, for post-restore verification) ------
    Step "Recording table row counts" {
      $sql = @"
select table_name, (xpath('/row/c/text()', query_to_xml(format('select count(*) as c from %I.%I', table_schema, table_name), false, true, '')))[1]::text::int as row_count
from information_schema.tables
where table_schema = 'public' and table_type = 'BASE TABLE'
order by table_name;
"@
      $out = & $psql -h $PgHost -p $PgPort -U $PgUser -d $Db -t -A -F"," -c $sql
      if ($LASTEXITCODE -ne 0) { throw "Row-count query failed" }
      foreach ($line in ($out -split "`n" | Where-Object { $_.Trim() })) {
        $parts = $line -split ","
        if ($parts.Count -eq 2) {
          $manifest.tableCounts[$parts[0].Trim()] = [int]$parts[1].Trim()
        }
      }
    }

    # --- Custom format (.dump) --------------------------------------------
    if ($Format -in @("Custom", "Both")) {
      $dumpName = "$base.dump"
      $dumpPath = Join-Path $OutDir $dumpName
      Step "pg_dump (custom format, compressed) -> $dumpName" {
        & $pgDump -h $PgHost -p $PgPort -U $PgUser -d $Db -Fc -Z 6 `
          --no-owner --no-privileges --encoding=UTF8 -f $dumpPath
      }
      Step "Verifying custom-format dump structure (pg_restore --list)" {
        $toc = & $pgRestore --list $dumpPath
        if ($LASTEXITCODE -ne 0 -or -not $toc) { throw "pg_restore --list found the dump unreadable" }
        Write-Host "    TOC entries: $((($toc -split "`n") | Measure-Object).Count)"
      }
      $manifest.files += $dumpName
    }

    # --- Plain SQL dump (.sql / .sql.gz) ------------------------------------
    if ($Format -in @("Plain", "Both")) {
      $sqlName = "$base.sql"
      $sqlPath = Join-Path $OutDir $sqlName
      Step "pg_dump (plain SQL) -> $sqlName" {
        & $pgDump -h $PgHost -p $PgPort -U $PgUser -d $Db -Fp `
          --no-owner --no-privileges --encoding=UTF8 -f $sqlPath
      }
      Step "Verifying plain SQL dump completeness" {
        $tail = Get-Content $sqlPath -Tail 5
        if (-not ($tail -match "PostgreSQL database dump complete")) {
          throw "$sqlName does not end with the expected pg_dump completion marker -- dump may be truncated"
        }
      }
      if ($Gzip) {
        $gzPath = "$sqlPath.gz"
        Step "Gzip-compressing $sqlName" {
          $inStream = [System.IO.File]::OpenRead($sqlPath)
          $outStream = [System.IO.File]::Create($gzPath)
          $gzStream = New-Object System.IO.Compression.GZipStream($outStream, [System.IO.Compression.CompressionLevel]::Optimal)
          $inStream.CopyTo($gzStream)
          $gzStream.Close(); $outStream.Close(); $inStream.Close()
        }
        Remove-Item $sqlPath
        $manifest.files += "$sqlName.gz"
      } else {
        $manifest.files += $sqlName
      }
    }

    # --- Globals (roles/grants) -- only needed for cross-cluster migration -
    if ($IncludeGlobals) {
      $globalsName = "${base}_globals.sql"
      $globalsPath = Join-Path $OutDir $globalsName
      Step "pg_dumpall --globals-only -> $globalsName" {
        & $pgDumpall -h $PgHost -p $PgPort -U $PgUser --globals-only -f $globalsPath
      }
      $manifest.files += $globalsName
    }

    # --- Manifest + checksums ----------------------------------------------
    $manifestPath = Join-Path $OutDir "$base.manifest.json"
    $checksums = [ordered]@{}
    foreach ($f in $manifest.files) {
      $checksums[$f] = Get-Sha256Hex -Path (Join-Path $OutDir $f)
    }
    $manifest.sha256 = $checksums
    $manifest | ConvertTo-Json -Depth 5 | Set-Content -Path $manifestPath -Encoding UTF8

    Write-Host ""
    Write-Host "Backup complete." -ForegroundColor Green
    foreach ($f in $manifest.files) {
      $sizeKb = [math]::Round((Get-Item (Join-Path $OutDir $f)).Length / 1KB, 1)
      Write-Host "  $f  (${sizeKb} KB)"
    }
    Write-Host "  $base.manifest.json  (row counts + SHA256 for verification)"
    Write-Host ""
    Write-Host "Restore with: ./scripts/db/restore-postgres.ps1 -BackupFile '$(Join-Path $OutDir $manifest.files[0])'"
  }
  finally {
    Remove-Item Env:\PGPASSWORD -ErrorAction SilentlyContinue
  }
}
finally {
  Pop-Location
}
