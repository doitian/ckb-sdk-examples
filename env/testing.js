import { dirname } from "path";
import { fileURLToPath } from "url";
import fs from "fs";
import * as lumos from "@ckb-lumos/lumos";

const {
  RPC,
  BI,
  config: { createConfig },
} = lumos;

export const rootDir = dirname(dirname(fileURLToPath(import.meta.url)));

export function createDevConfig() {
  const rawdata = fs.readFileSync(`${rootDir}/var/hashes.json`);
  const hashes = JSON.parse(rawdata);

  return createConfig({
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
  });
}

export async function waitForIndexerReady(blockNumber) {
  const rpc = new RPC(process.env.CKB_RPC_URL);

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
