<#
.SYNOPSIS
  Full backup (schema + data) of the Makthab PostgreSQL database.

.DESCRIPTION
  Targets the `postgres` service defined in docker-compose.yml (Postgres 16,
  DB `makthab_dev`, bound to 127.0.0.1:5433 -- see server/.env DATABASE_URL).
  Produces two independent backup formats by default:

    - Custom format (.dump)  -- `pg_dump -Fc`, compressed, supports parallel
      and selective restore via `pg_restore`. Best when restoring to the
      same or a newer Postgres major version with pg_restore available.
    - Plain SQL (.sql[.gz])  -- portable, diffable, restorable with nothing
      but `psql`. Works against managed providers (RDS, Cloud SQL,
      Supabase, ...) that don't expose shell access for pg_restore.

  pg_dump is run *inside* the postgres container (docker compose exec) so
  its version always matches the server, then copied to the host with
  `docker cp`. Dumping to a file inside the container first -- rather than
  piping pg_dump's stdout straight into a PowerShell redirect -- avoids
  PowerShell's text-redirection mangling the binary custom-format output.

  Does not read or depend on docs/source-data/Maktab Detailed - Report.xlsx;
  it backs up only what's live in the database.

.PARAMETER OutDir
  Host directory to write backups to. Default: <repo>/backups (gitignored;
  add `backups/` to .gitignore if not already present).

.PARAMETER Format
  Custom, Plain, or Both (default Both).

.PARAMETER Db
  Database name. Default: makthab_dev (matches docker-compose.yml POSTGRES_DB).

.PARAMETER PgUser
  Postgres role used for the dump. Default: postgres.

