"""Reviewed, opt-in transport for EXISTING staging only; never deploys/migrates.

Root copies this file to /root/pero-work-shares-<sha256>.py after review. Packets
arrive on stdin from work-shares-stage-runner.mjs, never as shell/SSH arguments.
stdout is a PRIVATE JSON pipe: QA sessions/envelopes must not be logged. All
exceptions are reduced to constant codes. Only the caller prints publicSummary.

Backup receipt v1 (root:root 0600, directory 0700):
  {kind, runId, source, identity, before:{tables,taskColumns,migrations,...},
   backup:{bytes,sha256,tocSha256,exportedSnapshot,structureCheck}, preparedAt}
Its SHA256 is returned to the local runner. backup-check refuses other drift;
migration-check allows exactly the reviewed additive migration and its defaults.
The sole API-usage exception is ApiToken.lastUsedAt: full fingerprints and dates
remain in receipts, while a separate projection protects every other field/row.
Each comparison reports the actual timestamp differences; no timestamp is reset.
pg_restore --list verifies archive structure, NOT a full restore. No restore,
new database, service changes, W07 changes, migration or production operation.
psql replies use one hex-encoded JSON cell per physical line. On a protocol or
process failure, bounded raw diagnostics remain in the protected run directory;
only constant error codes leave the guest. Failed run directories are never reused.

SAFETY: D:\\Projects\\pero_infra\\infra-recovery\\SAFETY-RULES.md.
An unexpected identity, lock, outcome or data change means STOP, never repair.
"""
import base64
from datetime import datetime, timezone
import fcntl
import hashlib
import json
import os
from pathlib import Path
import re
import socket
import stat
import subprocess
import sys
import threading
from urllib.parse import parse_qsl, unquote, urlsplit


DB_ID = "27b8f7342b9d722ab8788e137b37b03a3037442da038c5b8b98dbb30245b8b6a"
DB_STARTED = "2026-09-23T11:42:14.649193151Z"
OUTER_SHA = "27e3bcd727d9e83170c76a254806fde42590da76cea30c9e1441d873df680139"
MIGRATION = "20260928140000_universal_work_shares"
SQL_SHA = "65058910bdeec05482a9881c4f83a015cd1e86c32e0ffc352278ac3aa378f0a6"
TASK_FIELDS = ["allocationGroupId", "shareUnits", "shareAmount", "splitRevision"]
STACK = Path("/opt/crm-staging")
REFRESH = Path("/var/lib/pero-staging-refresh")
BACKUPS = Path("/var/lib/pero-work-shares-qa")
DOCKER = ["docker", "--host", "unix:///var/run/docker.sock"]
SAFE_ENV = {"PATH": "/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin", "LANG": "C", "LC_ALL": "C"}
HEX64 = re.compile(r"[a-f0-9]{64}\Z")
UUID4 = re.compile(r"[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}\Z")
QA_OPS = {"plan", "prepare", "capture", "inspect", "cleanup", "sessions"}
BACKUP_OPS = {"backup-preflight", "backup-check", "migration-check"}
MAX_PSQL_JSON = 2 * 1024 * 1024
MAX_PSQL_STDOUT_DIAGNOSTIC = 256 * 1024
MAX_PSQL_STDERR_DIAGNOSTIC = 128 * 1024


class Refused(Exception):
    pass


def require(condition, code):
    if not condition:
        raise Refused(code)


def now():
    return datetime.now(timezone.utc).isoformat()


def canonical(value):
    return (json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=False) + "\n").encode("utf-8")


def sha(value):
    return hashlib.sha256(value).hexdigest()


def directory(path, exact_mode=None):
    # Check every ancestor: O_NOFOLLOW on a leaf alone does not protect parents.
    for candidate in reversed([path, *path.parents]):
        info = candidate.lstat()
        require(stat.S_ISDIR(info.st_mode) and info.st_uid == 0 and
                not stat.S_IMODE(info.st_mode) & 0o022, "DIRECTORY_METADATA_MISMATCH")
    if exact_mode is not None:
        require(stat.S_IMODE(path.lstat().st_mode) == exact_mode, "PRIVATE_DIRECTORY_MODE_MISMATCH")


def protected_open(path, flags):
    directory(path.parent)
    descriptor = os.open(path, flags | os.O_NOFOLLOW, 0o600)
    info = os.fstat(descriptor)
    if not (stat.S_ISREG(info.st_mode) and info.st_uid == 0 and info.st_nlink == 1 and
            stat.S_IMODE(info.st_mode) == 0o600):
        os.close(descriptor)
        raise Refused("PRIVATE_FILE_METADATA_MISMATCH")
    return descriptor


def fsync_directory(path):
    descriptor = os.open(path, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
    try:
        os.fsync(descriptor)
    finally:
        os.close(descriptor)


def read_private(path, limit=2 * 1024 * 1024):
    with os.fdopen(protected_open(path, os.O_RDONLY), "rb") as source:
        value = source.read(limit + 1)
    require(len(value) <= limit, "PRIVATE_FILE_TOO_LARGE")
    return value


def write_exclusive(path, value):
    data = value if isinstance(value, bytes) else canonical(value)
    with os.fdopen(protected_open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL), "wb") as target:
        target.write(data)
        target.flush()
        os.fsync(target.fileno())
    fsync_directory(path.parent)
    require(read_private(path) == data, "DURABLE_READBACK_FAILED")
    return sha(data)


def require_refresh_idle():
    try:
        active = json.loads(read_private(REFRESH / "active.json", 64 * 1024))
    except FileNotFoundError:
        return  # This is also the existing W07 wrapper's idle representation.
    require(isinstance(active, dict) and active.get("owner") == "pero-staging-refresh-v1" and
            "runId" in active and active["runId"] is None, "REFRESH_ACTIVE_OR_UNKNOWN")


