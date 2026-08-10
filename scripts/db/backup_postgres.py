#!/usr/bin/env python3
"""
Full backup (schema + data) of the Makthab PostgreSQL database.

Python/Ubuntu-WSL equivalent of scripts/db/backup-postgres.ps1.

Connects directly over TCP to whatever host:port server/.env's DATABASE_URL
points at, using native pg_dump/pg_restore/pg_dumpall/psql (from the
postgresql-client package: `sudo apt install postgresql-client`). This is
deliberately NOT routed through `docker compose exec` -- if a native
Postgres and a docker-compose Postgres both claim the same host port,
whichever process actually owns that port at the OS level is the one the
app, Prisma, and any DB GUI client are really talking to; a
`docker compose exec` backup would silently dump the *container's*
database instead, which can be a stale, disconnected copy. Connecting over
TCP to DATABASE_URL's host:port guarantees we back up the database the app
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

Examples:
  ./scripts/db/backup_postgres.py
      Reads server/.env, backs up whatever DATABASE_URL points at, both formats.

  ./scripts/db/backup_postgres.py --format plain --gzip --include-globals
      Portable-only backup, gzipped, plus a globals dump -- good before a
      cross-server migration.
"""

from __future__ import annotations

import argparse
import gzip as gzip_module
import hashlib
import json
import os
import re
import shutil
import subprocess
import sys
from datetime import datetime, timezone
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent.parent


class Color:
    CYAN = "\033[36m"
    YELLOW = "\033[33m"
    GREEN = "\033[32m"
    RED = "\033[31m"
    RESET = "\033[0m"


def cprint(text: str, color: str = "") -> None:
    if color and sys.stdout.isatty():
        print(f"{color}{text}{Color.RESET}")
    else:
        print(text)


def step_start(description: str) -> None:
    cprint(f"==> {description}", Color.CYAN)


def run(args: list[str], env: dict | None = None, **kwargs) -> subprocess.CompletedProcess:
    return subprocess.run(args, env=env, **kwargs)