.PARAMETER IncludeGlobals
  Also dump cluster-level roles/grants via `pg_dumpall --globals-only`.
  Only useful when migrating to a brand-new cluster; skip for routine
  same-cluster backups (there's only the one `postgres` role here).

.PARAMETER Gzip
  Gzip-compress the plain SQL dump on the host (pure .NET GZipStream, no
  external gzip dependency). Ignored for -Format Custom (already compressed).

.EXAMPLE
  ./scripts/db/backup-postgres.ps1
  Produces both formats in ./backups.

.EXAMPLE
  ./scripts/db/backup-postgres.ps1 -Format Plain -Gzip -IncludeGlobals
  Portable-only backup, gzipped, plus a globals dump -- good before a
  cross-server migration.
#>

param(
  [string]$OutDir = (Join-Path $PSScriptRoot "..\..\backups"),
  [ValidateSet("Custom", "Plain", "Both")]
  [string]$Format = "Both",
  [string]$Db = "makthab_dev",
  [string]$PgUser = "postgres",
  [switch]$IncludeGlobals,
  [switch]$Gzip
)

$ErrorActionPreference = "Stop"
$RepoRoot = Resolve-Path (Join-Path $PSScriptRoot "..\..")

# docker-compose.yml requires JWT_SECRET / JWT_REFRESH_SECRET / SEED_ADMIN_PASSWORD
# for its "full" profile "app" service. Compose interpolates the whole file up
# front even when this script only ever targets the "postgres" service, so
# without these set any `docker compose ...` call below fails before it can
# even reach postgres. These placeholders are never used by anything this
# script runs; only set them if the caller hasn't already supplied real ones.
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

function Exec-InContainer {
  param([string[]]$CmdArgs)
  & docker compose exec -T postgres @CmdArgs
  if ($LASTEXITCODE -ne 0) {
    throw "docker compose exec postgres $($CmdArgs -join ' ') failed with exit code $LASTEXITCODE"
  }
}

function Get-Sha256Hex {
  # Avoids depending on Get-FileHash's module autoload, which can be shadowed
  # by an unrelated PowerShell install earlier on PSModulePath.
  param([string]$Path)
  $sha = [System.Security.Cryptography.SHA256]::Create()
  try {
    $stream = [System.IO.File]::OpenRead($Path)
    try {
      $bytes = $sha.ComputeHash($stream)
    } finally {
      $stream.Close()
    }
  } finally {
    $sha.Dispose()
  }
  return -join ($bytes | ForEach-Object { $_.ToString("x2") })
}

Push-Location $RepoRoot
try {
  # --- Prerequisites -------------------------------------------------------
  Step "Checking docker compose is available" {
    docker compose version | Out-Null
  }

  $containerId = (docker compose ps -q postgres)
  if (-not $containerId) {
    throw "The 'postgres' service is not running. Start it with: docker compose up -d postgres"
  }

  Step "Waiting for postgres to be ready" {
    docker compose exec -T postgres pg_isready -U $PgUser -d $Db | Out-Null
  }

  New-Item -ItemType Directory -Force -Path $OutDir | Out-Null
  $stamp = Get-Date -Format "yyyyMMdd_HHmmss"
  $base = "makthab_${Db}_${stamp}"
  $tmpDir = "/tmp/makthab-backup"
  Exec-InContainer @("mkdir", "-p", $tmpDir)

  $manifest = [ordered]@{
    createdAtUtc = (Get-Date).ToUniversalTime().ToString("o")
    database     = $Db
    format       = $Format
    files        = @()
    tableCounts  = [ordered]@{}
  }

  # --- Row-count manifest (pre-dump, for post-restore verification) --------
  Step "Recording table row counts" {
    $sql = @"
select table_name, (xpath('/row/c/text()', query_to_xml(format('select count(*) as c from %I.%I', table_schema, table_name), false, true, '')))[1]::text::int as row_count
from information_schema.tables
where table_schema = 'public' and table_type = 'BASE TABLE'
order by table_name;
"@
    $out = docker compose exec -T postgres psql -U $PgUser -d $Db -t -A -F"," -c $sql
    if ($LASTEXITCODE -ne 0) { throw "Row-count query failed" }
    foreach ($line in ($out -split "`n" | Where-Object { $_.Trim() })) {
      $parts = $line -split ","
      if ($parts.Count -eq 2) {
        $manifest.tableCounts[$parts[0].Trim()] = [int]$parts[1].Trim()
      }
    }
  }

  # --- Custom format (.dump) ------------------------------------------------
  if ($Format -in @("Custom", "Both")) {
    $dumpName = "$base.dump"
    Step "pg_dump (custom format, compressed) -> $dumpName" {
      Exec-InContainer @("pg_dump", "-U", $PgUser, "-d", $Db, "-Fc", "-Z", "6",
        "--no-owner", "--no-privileges", "--encoding=UTF8",
        "-f", "$tmpDir/$dumpName")
    }
    Step "Verifying custom-format dump structure (pg_restore --list)" {
      $toc = docker compose exec -T postgres pg_restore --list "$tmpDir/$dumpName"
      if ($LASTEXITCODE -ne 0 -or -not $toc) { throw "pg_restore --list found the dump unreadable" }
      Write-Host "    TOC entries: $((($toc -split "`n") | Measure-Object).Count)"
    }
    Step "Copying $dumpName to host" {
      docker cp "${containerId}:$tmpDir/$dumpName" (Join-Path $OutDir $dumpName)
    }
    $manifest.files += $dumpName
  }

  # --- Plain SQL dump (.sql / .sql.gz) --------------------------------------
  if ($Format -in @("Plain", "Both")) {
    $sqlName = "$base.sql"
    Step "pg_dump (plain SQL) -> $sqlName" {
      Exec-InContainer @("pg_dump", "-U", $PgUser, "-d", $Db, "-Fp",
        "--no-owner", "--no-privileges", "--encoding=UTF8",
        "-f", "$tmpDir/$sqlName")
    }
    $hostSqlPath = Join-Path $OutDir $sqlName
    Step "Copying $sqlName to host" {
      docker cp "${containerId}:$tmpDir/$sqlName" $hostSqlPath
    }
    Step "Verifying plain SQL dump completeness" {
      $tail = Get-Content $hostSqlPath -Tail 5
      if (-not ($tail -match "PostgreSQL database dump complete")) {
        throw "$sqlName does not end with the expected pg_dump completion marker -- dump may be truncated"
      }
    }
    if ($Gzip) {
      $gzPath = "$hostSqlPath.gz"
      Step "Gzip-compressing $sqlName" {
        $inStream = [System.IO.File]::OpenRead($hostSqlPath)
        $outStream = [System.IO.File]::Create($gzPath)
        $gzStream = New-Object System.IO.Compression.GZipStream($outStream, [System.IO.Compression.CompressionLevel]::Optimal)
        $inStream.CopyTo($gzStream)
        $gzStream.Close(); $outStream.Close(); $inStream.Close()
      }
      Remove-Item $hostSqlPath
      $manifest.files += "$sqlName.gz"
    } else {
      $manifest.files += $sqlName
    }
  }

  # --- Globals (roles/grants) -- only needed for cross-cluster migration ----
  if ($IncludeGlobals) {
    $globalsName = "${base}_globals.sql"
    Step "pg_dumpall --globals-only -> $globalsName" {
      Exec-InContainer @("pg_dumpall", "-U", $PgUser, "--globals-only", "-f", "$tmpDir/$globalsName")
    }
    Step "Copying $globalsName to host" {
      docker cp "${containerId}:$tmpDir/$globalsName" (Join-Path $OutDir $globalsName)
    }
    $manifest.files += $globalsName
  }

  Step "Cleaning up container temp files" {
    Exec-InContainer @("rm", "-rf", $tmpDir)
  }

  # --- Manifest + checksums --------------------------------------------------
  $manifestPath = Join-Path $OutDir "$base.manifest.json"
  $checksums = [ordered]@{}
  foreach ($f in $manifest.files) {
    $p = Join-Path $OutDir $f
    $checksums[$f] = Get-Sha256Hex -Path $p
  }
  $manifest.sha256 = $checksums
  $manifest | ConvertTo-Json -Depth 5 | Set-Content -Path $manifestPath -Encoding UTF8

  Write-Host ""
  Write-Host "Backup complete." -ForegroundColor Green
  foreach ($f in $manifest.files) {
    $p = Join-Path $OutDir $f
    $sizeKb = [math]::Round((Get-Item $p).Length / 1KB, 1)
    Write-Host "  $f  (${sizeKb} KB)"
  }
  Write-Host "  $($base).manifest.json  (row counts + SHA256 for verification)"
  Write-Host ""
  Write-Host "Restore with: ./scripts/db/restore-postgres.ps1 -BackupFile '$(Join-Path $OutDir $manifest.files[0])'"
}
finally {
  Pop-Location
}