def inspect(name):
    result = subprocess.run(DOCKER + ["inspect", name], capture_output=True, env=SAFE_ENV, timeout=15, check=False)
    require(result.returncode == 0 and len(result.stdout) < 1024 * 1024, "DOCKER_INSPECT_FAILED")
    rows = json.loads(result.stdout)
    require(isinstance(rows, list) and len(rows) == 1, "DOCKER_INSPECT_AMBIGUOUS")
    return rows[0]


def container_env(item):
    pairs = [value.split("=", 1) for value in item["Config"]["Env"] if "=" in value]
    require(len({pair[0] for pair in pairs}) == len(pairs), "DUPLICATE_CONTAINER_ENV")
    return dict(pairs)


def identity(revision):
    require(socket.gethostname() == "crm-staging" and os.geteuid() == 0, "STAGING_ROOT_REQUIRED")
    directory(STACK)
    watcher = STACK / "watch-staging.sh"
    info = watcher.lstat()
    require(stat.S_ISREG(info.st_mode) and info.st_uid == 0 and not stat.S_IMODE(info.st_mode) & 0o022,
            "WATCHER_METADATA_MISMATCH")
    require(sha(watcher.read_bytes()) == OUTER_SHA, "REFRESH_WATCHER_CHANGED")
    web, db = inspect("crm-staging-web-1"), inspect("crm-staging-db-1")
    for name, item in (("web", web), ("db", db)):
        labels = item["Config"].get("Labels", {})
        require(item.get("Name") == "/crm-staging-" + name + "-1" and
                labels.get("com.docker.compose.project") == "crm-staging" and
                labels.get("com.docker.compose.service") == name and
                labels.get("com.docker.compose.project.working_dir") == str(STACK), "COMPOSE_IDENTITY_MISMATCH")
        require(item["State"].get("Running") is True and item["State"].get("Paused") is False and
                item["State"].get("Health", {}).get("Status") == "healthy", "EXISTING_CONTAINER_NOT_HEALTHY")
    require(web["Config"]["Labels"].get("org.opencontainers.image.revision") == revision, "WEB_REVISION_MISMATCH")
    require(db["Id"] == DB_ID and db["State"]["StartedAt"] == DB_STARTED, "DATABASE_IDENTITY_CHANGED")
    mounts = db.get("Mounts", [])
    require(len(mounts) == 1 and mounts[0].get("Type") == "volume" and mounts[0].get("RW") is True and
            mounts[0].get("Name") == "crm-staging_pgdata" and
            mounts[0].get("Destination") == "/var/lib/postgresql/data", "DATABASE_MOUNT_CHANGED")
    wn, dn = web["NetworkSettings"]["Networks"], db["NetworkSettings"]["Networks"]
    require(set(wn) == {"crm-staging_backend", "crm-staging_frontend"} and set(dn) == {"crm-staging_backend"},
            "STAGING_NETWORK_MISMATCH")
    require(wn["crm-staging_backend"]["NetworkID"] == dn["crm-staging_backend"]["NetworkID"] and
            "db" in dn["crm-staging_backend"].get("Aliases", []), "DATABASE_NETWORK_MISMATCH")
    env, db_env = container_env(web), container_env(db)
    url = urlsplit(env.get("DATABASE_URL", ""))
    query = parse_qsl(url.query, keep_blank_values=True, strict_parsing=True)
    require(url.scheme in ("postgres", "postgresql") and url.hostname == "db" and url.path == "/crm" and
            url.port in (None, 5432) and unquote(url.username or "") == "crm" and not url.fragment and
            len(dict(query)) == len(query) and all(key == "schema" and val == "public" for key, val in query),
            "DATABASE_BINDING_MISMATCH")
    require(db_env.get("POSTGRES_DB") == "crm" and db_env.get("POSTGRES_USER") == "crm" and
            db_env.get("PGDATA") in ("/var/lib/postgresql/data", "/var/lib/postgresql/data/pgdata") and
            db_env.get("POSTGRES_PASSWORD") and unquote(url.password or "") == db_env["POSTGRES_PASSWORD"],
            "DATABASE_RUNTIME_IDENTITY_MISMATCH")
    require(not any(key in db_env for key in ("PGSERVICE", "PGSERVICEFILE", "PGPASSFILE", "PGOPTIONS")), "PG_OVERRIDE_FORBIDDEN")
    require(not any(env.get(key) for key in ("NODE_OPTIONS", "NODE_PATH", "DIRECT_URL")), "WEB_OVERRIDE_FORBIDDEN")
    endpoint = urlsplit(env.get("S3_ENDPOINT", ""))
    require(endpoint.scheme == "http" and endpoint.hostname == "192.168.0.33" and endpoint.port == 9000 and
            not endpoint.username and not endpoint.password and endpoint.path in ("", "/") and
            not endpoint.query and not endpoint.fragment and env.get("S3_BUCKET") == "pero-crm-staging",
            "STAGING_STORAGE_MISMATCH")
    public = {"hostname": "crm-staging", "web": web["Id"], "image": web["Image"], "revision": revision,
              "webStartedAt": web["State"]["StartedAt"], "database": db["Id"], "databaseStartedAt": DB_STARTED,
              "databaseVolume": "crm-staging_pgdata", "pgdata": db_env["PGDATA"], "outerW07Sha256": OUTER_SHA}
    return public, db_env["POSTGRES_PASSWORD"]  # Password remains in this process only.


