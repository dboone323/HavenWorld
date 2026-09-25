#!/bin/bash
# A1 capacity loop — HavenWorld (Phase: spawn free-tier A1, max2/12)
# Run from anywhere; state is kept inside the repository, never /tmp.
set -u
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
STATE_DIR="$ROOT/logs/local"
mkdir -p "$STATE_DIR"
T=ocid1.tenancy.oc1..aaaaaaaaknewdg47aijyiytgvtuby3mrpilfzt7xasbaknih7dazfmek2yrq
SUB=ocid1.subnet.oc1.us-chicago-1.aaaaaaaavku4wahasovlr6e2tp2nnzimhnbdd3mrhhdlfgkewjrlmaa6gdoa
A2=ocid1.instance.oc1.us-chicago-1.anxxeljrmwdgjgacgeyoaveuyq24fg5uoxlf2oni4pl25u4op25j2wpeifqq
IMG=$(cat "$STATE_DIR/a1_img.txt")
SUCCESS="$STATE_DIR/a1_success.json"
ACTION="$STATE_DIR/a1_action_needed"
LOG="$STATE_DIR/a1_loop.log"
rm -f "$ACTION"
ADs=(RqiG:US-CHICAGO-1-AD-1 RqiG:US-CHICAGO-1-AD-2 RqiG:US-CHICAGO-1-AD-3)
SIZES=("1 6" "1 12" "2 6" "2 12")
attempt=0
a2_gone=0
echo "[$(date '+%F %T')] loop start img=${IMG: -12}" >> "$LOG"
while true; do
  attempt=$((attempt+1))
  for sz in "${SIZES[@]}"; do
    OC=${sz%% *}; MEM=${sz##* }
    for AD in "${ADs[@]}"; do
      if [ -f "$SUCCESS" ]; then echo "[$(date '+%F %T')] success file exists, exiting"; exit 0; fi
      ERRF=$(mktemp)
      OUT=$(oci compute instance launch \
        --availability-domain "$AD" \
        --compartment-id "$T" \
        --shape VM.Standard.A1.Flex \
        --shape-config "{\"ocpus\":\"$OC\",\"memory-in-gbs\":\"$MEM\"}" \
        --image-id "$IMG" \
        --boot-volume-size-in-gbs 50 \
        --subnet-id "$SUB" \
        --assign-public-ip true \
        --display-name "havenworld-a1" \
        --metadata "file://$STATE_DIR/a1_meta.json" \
        --wait-for-state RUNNING --max-wait-seconds 180 2>"$ERRF")
      RC=$?
      if [ $RC -eq 0 ]; then
        printf '%s\n' "$OUT" > "$SUCCESS"
        ID=$(printf '%s' "$OUT" | grep -o 'ocid1\.instance\.[a-z0-9.]*' | head -1)
        echo "[$(date '+%F %T')] SUCCESS $AD $OC/$MEM id=$ID" >> "$LOG"
        rm -f "$ERRF"
        exit 0
      fi
      ERR=$(head -c 800 "$ERRF" | tr '\n' ' ')
      rm -f "$ERRF"
      if printf '%s' "$ERR" | grep -qiE 'OutOfCapacity|out of host capacity'; then
        echo "[$(date '+%F %T')] cap-fail $AD $OC/$MEM" >> "$LOG"
      elif printf '%s' "$ERR" | grep -qiE 'LimitExceeded' && printf '%s' "$ERR" | grep -qiE 'boot|storage|volume'; then
        echo "[$(date '+%F %T')] STORAGE-LIMIT $AD $OC/$MEM err=${ERR:0:250}" >> "$LOG"
        if [ "$a2_gone" -eq 0 ]; then
          echo "[$(date '+%F %T')] terminating stopped A2 to free boot storage (user-approved)" >> "$LOG"
          oci compute instance terminate --instance-id "$A2" --force >> "$LOG" 2>&1
          a2_gone=1
        fi
      elif printf '%s' "$ERR" | grep -qiE 'LimitExceeded'; then
        echo "[$(date '+%F %T')] QUOTA-LIMIT $AD $OC/$MEM err=${ERR:0:300}" >> "$LOG"
        printf 'quota-limit: %s\n' "$ERR" > "$ACTION"
      else
        echo "[$(date '+%F %T')] OTHER-ERR $AD $OC/$MEM err=${ERR:0:300}" >> "$LOG"
        printf 'other-error: %s\n' "$ERR" > "$ACTION"
        sleep 10
      fi
      sleep 3
    done
  done
  echo "[$(date '+%F %T')] pass $attempt done (all cap-fail or err), sleep45" >> "$LOG"
  sleep 45
done
