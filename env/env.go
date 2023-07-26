package env

import (
	"context"
	"fmt"
	"os"
	"os/exec"
	"path"
	"runtime"
	"testing"

	"github.com/antelman107/net-wait-go/wait"
	"github.com/joho/godotenv"
	"github.com/nervosnetwork/ckb-sdk-go/v2/rpc"
)

var RootDir string

func init() {
	_, filename, _, ok := runtime.Caller(0)
	if !ok {
		fmt.Fprintf(os.Stderr, "failed to get root dir")
		os.Exit(1)
	}
	RootDir = path.Dir(path.Dir(filename))

	godotenv.Load(path.Join(RootDir, ".env"))
}

func TestMain(m *testing.M) {
	ckb := NewCKBProcess()
	defer func() { ckb.Cancel() }()

	if err := ckb.Start(); err != nil {
		fmt.Fprintf(os.Stderr, "failed to start ckb: %s", err)
		os.Exit(1)
	}
	os.Exit(m.Run())
}

type CKBProcess struct {
	cmd *exec.Cmd
}

func NewCKBProcess() *CKBProcess {
	return &CKBProcess{
		cmd: exec.Command(path.Join(RootDir, "bin", "ckb-node.sh")),
	}
}

func (p *CKBProcess) Start() error {
	if err := p.cmd.Start(); err != nil {
		return err
	}

	if !wait.New().Do([]string{"127.0.0.1:8114"}) {
		return fmt.Errorf("rpc is not available")
	}

	ckbClient, err := rpc.Dial(os.Getenv("CKB_RPC_URL"))
	if err != nil {
		return err
	}

	tip, err := ckbClient.GetTipBlockNumber(context.Background())
	if err != nil {
		return err
	}

	fmt.Printf("Tip Number: %d\n", tip)

	return nil
}

func (p *CKBProcess) Cancel() error {
	return p.cmd.Cancel()
}