def validate_seal(seal):
    require(isinstance(seal, dict) and set(seal) == {"format", "sealedBy", "expectedRevision", "wrapperSha256",
            "bundleSha256", "runnerSha256", "source"}, "SEAL_FIELDS_INVALID")
    require(seal["format"] == "pero-work-shares-staging-seal/v1" and seal["sealedBy"] == "root", "ROOT_SEAL_REQUIRED")
    require(isinstance(seal["expectedRevision"], str) and re.fullmatch(r"[a-f0-9]{40}", seal["expectedRevision"]),
            "FULL_REVISION_REQUIRED")
    for key in ("wrapperSha256", "bundleSha256", "runnerSha256"):
        require(isinstance(seal[key], str) and HEX64.fullmatch(seal[key]), "SEAL_HASH_INVALID")
    require(sha(Path(__file__).read_bytes()) == seal["wrapperSha256"], "REVIEWED_WRAPPER_CHANGED")
    source = seal["source"]
    require(isinstance(source, dict) and set(source) == {"migration", "sqlSha256", "schemaSha256",
            "migrationLockSha256", "ownedHelperSha256", "migrations"}, "SOURCE_FIELDS_INVALID")
    require(source["migration"] == MIGRATION and source["sqlSha256"] == SQL_SHA, "REVIEWED_MIGRATION_REQUIRED")
    for key in ("schemaSha256", "migrationLockSha256", "ownedHelperSha256"):
        require(isinstance(source[key], str) and HEX64.fullmatch(source[key]), "SOURCE_HASH_INVALID")
    manifest = source["migrations"]
    require(isinstance(manifest, list) and 1 <= len(manifest) <= 200, "MIGRATION_MANIFEST_INVALID")
    for row in manifest:
        require(isinstance(row, dict) and set(row) == {"name", "sha256", "checkoutSha256"} and
                re.fullmatch(r"[0-9]{14}_[a-z0-9_]+", row.get("name", "")) and
                HEX64.fullmatch(row.get("sha256", "")) and HEX64.fullmatch(row.get("checkoutSha256", "")), "MIGRATION_MANIFEST_INVALID")
    names = [row["name"] for row in manifest]
    require(names == sorted(set(names)) and {"name": MIGRATION, "sha256": SQL_SHA, "checkoutSha256": SQL_SHA} in manifest,
            "MIGRATION_MANIFEST_INVALID")


def pg_command(arguments, password, seconds=600, interactive=False):
    env = {**SAFE_ENV, "PGPASSWORD": password,
           "PGOPTIONS": "-c default_transaction_read_only=on -c search_path=pg_catalog -c timezone=UTC -c statement_timeout=120000 -c lock_timeout=5000 -c idle_in_transaction_session_timeout=600000"}
    command = DOCKER + ["exec"] + (["-i"] if interactive else [])
    # Secret value is inherited by NAME. Never put PGPASSWORD=value in argv.
    command += ["--env", "PGPASSWORD", "--env", "PGOPTIONS", DB_ID, "timeout", "-s", "KILL", str(seconds)] + arguments
    return command, env


def framed_json_sql(sql):
    """A scalar JSON SELECT becomes exactly one nonempty ASCII-hex record."""
    require(isinstance(sql, str) and sql.startswith("SELECT ") and ";" not in sql, "PSQL_SCALAR_SELECT_REQUIRED")
    # json_agg(record) can emit literal LF BETWEEN records. Never concatenate or
    # skip physical lines: encode the complete scalar result in PostgreSQL first.
    return "SELECT pg_catalog.encode(pg_catalog.convert_to((" + sql + ")::text,'UTF8'),'hex')"


def decode_json_frame(frame, limit=MAX_PSQL_JSON):
    require(isinstance(frame, bytes) and frame.endswith(b"\n") and 3 <= len(frame) <= 2 * limit + 1,
            "PSQL_FRAME_SIZE_OR_TERMINATOR_INVALID")
    encoded = frame[:-1]
    require(len(encoded) % 2 == 0 and re.fullmatch(b"[0-9a-f]+", encoded), "PSQL_HEX_FRAME_REQUIRED")
    try:
        text = bytes.fromhex(encoded.decode("ascii")).decode("utf-8", errors="strict")
        # PostgreSQL JSON cannot contain bare NaN/Infinity. Do not let Python's
        # permissive numeric extension conceal a malformed protocol response.
        def invalid_constant(_):
            raise ValueError()
        return json.loads(text, parse_constant=invalid_constant)
    except (ValueError, UnicodeError):
        raise Refused("PSQL_JSON_REQUIRED") from None


class BoundedCapture:
    """Drain a pipe completely while retaining only a bounded private prefix."""
    def __init__(self, limit):
        self.limit = limit
        self.data = bytearray()
        self.total = 0
        self.read_failed = False

    def add(self, value):
        self.total += len(value)
        if len(self.data) < self.limit:
            self.data.extend(value[:self.limit - len(self.data)])

    def drain(self, source):
        try:
            while chunk := source.read(64 * 1024):
                self.add(chunk)
        except OSError:
            self.read_failed = True

    def counts(self):
        return {"bytes": self.total, "capturedBytes": len(self.data),
                "truncated": self.total > len(self.data), "readFailed": self.read_failed}


