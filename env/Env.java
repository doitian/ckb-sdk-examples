import java.io.IOException;
import java.net.InetSocketAddress;
import java.nio.channels.SocketChannel;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.Collections;
import java.util.List;

import org.junit.jupiter.api.AfterAll;
import org.junit.jupiter.api.BeforeAll;
import org.junit.jupiter.api.Timeout;
import org.nervos.ckb.CkbRpcApi;
import org.nervos.ckb.Network;
import org.nervos.ckb.service.Api;
import org.nervos.ckb.sign.TransactionSigner;
import org.nervos.ckb.sign.signer.Secp256k1Blake160SighashAllSigner;
import org.nervos.ckb.transaction.TransactionBuilderConfiguration;
import org.nervos.ckb.transaction.handler.Secp256k1Blake160SighashAllScriptHandler;
import org.nervos.ckb.type.CellDep;
import org.nervos.ckb.type.Script;
import org.nervos.ckb.type.TransactionWithStatus;
import org.nervos.ckb.utils.Numeric;
import org.nervos.ckb.utils.address.Address;
import org.nervos.indexer.CkbIndexerApi;
import org.nervos.indexer.DefaultIndexerApi;

import com.alibaba.fastjson.JSON;
import com.alibaba.fastjson.JSONObject;

import io.github.cdimascio.dotenv.Dotenv;

public abstract class Env {
  static Dotenv dotenv = null;
  static Process ckbProcess = null;
  static CkbRpcApi rpc = null;
  static CkbIndexerApi indexer = null;
  static TransactionBuilderConfiguration devBuilderConfiguration = new TransactionBuilderConfiguration();
  static TransactionSigner devSigner = new TransactionSigner();
  static JSONObject devHashes = null;

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

  static void waitForIndexer(long blockNumber) throws IOException, InterruptedException {
    while (true) {
      var tip = rpc.getIndexerTip();
      if (tip.blockNumber >= blockNumber) {
        return;
      }
      Thread.sleep(300);
    }
  }

  static void mine(int count) throws IOException, InterruptedException {
    // Api does not expose the method to call generate_block, use batchRPC as a
    // workaround.
    var expectedTip = rpc.getTipBlockNumber() + count;
    @SuppressWarnings("rawtypes")
    List generateBlock = List.of((Object) "generate_block");
    var batchRequest = List.of(generateBlock);
    // - `generate_block` does not always create a new block
    // - Send multiple `generate_block` in a batch is two fast that tx pool has no
    // chance to refresh.
    while (count > 0) {
      var tipHash = Numeric.toHexString(rpc.getBlockHash(rpc.getTipBlockNumber()));
      var resp = rpc.batchRPC(batchRequest).get(0);
      if (resp.error == null && !resp.result.equals(tipHash)) {
        count -= 1;
      }
    }

    waitForIndexer(expectedTip);
  }

  static void mineToCommitted(byte[] txHash, int step) throws IOException, InterruptedException {
    do {
      mine(step);
    } while (rpc.getTransaction(txHash).txStatus.status != TransactionWithStatus.Status.COMMITTED);
  }

  static void readDevHashes() throws IOException {
    devHashes = JSON.parseObject(Files.readString(Path.of(System.getProperty("user.dir"), "var", "hashes.json")))
        .getJSONObject("ckb_dev");
  }

  static void registerDevBuilderHandlers(TransactionBuilderConfiguration configuration) {
    var systemCells = devHashes.getJSONArray("system_cells");
    var depGroups = devHashes.getJSONArray("dep_groups");

    var secp256k1 = new Secp256k1Blake160SighashAllScriptHandler();
    secp256k1.setCodeHash(Numeric.hexStringToByteArray(systemCells.getJSONObject(0).getString("type_hash")));
    var secp256k1DepGroupConfig = depGroups.getJSONObject(0);
    secp256k1.setCellDeps(List.of(new CellDep(
        Numeric.hexStringToByteArray(secp256k1DepGroupConfig.getString("tx_hash")),
        secp256k1DepGroupConfig.getIntValue("index"),
        CellDep.DepType.DEP_GROUP)));
    configuration.registerScriptHandler(secp256k1);
  }

  static void registerDevSigners(TransactionSigner signer) {
    signer.registerLockScriptSigner(
        Script.SECP256K1_BLAKE160_SIGNHASH_ALL_CODE_HASH, new Secp256k1Blake160SighashAllSigner());
  }

  static byte[] lockArg(String name) {
    return Numeric.hexStringToByteArray(dotenv.get(name.toUpperCase() + "_LOCK_ARG"));
  }

  static String privateKey(String name) {
    return dotenv.get(name.toUpperCase() + "_PRIVATE_KEY");
  }

  static Address secp256k1Address(String name) {
    var lockArg = lockArg(name);
    var script = new Script(Script.SECP256K1_BLAKE160_SIGNHASH_ALL_CODE_HASH, lockArg, Script.HashType.TYPE);
    return new Address(script, Network.TESTNET);
  }

  @BeforeAll
  @Timeout(120)
  static void beforeAll() throws IOException, InterruptedException {
    dotenv = Dotenv.load();

    readDevHashes();
    registerDevBuilderHandlers(devBuilderConfiguration);
    registerDevSigners(devSigner);

    var rpcUrl = dotenv.get("CKB_RPC_URL");
    rpc = new Api(rpcUrl);
    indexer = new DefaultIndexerApi(rpcUrl, false);

    var pb = new ProcessBuilder("bin/ckb-node.sh");
    var env = pb.environment();
    dotenv.entries().forEach(e -> env.put(e.getKey(), e.getValue()));
    pb.inheritIO();
    ckbProcess = pb.start();
    waitForRPC();
    waitForIndexer(0);
  }

  @AfterAll
  @Timeout(15)
  static void afterAll() {
    ckbProcess.destroyForcibly();
    try {
      ckbProcess.waitFor();
    } catch (InterruptedException e) {
      e.printStackTrace();
    }
  }
}
