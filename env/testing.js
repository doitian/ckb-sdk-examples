import { RPC } from '@ckb-lumos/lumos';
import { BI } from "@ckb-lumos/bi";

export async function waitForIndexerReady(blockNumber) {
    const rpc = new RPC(process.env.CKB_RPC_URL);

    blockNumber = BI.from(blockNumber);
    let tip = await rpc.getIndexerTip();
    while (tip === null || tip === undefined || BI.from(tip.blockNumber).lt(blockNumber)) {
        await new Promise((r) => setTimeout(r, 300));
        tip = await rpc.getIndexerTip();
    }
}