class Snapshot:
    """A bounded native psql exporter. Every query runs in one READ ONLY snapshot."""
    def __init__(self, password, expected, diagnostic_dir, diagnostic_tag):
        require(diagnostic_dir.parent == BACKUPS and UUID4.fullmatch(diagnostic_dir.name), "PSQL_DIAGNOSTIC_DIRECTORY_INVALID")
        require(re.fullmatch(r"(?:export|fresh|verify)-[a-f0-9-]{36}", diagnostic_tag), "PSQL_DIAGNOSTIC_TAG_INVALID")
        directory(diagnostic_dir, 0o700)
        self.diagnostic_dir, self.diagnostic_tag = diagnostic_dir, diagnostic_tag
        self.failure = None
        self.query_ordinal = 0
        self.query_sha256 = None
        self.stderr = BoundedCapture(MAX_PSQL_STDERR_DIAGNOSTIC)
        self.failed_stdout = BoundedCapture(MAX_PSQL_STDOUT_DIAGNOSTIC)
        command, env = pg_command(["psql", "-X", "-qAt", "--no-password", "-v", "ON_ERROR_STOP=1",
                                   "-h", "127.0.0.1", "-p", "5432", "-U", "crm", "-d", "crm"], password, interactive=True)
        self.process = subprocess.Popen(command, stdin=subprocess.PIPE, stdout=subprocess.PIPE,
                                        stderr=subprocess.PIPE, env=env)
        self.stderr_thread = threading.Thread(target=self.stderr.drain, args=(self.process.stderr,), daemon=True)
        self.stderr_thread.start()
        self.closed = False
        try:
            self.send("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY;")
            self.facts = self.query("SELECT pg_catalog.json_build_object('database',current_database(),'username',current_user,"
                "'sessionUser',session_user,'readonly',current_setting('transaction_read_only'),"
                "'pgdata',current_setting('data_directory'),'port',inet_server_port(),'recovery',pg_is_in_recovery(),"
                "'version',current_setting('server_version_num'),'postmasterStarted',pg_postmaster_start_time()::text,"
                "'snapshot',pg_export_snapshot())")
            require(self.facts["database"] == "crm" and self.facts["username"] == "crm" and
                    self.facts["sessionUser"] == "crm" and self.facts["readonly"] == "on" and
                    self.facts["pgdata"] == expected["pgdata"] and self.facts["port"] == 5432 and
                    self.facts["recovery"] is False, "DATABASE_READONLY_IDENTITY_MISMATCH")
            require(re.fullmatch(r"[a-fA-F0-9-]{1,100}", self.facts["snapshot"]), "SNAPSHOT_ID_INVALID")
        except Exception:
            self.close()
            raise

    def send(self, sql):
        self.process.stdin.write((sql + "\n").encode())
        self.process.stdin.flush()

    def query(self, sql):
        self.query_ordinal += 1
        self.query_sha256 = sha(sql.encode("utf-8"))
        data = b""
        try:
            self.send(framed_json_sql(sql) + ";")
            # Include one byte beyond the maximum frame, so a truncated prefix
            # is refused. A single LF is mandatory and hex has no internal LF.
            data = self.process.stdout.readline(2 * MAX_PSQL_JSON + 2)
            return decode_json_frame(data)
        except (Refused, OSError) as error:
            self.failure = str(error) if isinstance(error, Refused) else "PSQL_PIPE_FAILED"
            self.failed_stdout.add(data)
            self.close()
            raise Refused(self.failure) from None

    def persist_diagnostics(self, exit_code):
        prefix = "psql-" + self.diagnostic_tag
        # Protected regular files, O_EXCL + fsync; no old receipt is overwritten.
        write_exclusive(self.diagnostic_dir / (prefix + "-stdout.bin"), bytes(self.failed_stdout.data))
        write_exclusive(self.diagnostic_dir / (prefix + "-stderr.bin"), bytes(self.stderr.data))
        write_exclusive(self.diagnostic_dir / (prefix + "-diagnostic.json"), {
            "status": "STOP", "code": self.failure, "at": now(), "exitCode": exit_code,
            "queryOrdinal": self.query_ordinal, "querySha256": self.query_sha256,
            "framing": "UTF8_JSON_AS_HEX_ONE_LF", "stdout": self.failed_stdout.counts(), "stderr": self.stderr.counts()})

    def close(self):
        if self.closed:
            return
        self.closed = True
        original_failure = self.failure
        try:
            self.send("ROLLBACK;\n\\q")
        except (BrokenPipeError, OSError):
            pass
        finally:
            try:
                self.process.stdin.close()
            except (BrokenPipeError, OSError):
                pass
        # No outer Docker timeout. Its container-local deadline bounds psql.
        # Drain without unbounded allocation. Even on a bad frame we resolve the
        # bounded in-container process before releasing the surrounding W07 lock.
        prior_stdout = self.failed_stdout.total
        self.failed_stdout.drain(self.process.stdout)
        exit_code = self.process.wait()
        self.stderr_thread.join()
        if not self.failure and (self.failed_stdout.total != prior_stdout or self.failed_stdout.read_failed):
            self.failure = "PSQL_UNEXPECTED_TRAILING_OUTPUT"
        if not self.failure and (exit_code != 0 or self.stderr.read_failed):
            self.failure = "PSQL_PROCESS_FAILED"
        if self.failure:
            try:
                self.persist_diagnostics(exit_code)
            except Exception:
                raise Refused("PSQL_DIAGNOSTIC_PERSIST_FAILED") from None
            if original_failure is None:
                raise Refused(self.failure)

    def __enter__(self):
        return self

    def __exit__(self, *args):
        self.close()


def row_hash_sql(table, plugin_projection=False, api_token_projection=False):
    require(re.fullmatch(r"[A-Za-z_][A-Za-z0-9_]*", table), "PUBLIC_TABLE_IDENTIFIER_UNSUPPORTED")
    row = "(pg_catalog.to_jsonb(t) - ARRAY['allocationGroupId','shareUnits','shareAmount','splitRevision'])" if table == "Task" else "pg_catalog.to_jsonb(t)"
    if plugin_projection:
        require(table == "Plugin", "PLUGIN_PROJECTION_TABLE_INVALID")
        # Only the two registry manifests are upserted by instrumentation. Other
        # Plugin rows retain their FULL hash, including updatedAt.
        row = "(CASE WHEN t.id IN ('demo','file-stages') THEN pg_catalog.to_jsonb(t) - 'updatedAt' ELSE pg_catalog.to_jsonb(t) END)"
    if api_token_projection:
        require(table == "ApiToken" and not plugin_projection, "API_TOKEN_PROJECTION_TABLE_INVALID")
        # Routine API verification writes only lastUsedAt. IDs, token hash,
        # scopes, revocation, ownership and every other field remain protected.
        row = "(pg_catalog.to_jsonb(t) - 'lastUsedAt')"
    return ("SELECT pg_catalog.json_build_object('count',count(*)::text,'hash',pg_catalog.md5(COALESCE("
            "pg_catalog.string_agg(r.digest,'' ORDER BY r.digest COLLATE \"C\"),''))) FROM "
            f"(SELECT pg_catalog.md5(({row})::text) AS digest FROM public.\"{table}\" t) r")


