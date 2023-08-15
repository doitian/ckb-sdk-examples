import static org.junit.jupiter.api.Assertions.assertDoesNotThrow;

import java.io.IOException;
import java.util.Arrays;
import java.util.Iterator;
import java.util.List;

import org.junit.jupiter.api.BeforeAll;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.Timeout;
import org.nervos.ckb.Network;
import org.nervos.ckb.crypto.secp256k1.ECKeyPair;
import org.nervos.ckb.sign.Context;
import org.nervos.ckb.sign.ScriptGroup;
import org.nervos.ckb.sign.ScriptSigner;
import org.nervos.ckb.transaction.AbstractTransactionBuilder;
import org.nervos.ckb.transaction.CkbTransactionBuilder;
import org.nervos.ckb.transaction.TransactionBuilderConfiguration;
import org.nervos.ckb.transaction.handler.ScriptHandler;
import org.nervos.ckb.type.CellDep;
import org.nervos.ckb.type.Script;
import org.nervos.ckb.type.Transaction;
import org.nervos.ckb.type.TransactionInput;
import org.nervos.ckb.type.WitnessArgs;
import org.nervos.ckb.utils.Numeric;
import org.nervos.ckb.utils.address.Address;
import org.nervos.indexer.InputIterator;

class CustomScriptTest extends Env {
  /**
   * The context for the CapacityDiff signer to get the input cell fields.
   */
  interface CapacityDiffContext {
    TransactionInput getInputDetail(int index);
  }

  static class InputDetailsCkbTransactionBuilder extends CkbTransactionBuilder implements CapacityDiffContext {
    public InputDetailsCkbTransactionBuilder(TransactionBuilderConfiguration configuration,
        Iterator<TransactionInput> availableInputs) {
      super(configuration, availableInputs);
    }

    public TransactionInput getInputDetail(int index) {
      return inputsDetail.get(index);
    }

    public Context context() {
      // Not all signers need an EC key pair.
      return new Context((ECKeyPair) null, this);
    }
  }

  /**
   * An example script handler for the contract capacity-diff
   *
   * @see https://github.com/doitian/ckb-sdk-examples-capacity-diff
   */
  static class CapacityDiffScriptHandler implements ScriptHandler {
    private List<CellDep> cellDeps;
    private byte[] codeHash;

    public void setCellDeps(List<CellDep> cellDeps) {
      this.cellDeps = cellDeps;
    }

    public void setCodeHash(byte[] codeHash) {
      this.codeHash = codeHash;
    }

    private boolean shouldBuild(ScriptGroup scriptGroup) {
      if (scriptGroup == null) {
        return false;
      }
      return Arrays.equals(scriptGroup.getScript().codeHash, codeHash);
    }

    /**
     * Callback to build the transaction.
     *
     * Builder will call this functions for every registered handler.
     *
     * @see AbstractTransactionBuilder#build(Object...)
     * @param context This function is called once for each context passed into
     *                AbstractTransactionBuilder#build(Object... contexts).
     * @return bool returns true when this handler has changed the transaction.
     */
    @Override
    public boolean buildTransaction(AbstractTransactionBuilder txBuilder, ScriptGroup scriptGroup, Object context) {
      // Only change the transaction when the script is used.
      if (!shouldBuild(scriptGroup)) {
        return false;
      }

      // Add celldeps
      txBuilder.addCellDeps(cellDeps);

      // It's important to fill the placeholder first, otherwise the fee calculation
      // will be wrong.
      int witnessIndex = scriptGroup.getInputIndices().get(0);
      byte[] dummyWitness = new byte[8];
      txBuilder.setWitness(witnessIndex, WitnessArgs.Type.LOCK, dummyWitness);

      return true;
    }

    @Override
    public void init(Network network) {
      // init is called when the handler is registered

      // For example it can pre-fill cellDeps and codeHash for different networks.
      // Since I'm going to set them manually, so I just leave this function empty.
    }
  }

