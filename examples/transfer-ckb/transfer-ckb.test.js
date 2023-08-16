import * as lumos from "@ckb-lumos/lumos";

const {
  RPC,
  Indexer,
  hd,
  commons,
  config: { getConfig },
} = lumos;

function secp256k1LockScript(lockArg) {
  const config = getConfig();
  const script = config.SCRIPTS["SECP256K1_BLAKE160"];
  return {
    codeHash: script.CODE_HASH,
    hashType: script.HASH_TYPE,
    args: lockArg,
  };
}

const rpc = new RPC(process.env.CKB_RPC_URL);

test("miner transfers 100 CKB to alice", async () => {
  const indexer = new Indexer(process.env.CKB_RPC_URL);
  const minerAddress = lumos.helpers.encodeToAddress(
    secp256k1LockScript(process.env.MINER_LOCK_ARG),
  );
  const aliceAddress = lumos.helpers.encodeToAddress(
    secp256k1LockScript(process.env.ALICE_LOCK_ARG),
  );

  let txSkeleton = lumos.helpers.TransactionSkeleton({ cellProvider: indexer });

  txSkeleton = await commons.common.transfer(
    txSkeleton,
    [minerAddress],
    aliceAddress,
    BigInt(100 * 10 ** 8),
  );
  txSkeleton = await commons.common.payFee(
    txSkeleton,
    [minerAddress],
    BigInt(1 * 10 ** 8),
  );

  const txForSigning = commons.common.prepareSigningEntries(txSkeleton);
  const signatures = txForSigning
    .get("signingEntries")
    .map(({ message }) =>
      hd.key.signRecoverable(message, process.env.MINER_PRIVATE_KEY),
    );
  const tx = lumos.helpers.sealTransaction(txForSigning, signatures.toJSON());

  const txHash = await rpc.sendTransaction(tx);
  expect(txHash).toMatch(/^0x[0-9a-z]+/);
});
