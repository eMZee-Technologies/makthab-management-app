<#
.SYNOPSIS
  Bring up the Makthab app locally: install, build shared, migrate the
  database, and start the dev servers. Invoke via ./run.bat from the repo
  root (or call this file directly with PowerShell).

.DESCRIPTION
  Runs, in order:
    1. npm install                          (unless -SkipInstall)
    2. npm run build:shared                  (unless -SkipBuild)
    3. Detect DATABASE_PROVIDER/DATABASE_URL from server/.env
       - postgresql: verify the DB is reachable over TCP before migrating.
         If not reachable and -Docker was passed, starts the docker-compose
         "postgres" service (see docker-compose.yml -- it publishes 5434,
         specifically to avoid colliding with a natively-installed Postgres
         on 5432/5433, a real gotcha on this machine). If not reachable and
         -Docker was not passed, fails with next steps instead of hanging.
       - sqlite: no DB server needed.
    4. Apply migrations: npm run db:deploy -w server (safe, non-destructive,
       provider-aware) by default, or a full wipe+reseed with -Reset (asks
       for confirmation unless -Force).
    5. Optional legacy Excel import with -ImportXlsx (idempotent, off by
       default -- the app no longer depends on the xlsx source, see
       docs/migration/MIGRATION.md).
    6. Start dev servers in the foreground: `npm run dev` (server + client
       together via concurrently), or just one side with -ServerOnly /
       -ClientOnly. Opens the client in your default browser once the API
       health check responds, unless -NoBrowser.

.PARAMETER SkipInstall
  Skip `npm install`. Use for fast restarts once dependencies are current.

.PARAMETER SkipBuild
  Skip `npm run build:shared`. Only safe if @makthab/shared hasn't changed
  since the last build -- the server imports its compiled output, not the
  TS source (unlike the client, which resolves it via a Vite alias).

.PARAMETER Reset
  Wipe and reseed the database (`prisma migrate reset --force` + seed)
  instead of the default non-destructive `db:deploy`. Destructive -- asks
  for confirmation unless -Force is also passed.

.PARAMETER Force
  Skip the confirmation prompt for -Reset. Use in scripted/CI contexts only.

.PARAMETER ImportXlsx
  Also run the legacy `migrate:xlsx` import after migrating. Idempotent,
  but off by default since the database is now the source of truth.

.PARAMETER Docker
  If the configured Postgres isn't reachable, start it via
  `docker compose up -d postgres` instead of failing. No effect for sqlite.

.PARAMETER ServerOnly / ClientOnly
  Start only the API or only the client dev server, instead of both.

.PARAMETER NoBrowser
  Don't auto-open the client in a browser once it's up.

.EXAMPLE
  ./run.bat
  First-time or routine start: install, build, migrate, run both servers.

.EXAMPLE
  ./run.bat -SkipInstall -SkipBuild
  Fast restart once dependencies/shared are already current.

.EXAMPLE
  ./run.bat -Docker
  Use the bundled docker-compose Postgres if the configured one isn't reachable.

.EXAMPLE
  ./run.bat -Reset -Force
  Wipe and reseed the database, then start both servers, no prompts.
#>

param(
  [switch]$SkipInstall,
  [switch]$SkipBuild,
  [switch]$Reset,
  [switch]$Force,
  [switch]$ImportXlsx,
  [switch]$Docker,
  [switch]$ServerOnly,
  [switch]$ClientOnly,
  [switch]$NoBrowser,
  [Alias("h", "?")]
  [switch]$Help
)

if ($Help) {
  Get-Help $PSCommandPath -Detailed
  exit 0
}

$ErrorActionPreference = "Stop"
$RepoRoot = Resolve-Path (Join-Path $PSScriptRoot "..")

function Step {
  param([string]$Description, [scriptblock]$Action)
  Write-Host ""
  Write-Host "==> $Description" -ForegroundColor Cyan
  & $Action
  if ($LASTEXITCODE -ne 0) {
    throw "$Description failed with exit code $LASTEXITCODE"
  }
}

function Parse-DatabaseUrl {
  param([string]$Path)
  if (-not (Test-Path $Path)) { return $null }
  $providerLine = (Get-Content $Path) | Where-Object { $_ -match '^\s*DATABASE_PROVIDER\s*=' } | Select-Object -Last 1
  $urlLine = (Get-Content $Path) | Where-Object { $_ -match '^\s*DATABASE_URL\s*=' } | Select-Object -Last 1
  $provider = if ($providerLine) { (($providerLine -split '=', 2)[1]).Trim().Trim('"') } else { "sqlite" }
  $result = [ordered]@{ Provider = $provider; Host = $null; Port = $null; Db = $null }
  if ($urlLine) {
    $value = ($urlLine -split '=', 2)[1].Trim().Trim('"')
    if ($value -match '^postgres(ql)?://(?<user>[^:@/]+)(:(?<pass>[^@]*))?@(?<host>[^:/]+):(?<port>\d+)/(?<db>[^?]+)') {
      $result.Host = $Matches.host
      $result.Port = $Matches.port
      $result.Db = $Matches.db
    }
  }
  return $result
}

function Test-TcpPort {
  param([string]$HostName, [int]$Port, [int]$TimeoutMs = 1500)
  try {
    $client = New-Object System.Net.Sockets.TcpClient
    $iar = $client.BeginConnect($HostName, $Port, $null, $null)
    $ok = $iar.AsyncWaitHandle.WaitOne($TimeoutMs)
    if ($ok -and $client.Connected) {
      $client.EndConnect($iar)
      $client.Close()
      return $true
    }
    $client.Close()
    return $false
  } catch {
    return $false
  }
}

