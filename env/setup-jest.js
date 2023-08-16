import * as lumos from "@ckb-lumos/lumos";
import "dotenv/config";
import { spawn } from "node:child_process";
import { dirname } from "path";
import { fileURLToPath } from "url";
import waitPort from "wait-port";

import { createDevConfig, waitForIndexerReady } from "./env";

const rootDir = dirname(dirname(fileURLToPath(import.meta.url)));
let ckbProcess = null;

const CKB_SETUP_TIMEOUT = 1000 * 60;

beforeAll(async () => {
  const config = createDevConfig();
  lumos.config.initializeConfig(lumos.config.createConfig(config));
});

beforeEach(async () => {
  ckbProcess = spawn(`bin/ckb-node.sh`, [], {
    cwd: rootDir,
    stdio: ["ignore", process.stderr, process.stderr],
  });
  globalThis.ckbProcess = ckbProcess;

  const url = new URL(process.env.CKB_RPC_URL);
  const port = parseInt(url.port, 10);
  await waitPort({ host: url.hostname, port: isNaN(port) ? 8114 : port });

  const rpc = new lumos.RPC(process.env.CKB_RPC_URL);
  await waitForIndexerReady(rpc, 0);
}, CKB_SETUP_TIMEOUT);

afterEach((done) => {
  globalThis.ckbProcess = null;
  ckbProcess.kill();
  ckbProcess.on("close", done);
});
