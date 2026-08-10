#!/usr/bin/env python3
"""
Restore/migrate a Makthab PostgreSQL backup produced by backup_postgres.py
(or backup-postgres.ps1 -- the formats are identical).

Python/Ubuntu-WSL equivalent of scripts/db/restore-postgres.ps1.

Connects directly over TCP using native pg_restore/psql (from the
postgresql-client package: `sudo apt install postgresql-client`) -- see
backup_postgres.py's header for why this is not routed through
`docker compose exec`: if a native Postgres and a docker-compose Postgres
can each claim the same host port, only a direct TCP connection to
DATABASE_URL's host:port is guaranteed to reach the database the app
actually uses.

Auto-detects format from the file extension:
  .dump          -> pg_restore (custom format)
  .sql           -> psql (plain SQL)
  .sql.gz        -> decompressed to a host temp file, then psql

A full pg_dump-based backup already contains the Prisma migration-history
table (_prisma_migrations), so a successful restore leaves the database in
exactly the state `npx prisma migrate deploy` would have -- there is no
need to re-run migrations or `npm run migrate:xlsx` afterwards.

Examples:
  ./scripts/db/restore_postgres.py ./backups/makthab_makthab_dev_20260803_120000.dump --drop-existing

  # Dry-run a restore into a scratch DB to verify a backup before trusting it
  ./scripts/db/restore_postgres.py ./backups/....sql.gz --target-db makthab_dev_verify --drop-existing
"""

from __future__ import annotations

import argparse
import gzip as gzip_module
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
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


def resolve_pg_bin_dir(override: str | None) -> Path:
    if override:
        d = Path(override)
        if not (d / "pg_restore").is_file():
            raise RuntimeError(f"pg_restore not found under --pg-bin-dir '{override}'")
        return d

    on_path = shutil.which("pg_restore")
    if on_path:
        # NOTE: don't .resolve() this -- on Debian/Ubuntu, pg_restore etc. are
        # symlinks in /usr/bin to a generic /usr/share/postgresql-common/pg_wrapper
        # dispatcher that picks its behavior from argv[0]. Resolving the
        # symlink lands on pg_wrapper's own directory, where "pg_isready"
        # etc. don't exist as files. Use the symlink's directory instead --
        # the sibling pg_dump/pg_isready/psql symlinks live there too.
        return Path(os.path.abspath(on_path)).parent

    candidates = [p.parent for p in Path("/usr/lib/postgresql").glob("*/bin/pg_restore")]
    candidates += [p.parent for p in Path("/usr").glob("pgsql-*/bin/pg_restore")]
    if candidates:
        candidates.sort(key=lambda p: p.parent.name, reverse=True)
        return candidates[0]

    raise RuntimeError(
        "Could not find pg_restore on PATH or under /usr/lib/postgresql/*/bin. "
        "Pass --pg-bin-dir explicitly, or install the client tools: "
        "sudo apt install postgresql-client"
    )