def state_snapshot(snapshot):
    tables = snapshot.query("SELECT COALESCE(pg_catalog.json_agg(c.relname ORDER BY c.relname COLLATE \"C\"),'[]') "
        "FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace "
        "WHERE n.nspname='public' AND c.relkind IN ('r','p')")
    require(isinstance(tables, list) and 3 <= len(tables) <= 200 and all(t in tables for t in ("Task", "Work", "_prisma_migrations")),
            "PUBLIC_TABLE_CATALOG_INVALID")
    # The ledger is included: preflight compares EVERY public table. Post-migration
    # checks allow only the exact new ledger record, without hiding other changes.
    hashes = {table: snapshot.query(row_hash_sql(table)) for table in tables}
    columns = snapshot.query("SELECT COALESCE(pg_catalog.json_agg(r ORDER BY r.pos),'[]') FROM (SELECT "
        "a.attnum AS pos,a.attname AS name,pg_catalog.format_type(a.atttypid,a.atttypmod) AS type,"
        "a.attnotnull AS required,pg_catalog.pg_get_expr(d.adbin,d.adrelid) AS default "
        "FROM pg_catalog.pg_attribute a LEFT JOIN pg_catalog.pg_attrdef d ON d.adrelid=a.attrelid AND d.adnum=a.attnum "
        "WHERE a.attrelid='public.\"Task\"'::regclass AND a.attnum>0 AND NOT a.attisdropped) r")
    migrations = snapshot.query("SELECT COALESCE(pg_catalog.json_agg(r ORDER BY r.name COLLATE \"C\",r.\"startedAt\",r.id),'[]') "
        "FROM (SELECT id,migration_name AS name,checksum,started_at::text AS \"startedAt\","
        "finished_at::text AS \"finishedAt\",rolled_back_at::text AS \"rolledBackAt\",applied_steps_count AS steps "
        "FROM public.\"_prisma_migrations\") r")
    facts = {key: value for key, value in snapshot.facts.items() if key != "snapshot"}
    require("Plugin" in tables, "PLUGIN_TABLE_REQUIRED")
    plugin_projection = snapshot.query(row_hash_sql("Plugin", True))
    plugin_dates = snapshot.query('SELECT COALESCE(pg_catalog.json_agg(r ORDER BY r.id COLLATE "C"),\'[]\') FROM '
        '(SELECT id,"updatedAt"::text AS "updatedAt" FROM public."Plugin" WHERE id IN (\'demo\',\'file-stages\')) r')
    require("ApiToken" in tables, "API_TOKEN_TABLE_REQUIRED")
    api_token_projection = snapshot.query(row_hash_sql("ApiToken", api_token_projection=True))
    api_token_usage = snapshot.query('SELECT COALESCE(pg_catalog.json_agg(r ORDER BY r.id COLLATE "C"),\'[]\') FROM '
        '(SELECT id,"lastUsedAt"::text AS "lastUsedAt" FROM public."ApiToken") r')
    return {"identity": facts, "algorithm": "md5-sorted-row-md5-multiset/v1", "tables": hashes,
            "taskColumns": columns, "migrations": migrations, "pluginProjection": plugin_projection, "pluginDates": plugin_dates,
            "apiTokenProjection": api_token_projection, "apiTokenUsageDates": api_token_usage}


def api_token_usage_evidence(previous, current):
    """Verify protected rows first, then describe only the observed date changes."""
    for state in (previous, current):
        projection = state.get("apiTokenProjection")
        usage = state.get("apiTokenUsageDates")
        full = state.get("tables", {}).get("ApiToken")
        require(isinstance(projection, dict) and isinstance(usage, list) and isinstance(full, dict), "API_TOKEN_EVIDENCE_REQUIRED")
        require(all(isinstance(row, dict) and set(row) == {"id", "lastUsedAt"} and isinstance(row["id"], str) and
                    (row["lastUsedAt"] is None or isinstance(row["lastUsedAt"], str)) for row in usage), "API_TOKEN_USAGE_EVIDENCE_INVALID")
        ids = [row["id"] for row in usage]
        require(len(set(ids)) == len(ids) and full.get("count") == projection.get("count") == str(len(usage)), "API_TOKEN_COUNT_OR_ID_MISMATCH")
    require(previous["apiTokenProjection"] == current["apiTokenProjection"], "API_TOKEN_PROTECTED_FIELDS_CHANGED")
    require([row["id"] for row in previous["apiTokenUsageDates"]] == [row["id"] for row in current["apiTokenUsageDates"]], "API_TOKEN_IDENTITIES_CHANGED")
    changes = [{"id": old["id"], "before": old["lastUsedAt"], "after": new["lastUsedAt"]}
               for old, new in zip(previous["apiTokenUsageDates"], current["apiTokenUsageDates"]) if old != new]
    return {"beforeFullFingerprint": previous["tables"]["ApiToken"], "afterFullFingerprint": current["tables"]["ApiToken"],
            "protectedFingerprint": previous["apiTokenProjection"], "beforeUsageDates": previous["apiTokenUsageDates"],
            "afterUsageDates": current["apiTokenUsageDates"], "changes": changes}


def state_with_protected_api_tokens(state):
    # Return a comparison-only view. Original full fingerprints/dates and the
    # native archive are retained untouched, never rewritten to the projection.
    return {**state, "tables": {**state["tables"], "ApiToken": state["apiTokenProjection"]},
            "apiTokenUsageDates": [{"id": row["id"]} for row in state["apiTokenUsageDates"]]}


def compare_snapshots(previous, current, code):
    usage = api_token_usage_evidence(previous, current)
    require(state_with_protected_api_tokens(previous) == state_with_protected_api_tokens(current), code)
    return usage