def sha256_hex(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as f:
        for chunk in iter(lambda: f.read(1024 * 1024), b""):
            h.update(chunk)
    return h.hexdigest()


def resolve_pg_bin_dir(override: str | None) -> Path:
    if override:
        d = Path(override)
        if not (d / "pg_dump").is_file():
            raise RuntimeError(f"pg_dump not found under --pg-bin-dir '{override}'")
        return d

    on_path = shutil.which("pg_dump")
    if on_path:
        # NOTE: don't .resolve() this -- on Debian/Ubuntu, pg_dump etc. are
        # symlinks in /usr/bin to a generic /usr/share/postgresql-common/pg_wrapper
        # dispatcher that picks its behavior from argv[0]. Resolving the
        # symlink lands on pg_wrapper's own directory, where "pg_isready"
        # etc. don't exist as files. Use the symlink's directory instead --
        # the sibling pg_restore/pg_isready/psql symlinks live there too.
        return Path(os.path.abspath(on_path)).parent

    # Debian/Ubuntu: /usr/lib/postgresql/<version>/bin ; RHEL: /usr/pgsql-<version>/bin
    candidates = [p.parent for p in Path("/usr/lib/postgresql").glob("*/bin/pg_dump")]
    candidates += [p.parent for p in Path("/usr").glob("pgsql-*/bin/pg_dump")]
    if candidates:
        candidates.sort(key=lambda p: p.parent.name, reverse=True)
        return candidates[0]

    raise RuntimeError(
        "Could not find pg_dump on PATH or under /usr/lib/postgresql/*/bin. "
        "Pass --pg-bin-dir explicitly, or install the client tools: "
        "sudo apt install postgresql-client"
    )


def parse_database_url(path: Path) -> dict:
    if not path.is_file():
        raise RuntimeError(
            f"Env file not found: {path} (pass --env-file, or supply "
            "--pg-host/--pg-port/--pg-user/--pg-password/--db directly)"
        )
    text = path.read_text()
    lines = re.findall(r"^\s*DATABASE_URL\s*=\s*(.*)$", text, re.MULTILINE)
    if not lines:
        raise RuntimeError(f"No DATABASE_URL found in {path}")
    value = lines[-1].strip().strip('"')
    m = re.match(
        r"^postgres(?:ql)?://(?P<user>[^:@/]+)(?::(?P<pass>[^@]*))?@(?P<host>[^:/]+):(?P<port>\d+)/(?P<db>[^?]+)",
        value,
    )
    if not m:
        raise RuntimeError(f"DATABASE_URL in {path} is not a postgres:// connection string: {value}")
    return {
        "host": m.group("host"),
        "port": m.group("port"),
        "user": m.group("user"),
        "password": m.group("pass") or "",
        "db": m.group("db"),
    }


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Full backup (schema + data) of the Makthab PostgreSQL database.",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog=__doc__,
    )
    parser.add_argument("--out-dir", default=str(REPO_ROOT / "backups"), help="Host directory to write backups to.")
    parser.add_argument("--format", choices=["custom", "plain", "both"], default="both")
    parser.add_argument("--env-file", default=str(REPO_ROOT / "server" / ".env"))
    parser.add_argument("--pg-host")
    parser.add_argument("--pg-port")
    parser.add_argument("--pg-user")
    parser.add_argument("--pg-password")
    parser.add_argument("--db")
    parser.add_argument("--pg-bin-dir")
    parser.add_argument("--include-globals", action="store_true")
    parser.add_argument("--gzip", action="store_true")
    args = parser.parse_args()

    try:
        conn = parse_database_url(Path(args.env_file))
        pg_host = args.pg_host or conn["host"]
        pg_port = args.pg_port or conn["port"]
        pg_user = args.pg_user or conn["user"]
        pg_password = args.pg_password if args.pg_password is not None else conn["password"]
        db = args.db or conn["db"]

        bin_dir = resolve_pg_bin_dir(args.pg_bin_dir)
        pg_dump = str(bin_dir / "pg_dump")
        pg_restore = str(bin_dir / "pg_restore")
        pg_dumpall = str(bin_dir / "pg_dumpall")
        pg_isready = str(bin_dir / "pg_isready")
        psql = str(bin_dir / "psql")

        print(f"Target: {pg_user}@{pg_host}:{pg_port}/{db}  (tools: {bin_dir})")

        env = os.environ.copy()
        env["PGPASSWORD"] = pg_password

        step_start("Checking Postgres is reachable")
        result = run([pg_isready, "-h", pg_host, "-p", pg_port, "-U", pg_user, "-d", db], env=env)
        if result.returncode != 0:
            raise RuntimeError(f"Checking Postgres is reachable failed with exit code {result.returncode}")

        out_dir = Path(args.out_dir)
        out_dir.mkdir(parents=True, exist_ok=True)
        stamp = datetime.now().strftime("%Y%m%d_%H%M%S")
        base = f"makthab_{db}_{stamp}"

        manifest = {
            "createdAtUtc": datetime.now(timezone.utc).isoformat(),
            "database": db,
            "host": f"{pg_host}:{pg_port}",
            "format": args.format,
            "files": [],
            "tableCounts": {},
        }

        # --- Row-count manifest (pre-dump, for post-restore verification) ---
        step_start("Recording table row counts")
        row_count_sql = (
            "select table_name, "
            "(xpath('/row/c/text()', query_to_xml(format('select count(*) as c from %I.%I', "
            "table_schema, table_name), false, true, '')))[1]::text::int as row_count "
            "from information_schema.tables "
            "where table_schema = 'public' and table_type = 'BASE TABLE' "
            "order by table_name;"
        )
        result = run(
            [psql, "-h", pg_host, "-p", pg_port, "-U", pg_user, "-d", db, "-t", "-A", "-F,", "-c", row_count_sql],
            env=env,
            capture_output=True,
            text=True,
        )
        if result.returncode != 0:
            raise RuntimeError(f"Row-count query failed: {result.stderr}")
        for line in result.stdout.splitlines():
            if not line.strip():
                continue
            parts = line.split(",")
            if len(parts) == 2:
                manifest["tableCounts"][parts[0].strip()] = int(parts[1].strip())

        # --- Custom format (.dump) -------------------------------------------
        if args.format in ("custom", "both"):
            dump_name = f"{base}.dump"
            dump_path = out_dir / dump_name
            step_start(f"pg_dump (custom format, compressed) -> {dump_name}")
            result = run(
                [
                    pg_dump, "-h", pg_host, "-p", pg_port, "-U", pg_user, "-d", db,
                    "-Fc", "-Z", "6", "--no-owner", "--no-privileges", "--encoding=UTF8",
                    "-f", str(dump_path),
                ],
                env=env,
            )
            if result.returncode != 0:
                raise RuntimeError(f"pg_dump (custom) failed with exit code {result.returncode}")

            step_start("Verifying custom-format dump structure (pg_restore --list)")
            result = run([pg_restore, "--list", str(dump_path)], env=env, capture_output=True, text=True)
            if result.returncode != 0 or not result.stdout.strip():
                raise RuntimeError("pg_restore --list found the dump unreadable")
            print(f"    TOC entries: {len(result.stdout.splitlines())}")
            manifest["files"].append(dump_name)

        # --- Plain SQL dump (.sql / .sql.gz) ---------------------------------
        if args.format in ("plain", "both"):
            sql_name = f"{base}.sql"
            sql_path = out_dir / sql_name
            step_start(f"pg_dump (plain SQL) -> {sql_name}")
            result = run(
                [
                    pg_dump, "-h", pg_host, "-p", pg_port, "-U", pg_user, "-d", db,
                    "-Fp", "--no-owner", "--no-privileges", "--encoding=UTF8",
                    "-f", str(sql_path),
                ],
                env=env,
            )
            if result.returncode != 0:
                raise RuntimeError(f"pg_dump (plain) failed with exit code {result.returncode}")

            step_start("Verifying plain SQL dump completeness")
            tail_lines = sql_path.read_text(errors="replace").splitlines()[-5:]
            if not any("PostgreSQL database dump complete" in l for l in tail_lines):
                raise RuntimeError(
                    f"{sql_name} does not end with the expected pg_dump completion marker -- dump may be truncated"
                )

            if args.gzip:
                gz_path = Path(str(sql_path) + ".gz")
                step_start(f"Gzip-compressing {sql_name}")
                with sql_path.open("rb") as f_in, gzip_module.open(gz_path, "wb", compresslevel=9) as f_out:
                    shutil.copyfileobj(f_in, f_out)
                sql_path.unlink()
                manifest["files"].append(f"{sql_name}.gz")
            else:
                manifest["files"].append(sql_name)

        # --- Globals (roles/grants) -- only needed for cross-cluster migration
        if args.include_globals:
            globals_name = f"{base}_globals.sql"
            globals_path = out_dir / globals_name
            step_start(f"pg_dumpall --globals-only -> {globals_name}")
            result = run(
                [pg_dumpall, "-h", pg_host, "-p", pg_port, "-U", pg_user, "--globals-only", "-f", str(globals_path)],
                env=env,
            )
            if result.returncode != 0:
                raise RuntimeError(f"pg_dumpall failed with exit code {result.returncode}")
            manifest["files"].append(globals_name)

        # --- Manifest + checksums --------------------------------------------
        manifest_path = out_dir / f"{base}.manifest.json"
        checksums = {}
        for f in manifest["files"]:
            checksums[f] = sha256_hex(out_dir / f)
        manifest["sha256"] = checksums
        manifest_path.write_text(json.dumps(manifest, indent=2))

        print("")
        cprint("Backup complete.", Color.GREEN)
        for f in manifest["files"]:
            size_kb = round((out_dir / f).stat().st_size / 1024, 1)
            print(f"  {f}  ({size_kb} KB)")
        print(f"  {base}.manifest.json  (row counts + SHA256 for verification)")
        print("")
        print(f"Restore with: ./scripts/db/restore_postgres.py {out_dir / manifest['files'][0]}")
        return 0

    except RuntimeError as exc:
        print("")
        cprint(f"ERROR: {exc}", Color.RED)
        return 1


if __name__ == "__main__":
    sys.exit(main())
