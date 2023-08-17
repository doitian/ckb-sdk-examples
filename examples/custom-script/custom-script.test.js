import * as codec from "@ckb-lumos/codec";
import * as lumos from "@ckb-lumos/lumos";
import { Map } from "immutable";
import { createDevConfig, mineToCommitted, readHashes } from "../../env/env";
import { values as valueClasses, blockchain } from "@ckb-lumos/base";

// this utility function is not exposed in @ckb-lums/lumos
import { addCellDep } from "@ckb-lumos/common-scripts/lib/helper";

const {
  BI,
  RPC,
  Indexer,
  commons,
  hd,
  helpers: { TransactionSkeleton },
} = lumos;

// Compare two objects by convert them to molecule buffer to ignore the representation only
// differences.
function isSameValue(a, b, ValueConstructor) {
  return new ValueConstructor(a, { validate: false }).equals(
    new ValueConstructor(b, { validate: false }),
  );
}
function isSameScript(a, b) {
  return isSameValue(a, b, valueClasses.ScriptValue);
}

const MAX_U64_PLUS_ONE = BI.from(1).shl(64);
function packInt64LE(number) {
  return codec.number.Uint64LE.pack(
    number.isNegative() ? MAX_U64_PLUS_ONE.add(number) : number,
  );
}

/** @type {import("@ckb-lumos/lumos").commons.LockScriptInfo} */
const capacityDiffLockInfo = {
  codeHash: "0x",
  hashType: "type",
  lockScriptInfo: {
    CellCollector: class {
      constructor(fromInfo, cellProvider, { config, queryOptions }) {
        if (!cellProvider) {
          throw new Error(`Cell provider is missing!`);
        }
        config ??= lumos.config.getConfig();
        const script = commons.parseFromInfo(fromInfo, { config }).fromScript;

        // Please note that the cell collector is called for each specific fromInfo.
        // Be cautious not to include input cells for accounts that are not locked by this script.
        const template = config.SCRIPTS.CAPACITY_DIFF;
        if (
          script.codeHash !== template.CODE_HASH ||
          script.hashType !== template.HASH_TYPE
        ) {
          return;
        }

        // Now we can apply the queryOptions to search the live cells.
        queryOptions ??= {};
        queryOptions = {
          ...queryOptions,
          lock: script,
          type: queryOptions.type ?? "empty",
        };

        this.cellCollector = cellProvider.collector(queryOptions);
      }

      async *collect() {
        if (this.cellCollector) {
          for await (const inputCell of this.cellCollector.collect()) {
            yield inputCell;
          }
        }
      }
    },

    // What to do when a inputCell has been found by the cell provider.
    // - Add input and output cell
    // - Add cell deps.
    // - Fill witness to make fee calculation correct.
    setupInputCell: async (
      txSkeleton,
      inputCell,
      _fromInfo,
      { config, since, defaultWitness },
    ) => {
      // use default config when config is not provided
      config ??= lumos.config.getConfig();
      const fromScript = inputCell.cellOutput.lock;
      const txMutable = txSkeleton.asMutable();

      //===========================
      // I. Common Skeletons
      //
      // There are many steps that setupInputCell must perform carefully, otherwise the whole transaction builder will fail.
      //===========================
      // 1.Add inputCell to txSkeleton
      txMutable.update("inputs", (inputs) => inputs.push(inputCell));

      // 2. Add output. The function `lumos.commons.common.transfer` will scan outputs for available balance for each account.
      const outputCell = {
        cellOutput: {
          ...inputCell.cellOutput,
        },
        data: inputCell.data,
      };
      txMutable.update("outputs", (outputs) => outputs.push(outputCell));

      // 3. Set Since
      if (since) {
        txMutable.setIn(
          ["inputSinces", txMutable.get("inputs").size - 1],
          since,
        );
      }

      // 4. Insert a witness to ensure they are aligned to the location of the corresponding input cells.
      txMutable.update("witnesses", (witnesses) =>
        witnesses.push(defaultWitness ?? "0x"),
      );
      //=> Common Skeletons End Here

      //===========================
      // II. CellDeps
      //===========================
      // Assume that script onchain infos are stored as CAPACITY_DIFF
      const template = config.SCRIPTS.CAPACITY_DIFF;
      if (!template) {
        throw new Error(
          "Provided config does not have CAPACITY_DIFF script setup!",
        );
      }
      const scriptOutPoint = {
        txHash: template.TX_HASH,
        index: template.INDEX,
      };
      // The helper method addCellDep avoids adding duplicated cell deps.
      addCellDep(txMutable, {
        outPoint: scriptOutPoint,
        depType: template.DEP_TYPE,
      });

      //===========================
      // II. Witness Placeholder
      //===========================
      // Fill witness. These code are copied from
      // https://github.com/ckb-js/lumos/blob/1cb43fe72dc95c4b3283acccb5120b7bcaeb9346/packages/common-scripts/src/secp256k1_blake160.ts#L90
      //
      // It takes a lot of code to set the witness for the first input cell in
      // the script group to 8 bytes of zeros.
      const firstIndex = txMutable
        .get("inputs")
        .findIndex((input) => isSameScript(input.cellOutput.lock, fromScript));

      if (firstIndex !== -1) {
        // Ensure witnesses are aligned to inputs
        const toFillWitnessesCount =
          firstIndex + 1 - txMutable.get("witnesses").size;
        if (toFillWitnessesCount > 0) {
          txMutable.update("witnesses", (witnesses) =>
            witnesses.concat(Array(toFillWitnessesCount).fill("0x")),
          );
        }
        txMutable.updateIn(["witnesses", firstIndex], (witness) => {
          const witnessArgs = {
            ...(witness === "0x"
              ? {}
              : blockchain.WitnessArgs.unpack(codec.bytes.bytify(witness))),
            lock: "0x0000000000000000",
          };
          return codec.bytes.hexify(blockchain.WitnessArgs.pack(witnessArgs));
        });
      }

      return txMutable.asImmutable();
    },

    // Create entries in txSkeleton.signingEntries
    prepareSigningEntries: (txSkeleton, { config }) => {
      // use default config when config is not provided
      config ??= lumos.config.getConfig();
      const template = config.SCRIPTS.CAPACITY_DIFF;
      if (!template) {
        throw new Error(
          `Provided config does not have CAPACITY_DIFF script setup!`,
        );
      }

      /** @type {import("immutable").Map<byte[], {index:number, capacity:BI}>} */
      const balances = Map().asMutable();
      // Group inputs by args and tally the total capacity as negative values.
      txSkeleton.get("inputs").forEach((input, index) => {
        const {
          capacity,
          lock: { codeHash, hashType, args },
        } = input.cellOutput;
        if (
          template.CODE_HASH === codeHash &&
          template.HASH_TYPE === hashType
        ) {
          if (balances.has(args)) {
            balances.updateIn([args, "capacity"], (total) =>
              total.sub(capacity),
            );
          } else {
            balances.set(args, { index, capacity: BI.from(0).sub(capacity) });
          }
        }
      });
      // Add capacity of output cells to the tally.
      txSkeleton.get("outputs").forEach((output) => {
        const {
          capacity,
          lock: { codeHash, hashType, args },
        } = output.cellOutput;
        if (
          template.CODE_HASH === codeHash &&
          template.HASH_TYPE === hashType &&
          balances.has(args)
        ) {
          balances.updateIn([args, "capacity"], (total) => total.add(capacity));
        }
      });
      // Create signing entries. Indeed, for this simple script, we could set
      // the witness directly. However, for serious lock script, it often
      // requires sining by the private
      // key.
      return txSkeleton.update("signingEntries", (entries) =>
        entries.concat(
          balances
            .asImmutable()
            .valueSeq()
            .map(({ index, capacity }) => ({
              index,
              // This is the only supported type, which indicate the signature
              // follows the WitnewsArgs layout.
              type: "witness_args_lock",
              message: codec.bytes.hexify(packInt64LE(capacity)),
            })),
        ),
      );
    },
  },
};

