import java.io.IOException;
import java.net.InetSocketAddress;
import java.nio.channels.SocketChannel;

import org.junit.jupiter.api.AfterAll;
import org.junit.jupiter.api.BeforeAll;
import org.junit.jupiter.api.Timeout;

import io.github.cdimascio.dotenv.Dotenv;

import org.nervos.ckb.CkbRpcApi;
import org.nervos.ckb.service.Api;

public abstract class Env {
  static Dotenv dotenv = null;
  static Process ckbProcess = null;
  static CkbRpcApi rpc = null;

  static void waitForRPC() throws InterruptedException {
    var address = new InetSocketAddress("127.0.0.1", 8114);
    while (true) {
      try {
        SocketChannel.open(address);
        return;
      } catch (IOException e) {
        Thread.sleep(300);
      }
    }
  }

  static void waitForIndexer(int blockNumber) throws IOException, InterruptedException {
    while (true) {
      var tip = rpc.getIndexerTip();
      if (tip.blockNumber >= blockNumber) {
        return;
      }
      Thread.sleep(300);
    }
  }

  @BeforeAll
  @Timeout(120)
  static void beforeAll() throws IOException, InterruptedException {
    dotenv = Dotenv.load();

    var rpcUrl = dotenv.get("CKB_RPC_URL");
    rpc = new Api(rpcUrl);

    var pb = new ProcessBuilder("bin/ckb-node.sh");
    var env = pb.environment();
    dotenv.entries().forEach(e -> env.put(e.getKey(), e.getValue()));
    pb.inheritIO();
    ckbProcess = pb.start();
    waitForRPC();
    waitForIndexer(0);
  }

  @AfterAll
  @Timeout(120)
  static void afterAll() {
    ckbProcess.destroy();
    try {
      ckbProcess.waitFor();
    } catch (InterruptedException e) {
      e.printStackTrace();
    }
  }
}
