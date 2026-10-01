"""Read Docker metadata only; do not connect to any database."""
import json
import socket
import subprocess
from urllib.parse import urlsplit, unquote

if socket.gethostname() != "crm-staging":
    raise RuntimeError("HOST_MISMATCH")

def inspect(name):
    return json.loads(subprocess.check_output(["docker", "--host", "unix:///var/run/docker.sock", "inspect", name], text=True))[0]

database = inspect("crm-staging-db-1")
if database["Id"] != "27b8f7342b9d722ab8788e137b37b03a3037442da038c5b8b98dbb30245b8b6a":
    raise RuntimeError("DATABASE_IDENTITY_MISMATCH")
web = inspect("crm-staging-web-1")
if web["Config"]["Labels"].get("com.docker.compose.project") != "crm-staging":
    raise RuntimeError("WEB_PROJECT_MISMATCH")
database_env = dict(item.split("=", 1) for item in database["Config"]["Env"] if "=" in item)
web_env = dict(item.split("=", 1) for item in web["Config"]["Env"] if "=" in item)
url = urlsplit(web_env["DATABASE_URL"])
print(json.dumps({
    "containerId": database["Id"],
    "bootstrapDatabase": database_env.get("POSTGRES_DB"),
    "bootstrapUser": database_env.get("POSTGRES_USER"),
    "applicationDatabase": unquote(url.path.lstrip("/")),
    "applicationUser": unquote(url.username or ""),
    "applicationHost": url.hostname,
    "applicationPort": url.port or 5432,
    "revision": web["Config"]["Labels"].get("org.opencontainers.image.revision"),
    "s3Bucket": web_env.get("S3_BUCKET"),
}, ensure_ascii=False))
