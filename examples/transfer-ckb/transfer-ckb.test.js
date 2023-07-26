import { RPC } from "@ckb-lumos/lumos";

const rpc = new RPC(process.env.CKB_RPC_URL);

test('get tip number', async () => {
  const tip = await rpc.getTipBlockNumber();
  expect(tip).toBe("0x0");

  const indexerTip = await rpc.getIndexerTip();
  expect(indexerTip).toMatchObject({
    blockNumber: "0x0"
  });
});
