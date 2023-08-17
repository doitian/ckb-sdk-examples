package env

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"net/url"
	"os"
	"os/exec"
	"path"
	"runtime"
	"testing"
	"time"

	"github.com/antelman107/net-wait-go/wait"
	"github.com/joho/godotenv"
	"github.com/nervosnetwork/ckb-sdk-go/v2/collector"
	"github.com/nervosnetwork/ckb-sdk-go/v2/collector/builder"
	"github.com/nervosnetwork/ckb-sdk-go/v2/collector/handler"
	"github.com/nervosnetwork/ckb-sdk-go/v2/rpc"
	"github.com/nervosnetwork/ckb-sdk-go/v2/types"
)

var (
	RootDir string
	Hashes  CKBHashes
)

func init() {
	_, filename, _, ok := runtime.Caller(0)
	if !ok {
		log.Fatal("Failed to get root dir")
	}
	RootDir = path.Dir(path.Dir(filename))

	godotenv.Load(path.Join(RootDir, ".env"))

	content, err := os.ReadFile(path.Join(RootDir, "var", "hashes.json"))
	if err != nil {
		log.Fatal("Error when opening file: ", err)
	}

	err = json.Unmarshal(content, &Hashes)
	if err != nil {
		log.Fatal("Error during Unmarshal(): ", err)
	}
}

func testMainRun(m *testing.M) int {
	ckb := NewCKBProcess()
	defer func() { ckb.Cancel() }()

	if err := ckb.Start(); err != nil {
		log.Fatal("Failed to start ckb: ", err)
	}

	return m.Run()
}

func TestMain(m *testing.M) {
	os.Exit(testMainRun(m))
}

type CKBProcess struct {
	cmd    *exec.Cmd
	ctx    context.Context
	cancel context.CancelFunc
}

func NewCKBProcess() *CKBProcess {
	script := path.Join(RootDir, "bin", "ckb-node.sh")
	ctx, cancel := context.WithCancel(context.Background())
	cmd := exec.CommandContext(ctx, script)
	cmd.Stdin = nil
	cmd.Stdout = os.Stderr
	cmd.Stderr = os.Stderr
	return &CKBProcess{cmd: cmd, ctx: ctx, cancel: cancel}
}

// Dev chain requires a custom builder to register the corrrect cell dep information.
func NewCkbTransactionBuilder(iterator collector.CellIterator) *builder.CkbTransactionBuilder {
	s := builder.SimpleTransactionBuilder{}

	secp256k1Cell := Hashes["ckb_dev"].SystemCells[0]
	secp256k1DepGroup := Hashes["ckb_dev"].DepGroups[0]
	s.Register(&handler.Secp256k1Blake160SighashAllScriptHandler{
		CellDep: &types.CellDep{
			OutPoint: &types.OutPoint{
				TxHash: types.HexToHash(secp256k1DepGroup.TxHash),
				Index:  secp256k1DepGroup.Index,
			},
			DepType: types.DepTypeDepGroup,
		},
		CodeHash: types.HexToHash(secp256k1Cell.TypeHash),
	})

	// There's no open interface to create a builder without a network, so create
	// one for testnet than replace the underlying SimpleTransactionBuilder.
	b := builder.NewCkbTransactionBuilder(types.NetworkTest, iterator)
	b.SimpleTransactionBuilder = s
	return b
}

func (p *CKBProcess) Start() error {
	if err := p.cmd.Start(); err != nil {
		return err
	}

	rawUrl, err := url.Parse(os.Getenv("CKB_RPC_URL"))
	if err != nil {
		return err
	}
	port := rawUrl.Port()
	if port == "" {
		port = "8114"
	}

	if !wait.New().Do([]string{rawUrl.Hostname() + ":" + port}) {
		return fmt.Errorf("rpc is not available")
	}

	ckbClient, err := rpc.Dial(os.Getenv("CKB_RPC_URL"))
	if err != nil {
		return err
	}

	ctx, cancel := context.WithCancelCause(context.Background())

	if err := WaitUntil(ctx, 2*time.Minute, func() bool {
		tip, err := ckbClient.GetIndexerTip(ctx)
		if err != nil {
			cancel(err)
			return false
		}

		return tip != nil
	}); err != nil {
		return err
	}

	return nil
}

func (p *CKBProcess) Cancel() {
	if p.cmd.Cancel != nil {
		p.cmd.Cancel()
	}
	p.cancel()
}

func WaitUntil(ctx context.Context, timeout time.Duration, pred func() bool) error {
	ctx, cancel := context.WithTimeout(ctx, timeout)
	defer cancel()

	for {
		select {
		case <-ctx.Done():
			return context.Cause(ctx)
		default:
			if pred() {
				return nil
			}
			time.Sleep(300 * time.Millisecond)
		}
	}
}

type CKBHashes map[string]CKBHashesNetwork

type CKBHashesNetwork struct {
	SpecHash    string `json:"spec_hash"`
	Genesis     string
	Cellbase    string
	SystemCells []CKBHashesSystemCell `json:"system_cells"`
	DepGroups   []CKBHashesDepGroup   `json:"dep_groups"`
}

type CKBHashesSystemCell struct {
	Path     string
	TxHash   string `json:"tx_hash"`
	DataHash string `json:"data_hash"`
	TypeHash string `json:"type_hash"`
	Index    uint32
}

type CKBHashesDepGroup struct {
	TxHash        string   `json:"tx_hash"`
	IncludedCells []string `json:"included_cells"`
	Index         uint32
}