  /**
   * An example script signer for the contract capacity-diff
   *
   * - The script loads the witness for the first input in the script group using
   * the WitnessArgs layout.
   * - The total input capacity is the sum of all the input cells in the script
   * group.
   * - The total output capacity is the sum of all the output cells having the
   * same lock script as the script group.
   * - The capacity difference is a 64-bit signed integer which equals to total
   * output capacity minus total input capacity.
   * - The witness is encoded using two's complement and little endian.
   *
   * @see https://github.com/doitian/ckb-sdk-examples-capacity-diff
   */
  static class CapacityDiffScriptSigner implements ScriptSigner {
    /**
     * Sign the transaction.
     *
     * @param Context context Users pass contexts via
     *                org.nervos.ckb.sign.TransactionSigner#signTransaction. The
     *                script signer is called once for each context. It's a good
     *                practice to use a unique context to ensure the function runs
     *                only once. Also, the context is useful to fetch extra
     *                information to complete the transaction.
     * 
     * @return bool returns true when the signer has changed the transaction.
     */
    @Override
    public boolean signTransaction(Transaction transaction, ScriptGroup scriptGroup, Context context) {
      if (!(context.getPayload() instanceof CapacityDiffContext)) {
        return false;
      }
      // Obtaining input details through a custom builder and context can be
      // challenging as this information is not readily accessible to the signer. It
      // is unfortunate that the offline script handler has weaker capabilities
      // compared to the online contract, given that the contract can obtain input
      // cell and dep headers through syscalls.
      final var thisContext = (CapacityDiffContext) context.getPayload();
      final var thisScript = scriptGroup.getScript();

      final var witnessIndex = scriptGroup.getInputIndices().get(0);
      final var witnessArgs = WitnessArgs.unpack(transaction.witnesses.get(witnessIndex));
      final var inputCapacity = scriptGroup.getInputIndices().stream()
          .mapToLong(i -> thisContext.getInputDetail(i).output.capacity).sum();
      final var outputCapacity = transaction.outputs.stream().filter(o -> o.lock.equals(thisScript))
          .mapToLong(o -> o.capacity).sum();
      final var diff = outputCapacity - inputCapacity;
      // **Attention**: nagative integer packing is only available since CKB Java SDK
      // 2.1.1
      witnessArgs.setLock(Numeric.hexStringToByteArray(Numeric.littleEndian(diff)));
      transaction.witnesses.set(witnessIndex, witnessArgs.pack().toByteArray());

      return false;
    }
  }

  @BeforeAll
  @Timeout(120)
  static void setupCustomScript() throws InterruptedException {
    var systemCells = devHashes.getJSONArray("system_cells");
    var cell = systemCells.getJSONObject(4);
    var typeHash = Numeric.hexStringToByteArray(cell.getString("type_hash"));

    var handler = new CapacityDiffScriptHandler();
    handler.setCodeHash(typeHash);
    handler.setCellDeps(List.of(new CellDep(
        Numeric.hexStringToByteArray(cell.getString("tx_hash")),
        cell.getIntValue("index"),
        CellDep.DepType.CODE)));
    devBuilderConfiguration.registerScriptHandler(handler);

    devSigner.registerLockScriptSigner(typeHash, new CapacityDiffScriptSigner());
  }

  static Address capacityScriptAddress(byte[] args) {
    var systemCells = devHashes.getJSONArray("system_cells");
    var cell = systemCells.getJSONObject(4);
    var typeHash = Numeric.hexStringToByteArray(cell.getString("type_hash"));
    var script = new Script(typeHash, args, Script.HashType.TYPE);
    return new Address(script, Network.TESTNET);
  }

  @Test
  void transferFromCustomScript() throws IOException, InterruptedException {
    devBuilderConfiguration.setFeeRate(1000);

    // first create a cell for the custom script
    byte[] txHash;
    {
      var sender = secp256k1Address("MINER").encode();
      var receiver = capacityScriptAddress(new byte[] {}).encode();
      var iterator = new InputIterator(indexer).addSearchKey(sender);
      var txWithScriptGroups = new CkbTransactionBuilder(devBuilderConfiguration,
          iterator)
          .addOutput(receiver, 1000 * 100000000L)
          .setChangeOutput(sender)
          .build();
      devSigner.signTransaction(txWithScriptGroups, privateKey("MINER"));
      txHash = assertDoesNotThrow(() -> rpc.sendTransaction(txWithScriptGroups.txView), "Send Transaction");
    }

    mineToCommited(txHash, 3);

    // now create a transaction with the custom lock script
    {
      var sender = capacityScriptAddress(new byte[] {}).encode();
      var receiver = secp256k1Address("MINER").encode();
      var iterator = new InputIterator(indexer).addSearchKey(sender);
      var builder = new InputDetailsCkbTransactionBuilder(devBuilderConfiguration,
          iterator);
      var txWithScriptGroups = builder
          .addOutput(receiver, 500 * 100000000L)
          .setChangeOutput(sender)
          .build();
      devSigner.signTransaction(txWithScriptGroups, builder.context());
      assertDoesNotThrow(() -> rpc.sendTransaction(txWithScriptGroups.txView),
          "Send Transaction");
    }
  }
}
