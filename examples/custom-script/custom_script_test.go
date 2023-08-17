package custom_script

import (
	"context"
	"log"
	"os"
	"testing"

	"github.com/ethereum/go-ethereum/common"
	"github.com/nervosnetwork/ckb-sdk-go/v2/address"
	"github.com/nervosnetwork/ckb-sdk-go/v2/collector"
	"github.com/nervosnetwork/ckb-sdk-go/v2/rpc"
	"github.com/nervosnetwork/ckb-sdk-go/v2/transaction/signer"
	"github.com/nervosnetwork/ckb-sdk-go/v2/types"

	"ckb-sdk-examples/env"
)

func TestMain(m *testing.M) {
	env.TestMain(m)
}

// The `github.com/nervosnetwork/ckb-sdk-go/v2/systemscript` supports only the
// mainnet and testnet systemscripts. In other environments, we must create the
// script ourselves.
func secp256k1LockScript(args string) *types.Script {
	cell := env.Hashes["ckb_dev"].SystemCells[0]
	return &types.Script{
		CodeHash: types.HexToHash(cell.TypeHash),
		HashType: types.HashTypeType,
		Args:     common.FromHex(args),
	}
}

func customLockScript(args string) *types.Script {
	cell := env.Hashes["ckb_dev"].SystemCells[4]
	return &types.Script{
		CodeHash: types.HexToHash(cell.TypeHash),
		HashType: types.HashTypeType,
		Args:     common.FromHex(args),
	}
}

func scriptToAddress(script *types.Script) string {
	addr := &address.Address{Script: script, Network: types.NetworkTest}
	encoded, err := addr.Encode()
	if err != nil {
		log.Fatal("Failed to encode the script as an address ", err)
	}
	return encoded
}

type testingContext struct {
	rpc     rpc.Client
	ctx     context.Context
	t       *testing.T
	network types.Network
}

func newTestingContext(t *testing.T) testingContext {
	client, err := rpc.Dial(os.Getenv("CKB_RPC_URL"))
	if err != nil {
		t.Fatal("Fail to connect RPC ", err)
	}
	return testingContext{
		rpc:     client,
		ctx:     context.Background(),
		t:       t,
		network: types.NetworkTest,
	}
}

func (tc testingContext) fillAddress(receiver string, capacity uint64) *types.Hash {
	miner := scriptToAddress(secp256k1LockScript(os.Getenv("MINER_LOCK_ARG")))
	iterator, err := collector.NewLiveCellIteratorFromAddress(tc.rpc, miner)
	if err != nil {
		tc.t.Fatal("Fail to create live cell iterator ", err)
	}

	builder := env.NewCkbTransactionBuilder(iterator)
	builder.FeeRate = 1000
	if err := builder.AddOutputByAddress(receiver, capacity); err != nil {
		tc.t.Fatal("Fail to add output ", err)
	}
	builder.AddChangeOutputByAddress(miner)
	txWithGroups, err := builder.Build()
	if err != nil {
		tc.t.Fatal("Fail to build transaction ", err)
	}

	// Sign transaction. It's OK to use the default signers for testnet, since
	// the type hashes of the system scripts are identical in dev chain.
	txSigner := signer.GetTransactionSignerInstance(tc.network)
	_, err = txSigner.SignTransactionByPrivateKeys(txWithGroups, os.Getenv("MINER_PRIVATE_KEY"))
	if err != nil {
		tc.t.Fatal("Fail to sign transaction ", err)
	}

	// send transaction
	hash, err := tc.rpc.SendTransaction(tc.ctx, txWithGroups.TxView)
	if err != nil {
		tc.t.Fatal("Fail to send transaction ", err)
	}
	return hash
}

func TestCustomScript(t *testing.T) {
	tc := newTestingContext(t)
	customLock := customLockScript("0x")
	customAddr := scriptToAddress(customLock)

	// Fill 1000 CKB
	tc.fillAddress(customAddr, 100000000000)
}
