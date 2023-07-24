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

function sed_i() {
    if [[ "$OSTYPE" == "darwin"* ]]; then
        sed -i '' "$@"
    else
        sed -i "$@"
    fi
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
if ! [ -f devnet/miner-account.yaml ]; then
    mkdir -p devnet
    echo "Generate miner account for devnet"
    ckb-cli account new </dev/null >devnet/miner-account.yaml 2>/dev/null
fi
MINER_LOCK_ARG="$(sed -n -e 's/lock_arg: //p' devnet/miner-account.yaml)"
echo_result miner_lock_arg "$MINER_LOCK_ARG"
if ! [ -f devnet/ckb.toml ]; then
    echo "Initialize devnet"
    ckb init -C devnet --chain dev --ba-arg $MINER_LOCK_ARG --ba-message "0x" --force
fi

sed_i 's/value = 5000/value = 1000/' devnet/ckb-miner.toml
# Reduce epoch length to 10 blocks.
sed_i 's/genesis_epoch_length = 1000/genesis_epoch_length = 10/' devnet/specs/dev.toml
if ! grep -q max_block_bytes devnet/specs/dev.toml; then
    sed_i '/\[params\]/a\
max_block_bytes = 100_000_000' devnet/specs/dev.toml
fi

# Enable the indexer.
sed_i 's/"Debug"\]/"Debug", "Indexer", "IntegrationTest"]/' devnet/ckb.toml
sed_i 's/filter = "info"/filter = "debug"/' devnet/ckb.toml

CKB_DIR="$ROOT_DIR/devnet"
echo_result ckb_dir "$ROOT_DIR/devnet"

popd &>/dev/null
