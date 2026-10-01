"""One HTTPS-only NBRB diagnostic; hash-name this file before stage execution."""
import datetime
import hashlib
import json
import math
from pathlib import Path
import socket
import urllib.request


class Stop(Exception):
    pass

class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, request, response, code, message, headers, new_url):
        return None


def class_name(value):
    name = type(value).__name__
    return name if name.isascii() and name.isalnum() and name[:1].isalpha() else "Error"


def main():
    day = datetime.datetime.now(datetime.timezone.utc).date().isoformat()
    status = "ERROR"
    try:
        if socket.gethostname() != "crm-staging":
            raise Stop("HOST_MISMATCH")
        digest = hashlib.sha256(Path(__file__).read_bytes()).hexdigest()
        if Path(__file__).name != f"cash-fx-diagnostics-{digest}.py":
            raise Stop("SCRIPT_HASH_NAME_MISMATCH")
        url = f"https://api.nbrb.by/exrates/rates/USD?parammode=2&ondate={day}"
        with urllib.request.build_opener(NoRedirect()).open(url, timeout=8) as response:
            status = response.getcode()
            body = response.read(65537)
        if len(body) > 65536:
            raise Stop("RESPONSE_TOO_LARGE")
        data = json.loads(body.decode("utf-8"))
        if not isinstance(data, dict):
            raise Stop("RATE_RESPONSE_INVALID")
        official, scale = data["Cur_OfficialRate"], data["Cur_Scale"]
        if any(isinstance(value, bool) or not isinstance(value, (int, float)) for value in (official, scale)) or scale <= 0:
            raise Stop("RATE_RESPONSE_INVALID")
        rate = float(official) / float(scale)
        if status != 200 or not math.isfinite(rate) or rate <= 0:
            raise Stop("RATE_RESPONSE_INVALID")
        if not isinstance(data["Date"], str):
            raise Stop("RATE_RESPONSE_INVALID")
        date = datetime.datetime.fromisoformat(data["Date"].replace("Z", "+00:00")).date().isoformat()
        print(json.dumps({"utcDay": day, "status": status, "rate": math.floor(rate * 1_000_000 + 0.5) / 1_000_000, "date": date}))
    except Exception as error:
        reason = getattr(error, "reason", None)
        reason_class = class_name(reason) if isinstance(reason, BaseException) else "Text" if isinstance(reason, str) else "None"
        result = {"utcDay": day, "status": getattr(error, "code", status),
                  "exceptionClass": class_name(error), "reasonClass": reason_class}
        print(json.dumps(result))

if __name__ == "__main__":
    main()
