package custom_script

import (
	"context"
	"encoding/binary"
	"fmt"
	"log"
	"os"
	"reflect"
	"testing"

	"github.com/ethereum/go-ethereum/common"
	"github.com/nervosnetwork/ckb-sdk-go/v2/address"
	"github.com/nervosnetwork/ckb-sdk-go/v2/collector"
	"github.com/nervosnetwork/ckb-sdk-go/v2/collector/builder"
	"github.com/nervosnetwork/ckb-sdk-go/v2/rpc"
	"github.com/nervosnetwork/ckb-sdk-go/v2/transaction"
	"github.com/nervosnetwork/ckb-sdk-go/v2/transaction/signer"
	"github.com/nervosnetwork/ckb-sdk-go/v2/types"

	"ckb-sdk-examples/env"
)

func TestMain(m *testing.M) {
	env.TestMain(m)
}

type CapacityDiffContext struct {
	rpc rpc.Client
	ctx context.Context
}

func (ctx CapacityDiffContext) getInputCell(outPoint *types.OutPoint) (*types.CellOutput, error) {
	cellWithStatus, err := ctx.rpc.GetLiveCell(ctx.ctx, outPoint, false)
	if err != nil {
		return nil, err
	}

	return cellWithStatus.Cell.Output, nil
}

type CapacityDiffScriptHandler struct {
	CellDep  *types.CellDep
	CodeHash types.Hash
}

func (r *CapacityDiffScriptHandler) isMatched(script *types.Script) bool {
	if script == nil {
		return false
	}
	return reflect.DeepEqual(script.CodeHash, r.CodeHash)
}

// The script handler will be called for each group and each context passed to
// `CkbTransactionBuilder.Build()`. Be calfully on when to run the logic for
// the script.
//
// It often does two things:
// - Fill witness placeholder to make fee calculation correct.
// - Add cell dep for the script.
func (r *CapacityDiffScriptHandler) BuildTransaction(builder collector.TransactionBuilder, group *transaction.ScriptGroup, context interface{}) (bool, error) {
	if group == nil || !r.isMatched(group.Script) {
		return false, nil
	}
	index := group.InputIndices[0]
	// set the witness placeholder
	lock := [8]byte{}
	if err := builder.SetWitness(uint(index), types.WitnessTypeLock, lock[:]); err != nil {
		return false, err
	}
	// CkbTransactionBuilder.AddCellDep will remove duplications automatically.
	builder.AddCellDep(r.CellDep)
	return true, nil
}

type CapacityDiffScriptSigner struct{}

// The CapacityDiffContext serves two purposes: first, as a flag for the script
// signer to work on the transaction, and second, to aid in retrieving input
// cell fields. While CkbTransactionBuilder has stored the input cell, it does
// not offers interfaces to access them.
func (s *CapacityDiffScriptSigner) SignTransaction(tx *types.Transaction, group *transaction.ScriptGroup, ctx *transaction.Context) (bool, error) {
	scriptContext, ok := ctx.Payload.(CapacityDiffContext)
	if !ok {
		return false, nil
	}

	total := int64(0)
	for _, i := range group.InputIndices {
		inputCell, err := scriptContext.getInputCell(tx.Inputs[i].PreviousOutput)
		if err != nil {
			return false, nil
		}
		total -= int64(inputCell.Capacity)
	}
	for _, output := range tx.Outputs {
		if reflect.DeepEqual(output.Lock, group.Script) {
			total += int64(output.Capacity)
		}
	}

	// The specification https://go.dev/ref/spec#Numeric_types says integres in
	// Go are repsented using two's complementation. So we can just cast it to
	// uin64 and get the little endian bytes.
	witness := make([]byte, 8)
	binary.LittleEndian.PutUint64(witness, uint64(total))

	witnessIndex := group.InputIndices[0]
	witnessArgs, err := types.DeserializeWitnessArgs(tx.Witnesses[witnessIndex])
	if err != nil {
		return false, err
	}
	witnessArgs.Lock = witness
	tx.Witnesses[witnessIndex] = witnessArgs.Serialize()

	return true, nil
}

