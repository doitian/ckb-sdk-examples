#!/bin/bash
set -eu

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" >/dev/null 2>&1 && cd .. && pwd)"
CKB_VERSION="$(sed -n 's/ckb: //p' "$ROOT_DIR/versions.yaml")"
CKB_PACKAGE="${CKB_PACKAGE:=x86_64-unknown-linux-gnu.tar.gz}"
export PATH="$PATH:$ROOT_DIR/bin"

function unar() {
  case "$1" in
  *.tar.gz) tar -xzf "$1" ;;
  *)
    echo "don't know how to extract '$1'..."
    exit 1
    ;;
  esac
}

function echo_section() {
  echo
  echo "======================================================================"
  echo "$@"
  echo "======================================================================"
  echo
}

function echo_result() {
  local result_name="$1"
  shift
  echo "==> ${result_name}: $*"
}

function generate_account() {
  local name="$1"
  local yaml_file="$ROOT_DIR/var/${name}-account.yaml"
  local key_file="$ROOT_DIR/var/${name}-account.key"
  mkdir -p "$(dirname "$yaml_file")"
  if ! [ -f "$yaml_file" ]; then
    ckb-cli account new </dev/null >"$yaml_file" 2>/dev/null
    rm -f "$key_file"
  fi
  local lock_arg="$(sed -n -e 's/lock_arg: //p' "$yaml_file")"
  if ! [ -f "$key_file" ]; then
    ckb-cli account export --lock-arg "$lock_arg" --extended-privkey-path "$key_file" </dev/null &>/dev/null
  fi
  echo "$lock_arg"
}

echo_section "Install CKB"
if ! type -f ckb &>/dev/null; then
  echo "ckb: installing version ckb ${CKB_VERSION}"
  pushd "$ROOT_DIR" &>/dev/null
  curl -fSLO "https://github.com/nervosnetwork/ckb/releases/download/${CKB_VERSION}/ckb_${CKB_VERSION}_${CKB_PACKAGE}"
  unar "ckb_${CKB_VERSION}_${CKB_PACKAGE}"
  rm -f "ckb_${CKB_VERSION}_${CKB_PACKAGE}"
  ln -snf "../ckb_${CKB_VERSION}_${CKB_PACKAGE%%.*}/ckb" bin/ckb
  ln -snf "../ckb_${CKB_VERSION}_${CKB_PACKAGE%%.*}/ckb-cli" bin/ckb-cli
  popd &>/dev/null
fi
echo_result path "$(which ckb)"
echo_result version "$(ckb --version)"

echo_section "Generate Accounts"
MINER_LOCK_ARG="$(generate_account miner)"
echo_result miner_lock_arg "$MINER_LOCK_ARG"
ALICE_LOCK_ARG="$(generate_account alice)"
echo_result alice_lock_arg "$ALICE_LOCK_ARG"
BOB_LOCK_ARG="$(generate_account bob)"
echo_result bob_lock_arg "$BOB_LOCK_ARG"

echo_section "Generate .env"
echo "MINER_LOCK_ARG=$MINER_LOCK_ARG" >.env
echo "MINER_PRIVATE_KEY=0x$(head -1 "$ROOT_DIR/var/miner-account.key")" >>.env
echo "ALICE_LOCK_ARG=$ALICE_LOCK_ARG" >>.env
echo "ALICE_PRIVATE_KEY=0x$(head -1 "$ROOT_DIR/var/alice-account.key")" >>.env
echo "BOB_LOCK_ARG=$BOB_LOCK_ARG" >>.env
echo "BOB_PRIVATE_KEY=0x$(head -1 "$ROOT_DIR/var/bob-account.key")" >>.env
echo 'CKB_RPC_URL="http://127.0.0.1:8114"' >>.env
echo_result .env "$ROOT_DIR/.env"

echo_section "Download Contracts"
if ! [ -f "$ROOT_DIR/run/ckb-sdk-examples-capacity-diff" ]; then
  curl -fsSLo "$ROOT_DIR/run/ckb-sdk-examples-capacity-diff" \
    "https://github.com/doitian/ckb-sdk-examples-capacity-diff/releases/download/202308151054/ckb-sdk-examples-capacity-diff"
fi

echo_section "List Hashes"
ckb-node.sh --init-only
ckb list-hashes -C "$ROOT_DIR/run/ckb-dir" -f json >"$ROOT_DIR/var/hashes.json"
echo_result hashes "$ROOT_DIR/var/hashes.json"