def check_migrations(state, source, pending):
    rows = state["migrations"]
    manifest = {row["name"]: {row["sha256"], row["checkoutSha256"]} for row in source["migrations"]}
    require(all(row["finishedAt"] or row["rolledBackAt"] for row in rows), "MIGRATION_UNFINISHED_OR_FAILED")
    require(all(row["name"] in manifest for row in rows), "MIGRATION_HISTORY_NOT_IN_SOURCE")
    applied = [row for row in rows if row["finishedAt"] and not row["rolledBackAt"]]
    require(len({row["name"] for row in applied}) == len(applied), "DUPLICATE_APPLIED_MIGRATION")
    # Historical ledgers can contain Windows CRLF or Git/Linux LF checksums.
    # Both exact byte hashes are recorded in the root-sealed manifest. Only EOL
    # normalization is allowed; new reviewed SQL must be the fixed LF SQL_SHA.
    require(all(row["checksum"] in manifest[row["name"]] for row in applied), "MIGRATION_CHECKSUM_DRIFT")
    missing = sorted(set(manifest) - {row["name"] for row in applied})
    require(missing == ([MIGRATION] if pending else []), "MIGRATION_PENDING_NOT_EXACT_APPROVED")
    if pending:
        require(not any(row["name"] == MIGRATION for row in rows), "APPROVED_MIGRATION_ALREADY_ATTEMPTED")
        require("TaskAllocationGroup" not in state["tables"] and
                not any(col["name"] in TASK_FIELDS for col in state["taskColumns"]), "PRE_MIGRATION_SCHEMA_ALREADY_PRESENT")


def hash_private(path):
    digest = hashlib.sha256()
    with os.fdopen(protected_open(path, os.O_RDONLY), "rb") as source:
        info = os.fstat(source.fileno())
        while chunk := source.read(1024 * 1024):
            digest.update(chunk)
    return {"bytes": info.st_size, "sha256": digest.hexdigest()}


def check_archive(run_dir, password, tables, expected=None):
    path = run_dir / "stage-before.dump"
    result = hash_private(path)
    with os.fdopen(protected_open(path, os.O_RDONLY), "rb") as source:
        require(source.read(5) == b"PGDMP" and result["bytes"] >= 1024, "CUSTOM_ARCHIVE_REQUIRED")
    if expected:
        require(result == {key: expected[key] for key in ("bytes", "sha256")}, "BACKUP_BYTES_CHANGED")
    command, env = pg_command(["pg_restore", "--list"], password, seconds=120, interactive=True)
    with os.fdopen(protected_open(path, os.O_RDONLY), "rb") as source:
        listed = subprocess.run(command, stdin=source, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, env=env, check=False)
    require(listed.returncode == 0 and 0 < len(listed.stdout) <= 2 * 1024 * 1024, "ARCHIVE_TOC_FAILED")
    toc = listed.stdout.decode("utf-8")
    for table in tables:
        require(re.search(r"\bTABLE public " + re.escape(table) + r"\s", toc) and
                re.search(r"\bTABLE DATA public " + re.escape(table) + r"\s", toc), "ARCHIVE_TOC_TABLE_MISSING")
    result["tocSha256"] = sha(listed.stdout)
    if expected:
        require(result["tocSha256"] == expected["tocSha256"], "BACKUP_TOC_CHANGED")
        require(read_private(run_dir / "archive-list.txt") == listed.stdout, "SAVED_TOC_CHANGED")
    else:
        write_exclusive(run_dir / "archive-list.txt", listed.stdout)
    return result


def create_backup(packet, before, password):
    run_id, source = packet["runId"], packet["seal"]["source"]
    directory(BACKUPS.parent)
    try:
        BACKUPS.mkdir(mode=0o700)
        fsync_directory(BACKUPS.parent)
    except FileExistsError:
        pass
    directory(BACKUPS, 0o700)
    run_dir = BACKUPS / run_id
    try:
        run_dir.mkdir(mode=0o700)
    except FileExistsError:
        raise Refused("BACKUP_RUN_ALREADY_ATTEMPTED") from None
    fsync_directory(BACKUPS)
    directory(run_dir, 0o700)
    write_exclusive(run_dir / "started.json", {"status": "STARTED", "runId": run_id,
        "identity": before, "source": source, "startedAt": now()})
    try:
        with Snapshot(password, before, run_dir, "export-" + packet["attemptId"]) as snapshot:
            state = state_snapshot(snapshot)
            check_migrations(state, source, True)
            command, env = pg_command(["pg_dump", "--no-password", "--host=127.0.0.1", "--port=5432",
                "--username=crm", "--dbname=crm", "--format=custom", "--snapshot=" + snapshot.facts["snapshot"]], password, seconds=480)
            with os.fdopen(protected_open(run_dir / "stage-before.dump", os.O_WRONLY | os.O_CREAT | os.O_EXCL), "wb") as target:
                dumped = subprocess.run(command, stdout=target, stderr=subprocess.DEVNULL, env=env, check=False)
                target.flush()
                os.fsync(target.fileno())
            fsync_directory(run_dir)
            require(dumped.returncode == 0, "NATIVE_DUMP_FAILED")
            backup = check_archive(run_dir, password, state["tables"])
            backup.update({"exportedSnapshot": snapshot.facts["snapshot"],
                "structureCheck": "pg_restore --list; NOT a restore test"})
        require_refresh_idle()
        after, _ = identity(packet["seal"]["expectedRevision"])
        require(after == before, "DEPLOYMENT_CHANGED_DURING_BACKUP")
        with Snapshot(password, after, run_dir, "fresh-" + packet["attemptId"]) as fresh:
            current = state_snapshot(fresh)
        usage = compare_snapshots(state, current, "DATA_CHANGED_DURING_BACKUP")
        receipt = {"version": 1, "kind": "PERO_WORK_SHARES_STAGE_PREMIGRATION", "runId": run_id,
                   "source": source, "identity": before, "pendingMigrations": [MIGRATION],
                   "before": state, "backup": backup, "freshApiTokenUsage": usage, "preparedAt": now()}
        receipt_sha = write_exclusive(run_dir / "receipt.json", receipt)
        write_exclusive(run_dir / "receipt.sha256", (receipt_sha + "\n").encode())
        return {"publicSummary": {"status": "PASS", "operation": "backup-preflight", "runId": run_id,
                "receiptSha256": receipt_sha, "dumpSha256": backup["sha256"], "dumpBytes": backup["bytes"],
                "publicTableCount": len(state["tables"]), "pendingMigrationCount": 1,
                "sqlSha256": SQL_SHA, "restoreTest": "NOT_RUN", "allowedApiTokenLastUsedAtChanges": len(usage["changes"]),
                "apiTokenProtectedFieldsUnchanged": True}, "privatePayload": {"receipt": receipt}}
    except Exception as error:
        code = str(error) if isinstance(error, Refused) else "BACKUP_FAILED_INSPECT_ARTIFACTS"
        write_exclusive(run_dir / "stopped.json", {"status": "STOP", "code": code, "at": now(), "noAutomaticRetry": True})
        raise