// New script should register the script handler in builder
func NewCkbTransactionBuilder(iterator collector.CellIterator) *builder.CkbTransactionBuilder {
	b := env.NewCkbTransactionBuilder(iterator)

	capacityDiffCell := env.Hashes["ckb_dev"].SystemCells[4]
	b.Register(&CapacityDiffScriptHandler{
		CellDep: &types.CellDep{
			OutPoint: &types.OutPoint{
				TxHash: types.HexToHash(capacityDiffCell.TxHash),
				Index:  capacityDiffCell.Index,
			},
			DepType: types.DepTypeCode,
		},
		CodeHash: types.HexToHash(capacityDiffCell.TypeHash),
	})

	return b
}

func TestCustomScript(t *testing.T) {
	tc := newTestingContext(t)
	customLock := customLockScript("0x")
	customAddr := scriptToAddress(customLock)

	// Fill 1000 CKB
	txHash := tc.fillAddress(customAddr, 100000000000)
	if err := env.MineUntilCommitted(tc.ctx, tc.rpc, *txHash, 3); err != nil {
		t.Fatal("Fail to commit tx ", err)
	}

	miner := scriptToAddress(secp256k1LockScript(os.Getenv("MINER_LOCK_ARG")))
	iterator, err := collector.NewLiveCellIteratorFromAddress(tc.rpc, customAddr)
	if err != nil {
		t.Fatal("Fail to create live cell iterator ", err)
	}

	// Use a builder which has registered the script handler CapacityDiffScriptHandler
	builder := NewCkbTransactionBuilder(iterator)
	builder.FeeRate = 1000
	if err := builder.AddOutputByAddress(miner, 50000000000); err != nil {
		t.Fatal("Fail to add output ", err)
	}
	builder.AddChangeOutputByAddress(customAddr)
	txWithGroups, err := builder.Build()
	if err != nil {
		t.Fatal("Fail to build transaction ", err)
	}

	// Sign transaction. It's OK to use the default signers for testnet, since
	// the type hashes of the system scripts are identical in dev chain.
	txSigner := signer.GetTransactionSignerInstance(tc.network)
	txSigner.RegisterLockSigner(
		types.HexToHash(env.Hashes["ckb_dev"].SystemCells[4].TypeHash),
		&CapacityDiffScriptSigner{},
	)
	_, err = txSigner.SignTransaction(txWithGroups, &transaction.Context{Key: nil, Payload: CapacityDiffContext{
		rpc: tc.rpc,
		ctx: tc.ctx,
	}})
	if err != nil {
		t.Fatal("Fail to sign transaction ", err)
	}

	// send transaction
	hash, err := tc.rpc.SendTransaction(tc.ctx, txWithGroups.TxView)
	if err != nil {
		t.Fatal("Fail to send transaction ", err)
	}
	fmt.Println(hash)
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

func (t testingContext) fillAddress(receiver string, capacity uint64) *types.Hash {
	miner := scriptToAddress(secp256k1LockScript(os.Getenv("MINER_LOCK_ARG")))
	iterator, err := collector.NewLiveCellIteratorFromAddress(t.rpc, miner)
	if err != nil {
		t.Fatal("Fail to create live cell iterator ", err)
	}

	builder := env.NewCkbTransactionBuilder(iterator)
	builder.FeeRate = 1000
	if err := builder.AddOutputByAddress(receiver, capacity); err != nil {
		t.Fatal("Fail to add output ", err)
	}
	builder.AddChangeOutputByAddress(miner)
	txWithGroups, err := builder.Build()
	if err != nil {
		t.Fatal("Fail to build transaction ", err)
	}

	// Sign transaction. It's OK to use the default signers for testnet, since
	// the type hashes of the system scripts are identical in dev chain.
	txSigner := signer.GetTransactionSignerInstance(t.network)
	_, err = txSigner.SignTransactionByPrivateKeys(txWithGroups, os.Getenv("MINER_PRIVATE_KEY"))
	if err != nil {
		t.Fatal("Fail to sign transaction ", err)
	}

	// send transaction
	hash, err := t.rpc.SendTransaction(t.ctx, txWithGroups.TxView)
	if err != nil {
		t.Fatal("Fail to send transaction ", err)
	}
	return hash
}

type testingContext struct {
	*testing.T
	rpc     rpc.Client
	ctx     context.Context
	network types.Network
}

func newTestingContext(t *testing.T) testingContext {
	client, err := rpc.Dial(os.Getenv("CKB_RPC_URL"))
	if err != nil {
		t.Fatal("Fail to connect RPC ", err)
	}
	return testingContext{
		T:       t,
		rpc:     client,
		ctx:     context.Background(),
		network: types.NetworkTest,
	}
}
