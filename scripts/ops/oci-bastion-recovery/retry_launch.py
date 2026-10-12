#!/usr/bin/env python3
"""Retry A1 Flex launch across ADs and shapes until capacity found."""
import json, subprocess, time, copy, sys

BASE = json.load(open('/Users/danielstevens/fresh_launch.json'))
ADS = ["RqiG:US-CHICAGO-1-AD-1", "RqiG:US-CHICAGO-1-AD-2", "RqiG:US-CHICAGO-1-AD-3"]
SHAPES = [(4.0, 24.0), (2.0, 12.0), (1.0, 6.0)]  # prefer full size, step down only if needed

for attempt in range(1, 41):  # 40 attempts total
    for oc, mem in SHAPES:
        for ad in ADS:
            cfg = copy.deepcopy(BASE)
            cfg["availabilityDomain"] = ad
            cfg["shapeConfig"] = {"ocpus": oc, "memoryInGBs": mem}
            path = f'/Users/danielstevens/fresh_launch_try.json'
            json.dump(cfg, open(path, 'w'))
            print(f"[{attempt}] try ad={ad[-4:]} ocpu={oc} mem={mem} ...", flush=True)
            r = subprocess.run(
                ["oci", "compute", "instance", "launch", "--from-json", f"file://{path}",
                 "--wait-for-state", "RUNNING", "--max-wait-seconds", "420"],
                capture_output=True, text=True, timeout=480)
            if r.returncode == 0:
                d = json.loads(r.stdout)
                print(f"SUCCESS id={d['id']} ip={d.get('ip')} ad={ad} ocpu={oc}", flush=True)
                json.dump(d, open('/Users/danielstevens/fresh_instance.json', 'w'))
                sys.exit(0)
            err = (r.stderr + r.stdout)[:300]
            # capacity error -> keep trying; endpoint timeout -> transient, retry;
            # real config error (auth/invalid param) -> abort
            retryable = any(t in err for t in (
                "Out of host capacity", "InternalError",
                "timed out", "RequestException", "ConnectionError", "502", "504"))
            if not retryable:
                print(f"NON-CAPACITY ERROR, aborting: {err}", flush=True)
                sys.exit(2)
            print(f"    no capacity/timeout ({err.splitlines()[1] if len(err.splitlines())>1 else 'transient'})", flush=True)
    time.sleep(45)
print("EXHAUSTED all attempts", flush=True)
sys.exit(3)
