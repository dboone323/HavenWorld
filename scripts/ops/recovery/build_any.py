#!/usr/bin/env python3
import hashlib, json, os, sys

INSTANCE = "ocid1.instance.oc1.us-chicago-1.anxxeljtmwdgjgacz2zo6xk65k62kbscd62stcztuvft4hgzsn2edrv36bja"
src, out = sys.argv[1], sys.argv[2]
root = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
state = os.path.join(root, "logs", "local", "recovery-json")
os.makedirs(state, exist_ok=True)
text = open(src, "r").read()
content = {
    "source": {
        "sourceType": "TEXT",
        "text": text,
        "textSha256": hashlib.sha256(text.encode()).hexdigest(),
    },
    "output": {"outputType": "TEXT"},
}
json.dump(content, open(out, "w"), indent=2)
json.dump({"instanceId": INSTANCE}, open(os.path.join(state, "rc_target.json"), "w"), indent=2)
print(f"{src} ({len(text.encode())} bytes, PLAIN text) -> {out}")

