import * as lumos from "@ckb-lumos/lumos";
import { ResultFormatter } from "@ckb-lumos/rpc";
import fs from "fs";
import { dirname } from "path";
import { fileURLToPath } from "url";

const { BI } = lumos;

export const rootDir = dirname(dirname(fileURLToPath(import.meta.url)));

export function readHashes() {
  const rawdata = fs.readFileSync(`${rootDir}/var/hashes.json`);
  return JSON.parse(rawdata);
}

export function createDevConfig() {
  const hashes = readHashes();

  return {
    PREFIX: "ckt",
    SCRIPTS: {
      SECP256K1_BLAKE160: {
        CODE_HASH:
          "0x9bd7e06f3ecf4be0f2fcd2188b23f1b9fcc88e5d4b65a8637b17723bbda3cce8",
        HASH_TYPE: "type",
        TX_HASH: hashes.ckb_dev.dep_groups[0].tx_hash,
        INDEX: "0x0",
        DEP_TYPE: "depGroup",
        SHORT_ID: 0,
      },
      SECP256K1_BLAKE160_MULTISIG: {
        CODE_HASH:
          "0x5c5069eb0857efc65e1bca0c07df34c31663b3622fd3876c876320fc9634e2a8",
        HASH_TYPE: "type",
        TX_HASH: hashes.ckb_dev.dep_groups[1].tx_hash,
        INDEX: "0x1",
        DEP_TYPE: "depGroup",
        SHORT_ID: 1,
      },
      DAO: {
        CODE_HASH:
          "0x82d76d1b75fe2fd9a27dfbaa65a039221a380d76c926f378d3f81cf3e7e13f2e",
        HASH_TYPE: "type",
        TX_HASH: hashes.ckb_dev.system_cells[1].tx_hash,
        INDEX: "0x2",
        DEP_TYPE: "code",
      },
    },
  };
}

export async function waitForIndexerReady(rpc, blockNumber) {
  blockNumber = BI.from(blockNumber);
  let tip = await rpc.getIndexerTip();
  while (
    tip === null ||
    tip === undefined ||
    BI.from(tip.blockNumber).lt(blockNumber)
  ) {
    await new Promise((r) => setTimeout(r, 300));
    tip = await rpc.getIndexerTip();
  }
}

export async function mine(rpc, count) {
  if (!rpc.generateBlock) {
    rpc.addMethod({
      name: "generateBlock",
      method: "generate_block",
      paramsFormatters: [],
      resultFormatters: ResultFormatter.toHash,
    });
  }

  const expectedTip = BI.from(await rpc.getTipBlockNumber()).add(count);

  while (count > 0) {
    const tipHash = (await rpc.getTipHeader()).hash;
    const minedHash = await rpc.generateBlock();
    if (tipHash !== minedHash) {
      count -= 1;
    }
  }
  await waitForIndexerReady(rpc, expectedTip);
}

/**
 * @param rpc {import("@ckb-lumos/lumos").RPC}
 */
export async function mineToCommitted(rpc, txHash, step) {
  do {
    await mine(rpc, step);
  } while ((await rpc.getTransaction(txHash)).txStatus.status !== "committed");
}
