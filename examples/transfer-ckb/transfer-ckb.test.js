import { RPC } from "@ckb-lumos/lumos";

const CKB_RPC_URL = "http://127.0.0.1:8114";
const rpc = new RPC(CKB_RPC_URL);

test('get tip number', async () => {
  const result = await rpc.getTipBlockNumber();
  expect(result).toBe("0x0");
});