def parse_database_url(path: Path) -> dict:
    if not path.is_file():
        raise RuntimeError(
            f"Env file not found: {path} (pass --env-file, or supply "
            "--pg-host/--pg-port/--pg-user/--pg-password directly)"
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
        description="Restore/migrate a Makthab PostgreSQL backup.",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog=__doc__,
    )
    parser.add_argument("backup_file", help="Path to the .dump, .sql, or .sql.gz file to restore.")
    parser.add_argument("--target-db", help="Defaults to the source DB in the manifest, or DATABASE_URL's DB.")
    parser.add_argument("--drop-existing", action="store_true", help="Drop and recreate target-db first.")
    parser.add_argument("--env-file", default=str(REPO_ROOT / "server" / ".env"))
    parser.add_argument("--pg-host")
    parser.add_argument("--pg-port")
    parser.add_argument("--pg-user")
    parser.add_argument("--pg-password")
    parser.add_argument("--pg-bin-dir")
    parser.add_argument("--jobs", type=int, default=4, help="Parallel restore jobs for pg_restore -j.")
    parser.add_argument("--force", action="store_true", help="Skip the interactive confirmation prompt.")
    args = parser.parse_args()

    try:
        backup_file = Path(args.backup_file)
        if not backup_file.is_file():
            raise RuntimeError(f"Backup file not found: {backup_file}")
        backup_file = backup_file.resolve()

        # --- Resolve manifest (row counts to verify against) -----------------
        manifest = None
        manifest_guess = backup_file.parent / (
            re.sub(r"\.(dump|sql\.gz|sql)$", "", backup_file.name) + ".manifest.json"
        )
        if manifest_guess.is_file():
            manifest = json.loads(manifest_guess.read_text())
            print(f"Found manifest: {manifest_guess}")

        is_gz = backup_file.name.endswith(".sql.gz")
        is_custom = backup_file.name.endswith(".dump")
        is_plain = backup_file.name.endswith(".sql") and not is_gz

        if not (is_gz or is_custom or is_plain):
            raise RuntimeError(f"Unrecognized backup extension for '{backup_file}' -- expected .dump, .sql, or .sql.gz")

        conn = parse_database_url(Path(args.env_file))
        pg_host = args.pg_host or conn["host"]
        pg_port = args.pg_port or conn["port"]
        pg_user = args.pg_user or conn["user"]
        pg_password = args.pg_password if args.pg_password is not None else conn["password"]
        target_db = args.target_db or (manifest["database"] if manifest else conn["db"])
        if not isinstance(target_db, str) or not target_db:
            raise RuntimeError("Target database name must be a non-empty string")
        target_db_sql = target_db.replace("'", "''")
        target_db_ident = target_db.replace('"', '""')

        bin_dir = resolve_pg_bin_dir(args.pg_bin_dir)
        pg_restore = str(bin_dir / "pg_restore")
        pg_isready = str(bin_dir / "pg_isready")
        psql = str(bin_dir / "psql")

        print(f"Target: {pg_user}@{pg_host}:{pg_port}/{target_db}  (tools: {bin_dir})")

        env = os.environ.copy()
        env["PGPASSWORD"] = pg_password

        step_start("Checking Postgres is reachable")
        result = subprocess.run([pg_isready, "-h", pg_host, "-p", pg_port, "-U", pg_user], env=env)
        if result.returncode != 0:
            raise RuntimeError(f"Checking Postgres is reachable failed with exit code {result.returncode}")

        # --- Confirmation ------------------------------------------------------
        verb = "DROP AND RECREATE" if args.drop_existing else "restore into (existing objects kept)"
        print("")
        cprint(f"About to {verb} database '{target_db}' on {pg_host}:{pg_port} from:", Color.YELLOW)
        print(f"  {backup_file}")
        if not args.force:
            answer = input(f"Type the database name ('{target_db}') to confirm: ")
            if answer != target_db:
                raise RuntimeError(f"Confirmation did not match '{target_db}' -- aborting.")

        source_path = backup_file
        temp_decompressed = None
        if is_gz:
            step_start(f"Decompressing {backup_file.name}")
            fd, tmp_name = tempfile.mkstemp(suffix=".sql")
            os.close(fd)
            temp_decompressed = Path(tmp_name)
            with gzip_module.open(backup_file, "rb") as f_in, temp_decompressed.open("wb") as f_out:
                shutil.copyfileobj(f_in, f_out)
            source_path = temp_decompressed

        # --- Drop/create target DB ----------------------------------------------
        if args.drop_existing:
            step_start(f"Dropping existing connections to '{target_db}' (if any)")
            terminate_sql = (
                "select pg_terminate_backend(pid) from pg_stat_activity "
                f"where datname = '{target_db_sql}' and pid <> pg_backend_pid();"
            )
            subprocess.run([psql, "-h", pg_host, "-p", pg_port, "-U", pg_user, "-d", "postgres", "-c", terminate_sql],
                            env=env, capture_output=True, text=True)

            step_start(f"Dropping database '{target_db}' if it exists")
            result = subprocess.run(
                [psql, "-h", pg_host, "-p", pg_port, "-U", pg_user, "-d", "postgres",
                 "-c", f'drop database if exists "{target_db_ident}";'],
                env=env,
            )
            if result.returncode != 0:
                raise RuntimeError(f"Dropping database '{target_db}' failed with exit code {result.returncode}")

            step_start(f"Creating database '{target_db}'")
            result = subprocess.run(
                [psql, "-h", pg_host, "-p", pg_port, "-U", pg_user, "-d", "postgres",
                 "-c", f'create database "{target_db_ident}" encoding \'UTF8\';'],
                env=env,
            )
            if result.returncode != 0:
                raise RuntimeError(f"Creating database '{target_db}' failed with exit code {result.returncode}")
        else:
            step_start(f"Ensuring database '{target_db}' exists")
            result = subprocess.run(
                [psql, "-h", pg_host, "-p", pg_port, "-U", pg_user, "-d", "postgres",
                 "-t", "-A", "-c", f"select 1 from pg_database where datname = '{target_db_sql}';"],
                env=env, capture_output=True, text=True,
            )
            if result.stdout.strip() != "1":
                result = subprocess.run(
                    [psql, "-h", pg_host, "-p", pg_port, "-U", pg_user, "-d", "postgres",
                     "-c", f'create database "{target_db_ident}" encoding \'UTF8\';'],
                    env=env,
                )
                if result.returncode != 0:
                    raise RuntimeError(f"Creating database '{target_db}' failed with exit code {result.returncode}")

        # --- Restore -------------------------------------------------------------
        if is_custom:
            step_start(f"pg_restore (custom format, {args.jobs} parallel jobs)")
            result = subprocess.run(
                [pg_restore, "-h", pg_host, "-p", pg_port, "-U", pg_user, "-d", target_db,
                 "--no-owner", "--no-privileges", "-j", str(args.jobs), "--exit-on-error", str(source_path)],
                env=env,
            )
            if result.returncode != 0:
                raise RuntimeError(f"pg_restore failed with exit code {result.returncode}")
        else:
            step_start("psql restore (plain SQL, ON_ERROR_STOP)")
            result = subprocess.run(
                [psql, "-h", pg_host, "-p", pg_port, "-U", pg_user, "-d", target_db,
                 "-v", "ON_ERROR_STOP=1", "-f", str(source_path)],
                env=env,
            )
            if result.returncode != 0:
                raise RuntimeError(f"psql restore failed with exit code {result.returncode}")

        if temp_decompressed and temp_decompressed.exists():
            temp_decompressed.unlink()

        # --- Post-restore verification --------------------------------------------
        print("")
        cprint("==> Verifying row counts", Color.CYAN)
        row_count_sql = (
            "select table_name, "
            "(xpath('/row/c/text()', query_to_xml(format('select count(*) as c from %I.%I', "
            "table_schema, table_name), false, true, '')))[1]::text::int as row_count "
            "from information_schema.tables "
            "where table_schema = 'public' and table_type = 'BASE TABLE' "
            "order by table_name;"
        )
        result = subprocess.run(
            [psql, "-h", pg_host, "-p", pg_port, "-U", pg_user, "-d", target_db,
             "-t", "-A", "-F,", "-c", row_count_sql],
            env=env, capture_output=True, text=True,
        )
        mismatch = False
        table_counts = manifest.get("tableCounts", {}) if manifest else {}
        for line in result.stdout.splitlines():
            if not line.strip():
                continue
            parts = line.split(",")
            if len(parts) != 2:
                continue
            table, count = parts[0].strip(), int(parts[1].strip())
            if table in table_counts:
                expected = int(table_counts[table])
                if expected != count:
                    cprint(f"  MISMATCH  {table} : expected {expected}, got {count}", Color.RED)
                    mismatch = True
                else:
                    print(f"  OK        {table} : {count}")
            else:
                print(f"  (no baseline) {table} : {count}")

        if mismatch:
            raise RuntimeError("Row count verification failed -- restored data does not match the backup manifest.")

        print("")
        cprint("Restore complete and verified.", Color.GREEN)
        if manifest:
            print(f"Database '{target_db}' now matches the backup taken at {manifest['createdAtUtc']}.")
        print("No need to run 'npm run db:deploy:pg' or 'npm run migrate:xlsx' -- the dump already includes schema + _prisma_migrations history.")
        return 0

    except RuntimeError as exc:
        print("")
        cprint(f"ERROR: {exc}", Color.RED)
        return 1


if __name__ == "__main__":
    sys.exit(main())
