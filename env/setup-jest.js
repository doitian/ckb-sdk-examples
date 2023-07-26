import { dirname } from "path";
import { fileURLToPath } from "url";
import { spawn } from "node:child_process";
import waitPort from "wait-port";
import * as lumos from "@ckb-lumos/lumos";
import "dotenv/config";

import { waitForIndexerReady, createDevConfig } from "./env";

const rootDir = dirname(dirname(fileURLToPath(import.meta.url)));
let ckbProcess = null;

const CKB_SETUP_TIMEOUT = 1000 * 60;

beforeAll(async () => {
  const config = createDevConfig();
  lumos.config.initializeConfig(config);

  ckbProcess = spawn(`bin/ckb-node.sh`, [], {
    cwd: rootDir,
    stdio: ["ignore", process.stderr, process.stderr],
  });
  globalThis.ckbProcess = ckbProcess;

  const url = new URL(process.env.CKB_RPC_URL);
  const port = parseInt(url.port, 10);
  await waitPort({ host: url.hostname, port: isNaN(port) ? 8114 : port });
  await waitForIndexerReady(0);
}, CKB_SETUP_TIMEOUT);

afterAll((done) => {
  globalThis.ckbProcess = null;
  ckbProcess.kill();
  ckbProcess.on("close", done);
});
