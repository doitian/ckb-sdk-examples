import { dirname } from 'path';
import { fileURLToPath } from 'url';
import { spawn } from 'node:child_process';
import waitPort from 'wait-port';

const rootDir = dirname(dirname(fileURLToPath(import.meta.url)));
let ckbProcess = null;

const CKB_SETUP_TIMEOUT = 1000 * 60;

beforeAll(() => {
    ckbProcess = spawn(`bin/ckb-node.sh`, [], {
        cwd: rootDir,
        stdio: ['ignore', process.stderr, process.stderr]
    });
    globalThis.ckbProcess = ckbProcess;

    return waitPort({ host: 'localhost', port: 8114 });
}, CKB_SETUP_TIMEOUT);

afterAll((done) => {
    globalThis.ckbProcess = null;
    ckbProcess.kill();
    ckbProcess.on('close', done);
});