def verify_backup(packet, before, password):
    run_dir = BACKUPS / packet["runId"]
    directory(BACKUPS, 0o700)
    directory(run_dir, 0o700)
    raw = read_private(run_dir / "receipt.json")
    require(sha(raw) == packet["receiptSha256"] and read_private(run_dir / "receipt.sha256") == (sha(raw) + "\n").encode(),
            "BACKUP_RECEIPT_CHANGED")
    receipt = json.loads(raw)
    require(receipt.get("kind") == "PERO_WORK_SHARES_STAGE_PREMIGRATION" and receipt.get("version") == 1 and
            receipt.get("runId") == packet["runId"] and receipt["source"] == packet["seal"]["source"], "BACKUP_SOURCE_MISMATCH")
    same_target = ("hostname", "database", "databaseStartedAt", "databaseVolume", "pgdata", "outerW07Sha256")
    require(all(before[key] == receipt["identity"][key] for key in same_target), "BACKUP_TARGET_MISMATCH")
    check_archive(run_dir, password, receipt["before"]["tables"], receipt["backup"])
    with Snapshot(password, before, run_dir, "verify-" + packet["attemptId"]) as snapshot:
        current = state_snapshot(snapshot)
        if packet["operation"] == "backup-check":
            require(before == receipt["identity"], "PRE_PUSH_IMAGE_CHANGED")
            check_migrations(current, receipt["source"], True)
            usage = compare_snapshots(receipt["before"], current, "DATA_DRIFT_SINCE_BACKUP")
        else:
            check_migrations(current, receipt["source"], False)
            previous = receipt["before"]
            usage = api_token_usage_evidence(previous, current)
            require(current["identity"] == previous["identity"], "DATABASE_SESSION_IDENTITY_CHANGED")
            require(set(current["tables"]) == set(previous["tables"]) | {"TaskAllocationGroup"}, "POST_MIGRATION_TABLE_SET_CHANGED")
            require(all(current["tables"][key] == value for key, value in previous["tables"].items() if key not in ("_prisma_migrations", "Plugin", "ApiToken")),
                    "POST_MIGRATION_ORIGINAL_ROWS_CHANGED")
            require(current["pluginProjection"] == previous["pluginProjection"], "POST_PLUGIN_FIELDS_CHANGED")
            require([row["id"] for row in current["pluginDates"]] == [row["id"] for row in previous["pluginDates"]], "POST_PLUGIN_IDS_CHANGED")
            for old, new in zip(previous["pluginDates"], current["pluginDates"]):
                if old != new:
                    updated = datetime.fromisoformat(new["updatedAt"]).replace(tzinfo=timezone.utc)
                    prior = datetime.fromisoformat(old["updatedAt"]).replace(tzinfo=timezone.utc)
                    started = datetime.fromisoformat(before["webStartedAt"].replace("Z", "+00:00"))
                    require(updated >= prior and started <= updated <= datetime.now(timezone.utc), "POST_PLUGIN_DATE_OUTSIDE_STARTUP")
            require(current["tables"]["TaskAllocationGroup"]["count"] == "0", "POST_MIGRATION_GROUP_NOT_EMPTY")
            require([row for row in current["migrations"] if row["name"] != MIGRATION] == previous["migrations"],
                    "POST_OTHER_MIGRATION_HISTORY_CHANGED")
            require([col for col in current["taskColumns"] if col["name"] not in TASK_FIELDS] == previous["taskColumns"],
                    "POST_ORIGINAL_TASK_COLUMNS_CHANGED")
            added = [{key: val for key, val in col.items() if key != "pos"} for col in current["taskColumns"] if col["name"] in TASK_FIELDS]
            require(added == [{"name": "allocationGroupId", "type": "text", "required": False, "default": None},
                {"name": "shareUnits", "type": "integer", "required": False, "default": None},
                {"name": "shareAmount", "type": "numeric(12,2)", "required": False, "default": None},
                {"name": "splitRevision", "type": "integer", "required": True, "default": "0"}], "POST_TASK_FIELDS_MISMATCH")
            invalid = snapshot.query('SELECT pg_catalog.to_json(count(*)::text) FROM public."Task" WHERE "allocationGroupId" IS NOT NULL '
                'OR "shareUnits" IS NOT NULL OR "shareAmount" IS NOT NULL OR "splitRevision" IS NULL OR "splitRevision" <> 0')
            require(invalid == "0", "POST_TASK_DEFAULTS_CHANGED")
    result = {"publicSummary": {"status": "PASS", "operation": packet["operation"], "runId": packet["runId"],
              "receiptSha256": sha(raw), "originalPublicTablesVerified": len(receipt["before"]["tables"]) -
              (1 if packet["operation"] == "migration-check" else 0), "sqlSha256": SQL_SHA,
              "newDefaults": "PASS" if packet["operation"] == "migration-check" else "NOT_APPLIED",
              "allowedApiTokenLastUsedAtChanges": len(usage["changes"]), "apiTokenProtectedFieldsUnchanged": True},
              "privatePayload": {"after": current, "apiTokenUsage": usage}}
    if packet["operation"] == "migration-check":
        result["publicSummary"]["allowedPluginUpdatedAtChanges"] = sum(old != new for old, new in zip(receipt["before"]["pluginDates"], current["pluginDates"]))
        result["publicSummary"]["pluginOtherFieldsUnchanged"] = True
        result["publicSummary"]["taskOldColumnsUnchanged"] = True
    write_exclusive(run_dir / (packet["operation"] + "-" + packet["attemptId"] + ".json"), result)
    return result


