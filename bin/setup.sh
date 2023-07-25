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

echo_section "Install CKB"
if ! type -f ckb &>/dev/null; then
    echo "ckb: installing version ckb ${CKB_VERSION}"
    pushd "$ROOT_DIR" &>/dev/null
    curl -LO "https://github.com/nervosnetwork/ckb/releases/download/${CKB_VERSION}/ckb_${CKB_VERSION}_${CKB_PACKAGE}"
    unar "ckb_${CKB_VERSION}_${CKB_PACKAGE}"
    rm -f "ckb_${CKB_VERSION}_${CKB_PACKAGE}"
    ln -snf "../ckb_${CKB_VERSION}_${CKB_PACKAGE%%.*}/ckb" bin/ckb
    ln -snf "../ckb_${CKB_VERSION}_${CKB_PACKAGE%%.*}/ckb-cli" bin/ckb-cli
    popd &>/dev/null
fi
echo_result path "$(which ckb)"
echo_result version "$(ckb --version)"

echo_section "Initialze CKB"
pushd "$ROOT_DIR" &>/dev/null
if ! [ -f var/miner-account.yaml ]; then
    mkdir -p var
    echo "Generate miner account"
    ckb-cli account new </dev/null >var/miner-account.yaml 2>/dev/null
fi
MINER_LOCK_ARG="$(sed -n -e 's/lock_arg: //p' var/miner-account.yaml)"
echo_result miner_lock_arg "$MINER_LOCK_ARG"
rm -f var/miner-account.key
ckb-cli account export --lock-arg "$MINER_LOCK_ARG" --extended-privkey-path var/miner-account.key < /dev/null
popd &>/dev/null