Push-Location $RepoRoot
try {
  Write-Host "Makthab -- local run" -ForegroundColor Magenta
  Write-Host "Repo: $RepoRoot"

  # --- Prerequisites -------------------------------------------------------
  Step "Checking Node.js / npm" {
    $nodeVersion = node --version
    Write-Host "    node $nodeVersion"
    $major = [int]($nodeVersion.TrimStart('v') -split '\.')[0]
    if ($major -lt 20) {
      throw "Node 20+ required (found $nodeVersion). See package.json 'engines'."
    }
    npm --version | Out-Null
  }

  # --- Install / build -------------------------------------------------------
  if (-not $SkipInstall) {
    Step "npm install" { npm install }
  } else {
    Write-Host "==> Skipping npm install (-SkipInstall)" -ForegroundColor DarkGray
  }

  if (-not $SkipBuild) {
    Step "npm run build:shared" { npm run build:shared }
  } else {
    Write-Host "==> Skipping build:shared (-SkipBuild)" -ForegroundColor DarkGray
  }

  # --- Database --------------------------------------------------------------
  $envPath = Join-Path $RepoRoot "server\.env"
  $conn = Parse-DatabaseUrl -Path $envPath
  if (-not $conn) {
    throw "server/.env not found. Copy server/.env.example to server/.env and set DATABASE_PROVIDER/DATABASE_URL first."
  }
  Write-Host ""
  Write-Host "Database provider: $($conn.Provider)" -ForegroundColor Yellow

  if ($conn.Provider -eq "postgresql") {
    if (-not $conn.Host) {
      throw "DATABASE_PROVIDER=postgresql but DATABASE_URL in $envPath isn't a postgres:// connection string."
    }
    Write-Host "Target: $($conn.Host):$($conn.Port)/$($conn.Db)"

    Step "Checking Postgres is reachable ($($conn.Host):$($conn.Port))" {
      $reachable = Test-TcpPort -HostName $conn.Host -Port $conn.Port
      if (-not $reachable -and $Docker) {
        Write-Host "    Not reachable -- starting docker-compose postgres (-Docker)" -ForegroundColor Yellow
        docker compose up -d postgres
        if ($LASTEXITCODE -ne 0) { throw "docker compose up -d postgres failed" }
        $waited = 0
        while (-not (Test-TcpPort -HostName $conn.Host -Port $conn.Port) -and $waited -lt 30) {
          Start-Sleep -Seconds 2
          $waited += 2
        }
        $reachable = Test-TcpPort -HostName $conn.Host -Port $conn.Port
        if ($reachable -and $conn.Port -ne "5434") {
          Write-Host "    WARNING: docker-compose publishes postgres on host port 5434, but DATABASE_URL uses $($conn.Port)." -ForegroundColor Yellow
          Write-Host "    If this connected anyway, something else is answering on $($conn.Port) -- see docker-compose.yml's port comment." -ForegroundColor Yellow
        }
      }
      if (-not $reachable) {
        throw @"
Postgres at $($conn.Host):$($conn.Port) is not reachable.
  - If you use a natively-installed Postgres, check it's running:
      Get-Service | Where-Object Name -like '*postgres*'
  - Or start the bundled docker-compose instance instead:
      ./run.bat -Docker
  - Or switch to SQLite for zero-setup dev: set DATABASE_PROVIDER=sqlite
    in server/.env (see server/.env.example).
"@
      }
      $global:LASTEXITCODE = 0
    }
  }

  # --- Migrate -----------------------------------------------------------
  if ($Reset) {
    Write-Host ""
    Write-Host "About to WIPE AND RESEED the '$($conn.Provider)' database." -ForegroundColor Red
    if (-not $Force) {
      $answer = Read-Host "Type 'reset' to confirm"
      if ($answer -ne "reset") { throw "Confirmation did not match 'reset' -- aborting." }
    }
    $resetScript = if ($conn.Provider -eq "postgresql") { "db:reset:pg" } else { "db:reset" }
    Step "npm run $resetScript -w server" { npm run $resetScript -w server }
  } else {
    Step "npm run db:deploy -w server" { npm run db:deploy -w server }
  }

  if ($ImportXlsx) {
    $xlsxScript = if ($conn.Provider -eq "postgresql") { "migrate:xlsx:pg" } else { "migrate:xlsx" }
    Step "npm run $xlsxScript -w server" { npm run $xlsxScript -w server }
  }

  # --- Start dev servers -------------------------------------------------
  $openBrowser = -not $NoBrowser -and -not $ServerOnly
  if ($openBrowser) {
    Start-Job -ScriptBlock {
      $healthy = $false
      for ($i = 0; $i -lt 60; $i++) {
        try {
          $resp = Invoke-WebRequest -Uri "http://localhost:3000/health" -UseBasicParsing -TimeoutSec 2
          if ($resp.StatusCode -eq 200) { $healthy = $true; break }
        } catch {}
        Start-Sleep -Seconds 1
      }
      if ($healthy) { Start-Process "http://localhost:5173" }
    } | Out-Null
  }

  Write-Host ""
  Write-Host "Client: http://localhost:5173" -ForegroundColor Green
  Write-Host "API:    http://localhost:3000  (health: /health)" -ForegroundColor Green
  Write-Host "Ctrl+C to stop." -ForegroundColor DarkGray
  Write-Host ""

  if ($ServerOnly) {
    npm run dev:server
  } elseif ($ClientOnly) {
    npm run dev:client
  } else {
    npm run dev
  }
}
finally {
  Pop-Location
}