def execute_qa(packet, before):
    request = packet["input"]
    require(isinstance(request, dict) and request.get("operation") == packet["operation"] and request.get("target") == "staging",
            "QA_TARGET_OR_OPERATION_MISMATCH")
    allowed = {"operation", "target", "envelope", "durablePlanSha256", "durableCheckpointSha256", "actionsDrained", "baseUrl"}
    require(set(request) <= allowed, "QA_FIELDS_FORBIDDEN")
    bundle = base64.b64decode(packet["bundle"], validate=True)
    require(0 < len(bundle) <= 768 * 1024 and sha(bundle) == packet["seal"]["bundleSha256"], "QA_BUNDLE_MISMATCH")
    data = base64.b64encode(canonical(request)).decode()
    require(len(data) <= 96 * 1024, "QA_INPUT_TOO_LARGE")
    env = {**SAFE_ENV, "CRM_WORK_SHARES_QA_INPUT": data}
    command = DOCKER + ["exec", "-i", "-w", "/app/apps/web", "--env", "CRM_WORK_SHARES_QA_INPUT", before["web"],
                       "timeout", "-s", "KILL", "150", "node", "--input-type=module"]
    # Deadline inside container; NO outer timeout or cancellation of just docker.
    result = subprocess.run(command, input=bundle, capture_output=True, env=env, check=False)
    require(len(result.stdout) <= 1024 * 1024, "QA_OUTPUT_TOO_LARGE_INSPECT_OUTCOME")
    try:
        body = json.loads(result.stdout)
    except (ValueError, UnicodeError):
        raise Refused("QA_JSON_REQUIRED_INSPECT_OUTCOME") from None
    require(isinstance(body, dict) and set(body) == {"publicSummary", "privatePayload"}, "QA_RESPONSE_INVALID_INSPECT_OUTCOME")
    require(result.returncode == 0 or body["publicSummary"].get("status") == "STOP", "QA_PROCESS_FAILED_INSPECT_OUTCOME")
    return body


def main():
    require(socket.gethostname() == "crm-staging" and os.geteuid() == 0, "STAGING_ROOT_REQUIRED")
    os.umask(0o077)
    raw = sys.stdin.buffer.read(2 * 1024 * 1024 + 1)
    require(len(raw) <= 2 * 1024 * 1024, "PACKET_TOO_LARGE")
    packet = json.loads(raw)
    require(isinstance(packet, dict) and set(packet) <= {"seal", "operation", "attemptId", "runId", "receiptSha256", "input", "bundle"},
            "PACKET_FIELDS_FORBIDDEN")
    validate_seal(packet.get("seal"))
    operation = packet.get("operation")
    require(operation in QA_OPS | BACKUP_OPS, "OPERATION_FORBIDDEN")
    require(UUID4.fullmatch(packet.get("attemptId", "")), "ATTEMPT_ID_REQUIRED")
    if operation in BACKUP_OPS:
        require(UUID4.fullmatch(packet.get("runId", "")), "BACKUP_RUN_ID_REQUIRED")
        require("bundle" not in packet and "input" not in packet, "BACKUP_EXTRA_FIELDS_FORBIDDEN")
        if operation != "backup-preflight":
            require(HEX64.fullmatch(packet.get("receiptSha256", "")), "BACKUP_RECEIPT_SHA_REQUIRED")
    else:
        require("runId" not in packet and "receiptSha256" not in packet, "QA_EXTRA_FIELDS_FORBIDDEN")
    directory(REFRESH)
    with os.fdopen(protected_open(REFRESH / "workflow.lock", os.O_RDWR), "r+") as lock:
        try:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            raise Refused("REFRESH_OR_DEPLOY_BUSY") from None
        require_refresh_idle()
        before, password = identity(packet["seal"]["expectedRevision"])
        if operation == "backup-preflight":
            result = create_backup(packet, before, password)
        elif operation in BACKUP_OPS:
            result = verify_backup(packet, before, password)
        else:
            result = execute_qa(packet, before)
        require_refresh_idle()
        after, _ = identity(packet["seal"]["expectedRevision"])
        require(after == before, "DEPLOYMENT_CHANGED_INSPECT_OUTCOME")
        # PRIVATE stdout, not an operator log. AUTH_SECRET is never transported.
        print(json.dumps({"identity": before, "operation": operation, "attemptId": packet["attemptId"],
                          "result": result}, separators=(",", ":")))
        return 0 if result["publicSummary"].get("status") == "PASS" else 1


if __name__ == "__main__":
    try:
        sys.exit(main())
    except Refused as error:
        print(json.dumps({"publicSummary": {"status": "STOP", "code": str(error)}, "privatePayload": None}))
        sys.exit(2)
    except Exception:
        print(json.dumps({"publicSummary": {"status": "STOP", "code": "WRAPPER_FAILED_INSPECT_OUTCOME"}, "privatePayload": None}))
        sys.exit(2)
