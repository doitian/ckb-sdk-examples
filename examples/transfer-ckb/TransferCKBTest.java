import static org.junit.jupiter.api.Assertions.assertDoesNotThrow;
import static org.nervos.ckb.utils.Numeric.toHexString;

import java.io.IOException;

import org.junit.jupiter.api.Test;
import org.nervos.ckb.transaction.CkbTransactionBuilder;
import org.nervos.indexer.InputIterator;

class TransferCKBTest extends Env {
  @Test
  void transfer() throws IOException {
    var sender = secp256k1Address("MINER").encode();
    var receiver = secp256k1Address("ALICE").encode();
    var iterator = new InputIterator(indexer).addSearchKey(sender);
    devBuilderConfiguration.setFeeRate(1000);
    var txWithScriptGroups = new CkbTransactionBuilder(devBuilderConfiguration, iterator)
        .addOutput(receiver, 50100000000L)
        .setChangeOutput(sender)
        .build();

    // 1. Sign transaction with your private key
    devSigner.signTransaction(txWithScriptGroups, privateKey("MINER"));
    // 2. Send transaction to CKB node
    var txHash = assertDoesNotThrow(() -> rpc.sendTransaction(txWithScriptGroups.txView), "Send Transaction");
    System.out.println(toHexString(txHash));
  }
}
