#!/usr/bin/env python3
"""
Bring up the Makthab app locally on Ubuntu/WSL: install, build shared,
migrate the database, and start the dev servers.

Python equivalent of scripts/run.ps1 (used by run.bat on Windows). Invoke
via ./run.py from the repo root (or `python3 scripts/run.py`).

Runs, in order:
  1. npm install                          (unless --skip-install)
  2. npm run build:shared                  (unless --skip-build)
  3. Detect DATABASE_PROVIDER/DATABASE_URL from server/.env
     - postgresql: verify the DB is reachable over TCP before migrating.
       If not reachable and --docker was passed, starts the docker-compose
       "postgres" service (see docker-compose.yml -- it publishes 5434,
       specifically to avoid colliding with a natively-installed Postgres
       on 5432/5433). If not reachable and --docker was not passed, fails
       with next steps instead of hanging.
     - sqlite: no DB server needed.
  4. Apply migrations: npm run db:deploy -w server (safe, non-destructive,
     provider-aware) by default, or a full wipe+reseed with --reset (asks
     for confirmation unless --force).
  5. Optional legacy Excel import with --import-xlsx (idempotent, off by
     default -- the app no longer depends on the xlsx source, see
     docs/migration/MIGRATION.md).
  6. Start dev servers in the foreground: `npm run dev` (server + client
     together via concurrently), or just one side with --server-only /
     --client-only. Opens the client in your default browser once the API
     health check responds, unless --no-browser.

Examples:
  ./run.py
      First-time or routine start: install, build, migrate, run both servers.

  ./run.py --skip-install --skip-build
      Fast restart once dependencies/shared are already current.

  ./run.py --docker
      Use the bundled docker-compose Postgres if the configured one isn't reachable.

  ./run.py --reset --force
      Wipe and reseed the database, then start both servers, no prompts.
"""

from __future__ import annotations

import argparse
import re
import socket
import subprocess
import sys
import threading
import time
import urllib.error
import urllib.request
import webbrowser
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent


class Color:
    CYAN = "\033[36m"
    MAGENTA = "\033[35m"
    YELLOW = "\033[33m"
    GREEN = "\033[32m"
    RED = "\033[31m"
    GRAY = "\033[90m"
    RESET = "\033[0m"


def cprint(text: str, color: str = "") -> None:
    if color and sys.stdout.isatty():
        print(f"{color}{text}{Color.RESET}")
    else:
        print(text)


def step(description: str, args: list[str], cwd: Path = REPO_ROOT, env: dict | None = None) -> None:
    cprint("", "")
    cprint(f"==> {description}", Color.CYAN)
    result = subprocess.run(args, cwd=cwd, env=env)
    if result.returncode != 0:
        raise RuntimeError(f"{description} failed with exit code {result.returncode}")


def parse_database_url(path: Path) -> dict | None:
    if not path.is_file():
        return None
    text = path.read_text()
    provider_match = re.findall(r"^\s*DATABASE_PROVIDER\s*=\s*(.*)$", text, re.MULTILINE)
    url_match = re.findall(r"^\s*DATABASE_URL\s*=\s*(.*)$", text, re.MULTILINE)
    provider = provider_match[-1].strip().strip('"') if provider_match else "sqlite"
    result = {"provider": provider, "host": None, "port": None, "db": None}
    if url_match:
        value = url_match[-1].strip().strip('"')
        m = re.match(
            r"^postgres(?:ql)?://[^:@/]+(?::[^@]*)?@(?P<host>[^:/]+):(?P<port>\d+)/(?P<db>[^?]+)",
            value,
        )
        if m:
            result["host"] = m.group("host")
            result["port"] = int(m.group("port"))
            result["db"] = m.group("db")
    return result


def test_tcp_port(host: str, port: int, timeout: float = 1.5) -> bool:
    try:
        with socket.create_connection((host, port), timeout=timeout):
            return True
    except OSError:
        return False


