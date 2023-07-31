package env

import (
	"context"
	"fmt"
	"net/url"
	"os"
	"os/exec"
	"path"
	"runtime"
	"testing"
	"time"

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
	script := path.Join(RootDir, "bin", "ckb-node.sh")
	cmd := exec.Command(script)
	cmd.Stdin = nil
	cmd.Stdout = os.Stderr
	cmd.Stderr = os.Stderr
	return &CKBProcess{cmd: cmd}
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

func (p *CKBProcess) Cancel() error {
	return p.cmd.Cancel()
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
