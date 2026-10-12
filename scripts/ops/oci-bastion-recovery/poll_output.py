#!/usr/bin/env python3
import json, subprocess, sys, time

command_id = sys.argv[1]
for i in range(60):
    result = subprocess.run(
        ["oci", "instance-agent", "command-execution", "get",
         "--command-id", command_id, "--instance-id",
         "ocid1.instance.oc1.us-chicago-1.anxxeljtmwdgjgacz2zo6xk65k62kbscd62stcztuvft4hgzsn2edrv36bja"],
        capture_output=True, text=True, timeout=30
    )
    if result.returncode == 0:
        data = json.loads(result.stdout)
        state = data.get('data', {}).get('lifecycle-state', '')
        content = data.get('data', {}).get('content', {})
        if content.get('text') or content.get('exit-code') is not None:
            print(f"\n=== OUTPUT (attempt {i+1}) ===")
            print(f"State: {state}")
            print(f"Exit code: {content.get('exit-code')}")
            print(f"Text:\n{content.get('text', '(empty)')}")
            if state in ('SUCCEEDED', 'FAILED'):
                break
    else:
        print(f"Poll attempt {i+1}: {result.stderr[:200]}")
    time.sleep(5)