const rpc = new RPC(process.env.CKB_RPC_URL);

beforeAll(() => {
  const config = createDevConfig();
  const hashes = readHashes();

  // Steps to register custom scripts
  //
  // 1. Add script on-chain info to config register script using the JSON
  //    exported from:
  //
  //     ckb list-hashes -f json
  const cell = hashes.ckb_dev.system_cells.find((cell) =>
    cell.path.endsWith("ckb-sdk-examples-capacity-diff)"),
  );
  config.SCRIPTS.CAPACITY_DIFF = {
    CODE_HASH: cell.type_hash,
    HASH_TYPE: "type",
    TX_HASH: cell.tx_hash,
    INDEX: BI.from(cell.index).toHexString(),
    DEP_TYPE: "code",
  };

  lumos.config.initializeConfig(lumos.config.createConfig(config));

  // 2. Register lock script info
  capacityDiffLockInfo.codeHash = cell.type_hash;
  lumos.commons.common.registerCustomLockScriptInfos([capacityDiffLockInfo]);
});

function secp256k1LockScript(lockArg) {
  const config = lumos.config.getConfig();
  const script = config.SCRIPTS["SECP256K1_BLAKE160"];
  return {
    codeHash: script.CODE_HASH,
    hashType: script.HASH_TYPE,
    args: lockArg,
  };
}

function customLockScript(lockArg) {
  const config = lumos.config.getConfig();
  const script = config.SCRIPTS["CAPACITY_DIFF"];
  return {
    codeHash: script.CODE_HASH,
    hashType: script.HASH_TYPE,
    args: lockArg,
  };
}

async function fillAccount(txSkeleton, to, capacity) {
  const minerAddress = lumos.helpers.encodeToAddress(
    secp256k1LockScript(process.env.MINER_LOCK_ARG),
  );

  txSkeleton = await commons.common.transfer(
    txSkeleton,
    [minerAddress],
    to,
    capacity,
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

  await mineToCommitted(rpc, txHash, 3);

  return txHash;
}

test("miner transfers 100 CKB to alice", async () => {
  const indexer = new Indexer(process.env.CKB_RPC_URL);
  const customAddress = lumos.helpers.encodeToAddress(customLockScript("0x"));
  const minerAddress = lumos.helpers.encodeToAddress(
    secp256k1LockScript(process.env.MINER_LOCK_ARG),
  );
  let txSkeleton = TransactionSkeleton({
    cellProvider: indexer,
  });

  await fillAccount(txSkeleton, customAddress, BigInt(1000 * 10 ** 8));

  // txSkeleton is immutable, rember to save the return result.
  txSkeleton = await commons.common.transfer(
    txSkeleton,
    [customAddress],
    minerAddress,
    BigInt(500 * 10 ** 8),
  );
  txSkeleton = await commons.common.payFee(
    txSkeleton,
    [customAddress],
    BigInt(1 * 10 ** 8),
  );

  const txForSigning = commons.common.prepareSigningEntries(txSkeleton);
  // The witness is ready in message, just copy them to signatures.
  const signatures = txForSigning
    .get("signingEntries")
    .map(({ message }) => message);
  const tx = lumos.helpers.sealTransaction(txForSigning, signatures.toJSON());

  const txHash = await rpc.sendTransaction(tx);
  expect(txHash).toMatch(/^0x[0-9a-z]+/);
});