def wait_for_health_then_open_browser() -> None:
    healthy = False
    for _ in range(60):
        try:
            with urllib.request.urlopen("http://localhost:3000/health", timeout=2) as resp:
                if resp.status == 200:
                    healthy = True
                    break
        except (urllib.error.URLError, OSError):
            pass
        time.sleep(1)
    if healthy:
        webbrowser.open("http://localhost:5173")


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Bring up the Makthab app locally on Ubuntu/WSL.",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog=__doc__,
    )
    parser.add_argument("--skip-install", action="store_true", help="Skip `npm install`.")
    parser.add_argument(
        "--skip-build",
        action="store_true",
        help="Skip `npm run build:shared`. Only safe if @makthab/shared hasn't changed.",
    )
    parser.add_argument(
        "--reset",
        action="store_true",
        help="Wipe and reseed the database instead of the default non-destructive db:deploy.",
    )
    parser.add_argument("--force", action="store_true", help="Skip the confirmation prompt for --reset.")
    parser.add_argument(
        "--import-xlsx",
        action="store_true",
        help="Also run the legacy `migrate:xlsx` import after migrating.",
    )
    parser.add_argument(
        "--docker",
        action="store_true",
        help="Start docker-compose postgres if the configured DB isn't reachable.",
    )
    parser.add_argument("--server-only", action="store_true", help="Start only the API dev server.")
    parser.add_argument("--client-only", action="store_true", help="Start only the client dev server.")
    parser.add_argument(
        "--no-browser", action="store_true", help="Don't auto-open the client in a browser once it's up."
    )
    args = parser.parse_args()

    try:
        cprint("Makthab -- local run (Ubuntu/WSL)", Color.MAGENTA)
        cprint(f"Repo: {REPO_ROOT}")

        # --- Prerequisites ---------------------------------------------------
        cprint("", "")
        cprint("==> Checking Node.js / npm", Color.CYAN)
        node_version = subprocess.run(
            ["node", "--version"], cwd=REPO_ROOT, capture_output=True, text=True, check=True
        ).stdout.strip()
        print(f"    node {node_version}")
        major = int(node_version.lstrip("v").split(".")[0])
        if major < 20:
            raise RuntimeError(f"Node 20+ required (found {node_version}). See package.json 'engines'.")
        subprocess.run(["npm", "--version"], cwd=REPO_ROOT, capture_output=True, text=True, check=True)

        # --- Install / build ---------------------------------------------------
        if not args.skip_install:
            step("npm install", ["npm", "install"])
        else:
            cprint("==> Skipping npm install (--skip-install)", Color.GRAY)

        if not args.skip_build:
            step("npm run build:shared", ["npm", "run", "build:shared"])
        else:
            cprint("==> Skipping build:shared (--skip-build)", Color.GRAY)

        # --- Database ------------------------------------------------------------
        env_path = REPO_ROOT / "server" / ".env"
        conn = parse_database_url(env_path)
        if conn is None:
            raise RuntimeError(
                "server/.env not found. Copy server/.env.example to server/.env "
                "and set DATABASE_PROVIDER/DATABASE_URL first."
            )
        cprint("", "")
        cprint(f"Database provider: {conn['provider']}", Color.YELLOW)

        if conn["provider"] == "postgresql":
            if not conn["host"]:
                raise RuntimeError(
                    f"DATABASE_PROVIDER=postgresql but DATABASE_URL in {env_path} isn't a postgres:// connection string."
                )
            print(f"Target: {conn['host']}:{conn['port']}/{conn['db']}")

            cprint("", "")
            cprint(f"==> Checking Postgres is reachable ({conn['host']}:{conn['port']})", Color.CYAN)
            reachable = test_tcp_port(conn["host"], conn["port"])
            if not reachable and args.docker:
                cprint("    Not reachable -- starting docker-compose postgres (--docker)", Color.YELLOW)
                result = subprocess.run(["docker", "compose", "up", "-d", "postgres"], cwd=REPO_ROOT)
                if result.returncode != 0:
                    raise RuntimeError("docker compose up -d postgres failed")
                waited = 0
                while not test_tcp_port(conn["host"], conn["port"]) and waited < 30:
                    time.sleep(2)
                    waited += 2
                reachable = test_tcp_port(conn["host"], conn["port"])
                if reachable and conn["port"] != 5434:
                    cprint(
                        f"    WARNING: docker-compose publishes postgres on host port 5434, "
                        f"but DATABASE_URL uses {conn['port']}.",
                        Color.YELLOW,
                    )
                    cprint(
                        "    If this connected anyway, something else is answering on "
                        f"{conn['port']} -- see docker-compose.yml's port comment.",
                        Color.YELLOW,
                    )
            if not reachable:
                raise RuntimeError(
                    f"Postgres at {conn['host']}:{conn['port']} is not reachable.\n"
                    "  - If you use a natively-installed Postgres, check it's running:\n"
                    "      systemctl status postgresql   (or) pg_isready\n"
                    "  - Or start the bundled docker-compose instance instead:\n"
                    "      ./run.py --docker\n"
                    "  - Or switch to SQLite for zero-setup dev: set DATABASE_PROVIDER=sqlite\n"
                    "    in server/.env (see server/.env.example)."
                )

        # --- Migrate -------------------------------------------------------------
        if args.reset:
            cprint("", "")
            cprint(f"About to WIPE AND RESEED the '{conn['provider']}' database.", Color.RED)
            if not args.force:
                answer = input("Type 'reset' to confirm: ")
                if answer != "reset":
                    raise RuntimeError("Confirmation did not match 'reset' -- aborting.")
            reset_script = "db:reset:pg" if conn["provider"] == "postgresql" else "db:reset"
            step(f"npm run {reset_script} -w server", ["npm", "run", reset_script, "-w", "server"])
        else:
            step("npm run db:deploy -w server", ["npm", "run", "db:deploy", "-w", "server"])

        if args.import_xlsx:
            xlsx_script = "migrate:xlsx:pg" if conn["provider"] == "postgresql" else "migrate:xlsx"
            step(f"npm run {xlsx_script} -w server", ["npm", "run", xlsx_script, "-w", "server"])

        # --- Start dev servers ---------------------------------------------------
        open_browser = not args.no_browser and not args.server_only
        if open_browser:
            threading.Thread(target=wait_for_health_then_open_browser, daemon=True).start()

        cprint("", "")
        cprint("Client: http://localhost:5173", Color.GREEN)
        cprint("API:    http://localhost:3000  (health: /health)", Color.GREEN)
        cprint("Ctrl+C to stop.", Color.GRAY)
        cprint("", "")

        if args.server_only:
            dev_args = ["npm", "run", "dev:server"]
        elif args.client_only:
            dev_args = ["npm", "run", "dev:client"]
        else:
            dev_args = ["npm", "run", "dev"]

        result = subprocess.run(dev_args, cwd=REPO_ROOT)
        return result.returncode

    except KeyboardInterrupt:
        cprint("", "")
        cprint("Stopped.", Color.GRAY)
        return 0
    except RuntimeError as exc:
        cprint("", "")
        cprint(f"ERROR: {exc}", Color.RED)
        return 1


if __name__ == "__main__":
    sys.exit(main())
