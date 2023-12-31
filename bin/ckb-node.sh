#!/bin/bash

set -eu

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" >/dev/null 2>&1 && cd .. && pwd)"
CKB_DIR="$ROOT_DIR/run/ckb-dir"
export PATH="$PATH:$ROOT_DIR/bin"

function sed_i() {
  if [[ "$OSTYPE" == "darwin"* ]]; then
    sed -i '' "$@"
  else
    sed -i "$@"
  fi
}

function kill_and_wait() {
  local pid="$1"
  local -i interval=1
  kill "$pid" &>/dev/null || return 0
  while kill -0 "$pid" &>/dev/null; do
    sleep "$interval"
    interval=interval+interval
    if ((interval > 10)); then
      echo "cannot kill ckb process $pid" >&2
      exit 1
    fi
  done
}

if [ -f "$ROOT_DIR/run/ckb.pid" ]; then
  CKB_PID="$(cat "$ROOT_DIR/run/ckb.pid")"
  if kill -0 "$CKB_PID" &>/dev/null; then
    echo "Kill existing ckb process $CKB_PID"
    kill_and_wait "$CKB_PID"
  fi
  rm -f "$ROOT_DIR/run/ckb.pid"
fi
rm -rf "$CKB_DIR"

MINER_LOCK_ARG="$(sed -n -e 's/lock_arg: //p' "$ROOT_DIR/var/miner-account.yaml")"
echo "Initialize ckb in $CKB_DIR"
ckb init -C "$CKB_DIR" --chain dev --ba-arg $MINER_LOCK_ARG --ba-message "0x" --genesis-message "ckb-sdk-examples" --force
mkdir -p "$CKB_DIR/specs/cells"
ln -snf "$ROOT_DIR/run/ckb-sdk-examples-capacity-diff" "$CKB_DIR/specs/cells/"

sed_i 's/value = 5000/value = 1000/' "$CKB_DIR/ckb-miner.toml"

sed_i 's/genesis_epoch_length = 1000/genesis_epoch_length = 10/' "$CKB_DIR/specs/dev.toml"
if ! grep -q max_block_bytes "$CKB_DIR/specs/dev.toml"; then
  sed_i '/\[params\]/a\
max_block_bytes = 100_000_000\
' "$CKB_DIR/specs/dev.toml"
fi
sed_i "s/0xc8328aabcd9b9e8e64fbc566c4385c3bdeb219d7/$MINER_LOCK_ARG/" "$CKB_DIR/specs/dev.toml"
sed_i "s/0x470dcdc5e44064909650113a274b3b36aecb6dc7/$MINER_LOCK_ARG/" "$CKB_DIR/specs/dev.toml"

sed_i 's/"Debug"\]/"Debug", "Indexer", "IntegrationTest"]/' "$CKB_DIR/ckb.toml"
if [ -n "${DEBUG:-}" ]; then
  sed_i 's/filter = "info"/filter = "debug"/' "$CKB_DIR/ckb.toml"
fi

# deploy another copy of secp256k1
sed_i '/\[genesis\.system_cells_lock\]/c\
[[genesis.system_cells]]\
file = { file = "cells/ckb-sdk-examples-capacity-diff" }\
create_type_id = true\
capacity = 100_000_0000_0000\
\
[genesis.system_cells_lock]\
' "$CKB_DIR/specs/dev.toml"

cd "$CKB_DIR"
CKB_PID="$$"

if [ "${1:-}" != "--init-only" ]; then
  echo "$CKB_PID" >"$ROOT_DIR/run/ckb.pid"
  exec ckb run
fi
