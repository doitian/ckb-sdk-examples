use ckb_jsonrpc_types::Status;
use ckb_sdk::{rpc::ckb_indexer, CkbRpcClient};
use ckb_types::H256;
use dotenv::dotenv;
use std::env;
use std::io::{Error, ErrorKind, Result};
use std::process::{Child, Command};
use std::{thread, time};

pub struct Env {
    pub ckb: Child,
    pub rpc: CkbRpcClient,
}

impl Env {
    pub fn try_new() -> Result<Env> {
        dotenv_load()?;

        let ckb = Command::new("bin/ckb-node.sh").spawn()?;
        let rpc = CkbRpcClient::new(&env_var("CKB_RPC_URL")?);
        let mut env = Env { ckb, rpc };

        while env.wait_for_indexer(0).is_err() {
            thread::sleep(time::Duration::from_millis(300));
        }

        Ok(env)
    }

    pub fn wait_for_indexer(&mut self, expected_number: u64) -> Result<()> {
        loop {
            match self.rpc.get_indexer_tip() {
                Ok(Some(ckb_indexer::Tip { block_number, .. }))
                    if block_number.value() >= expected_number =>
                {
                    return Ok(())
                }
                Err(err) => {
                    return Err(Error::new(ErrorKind::Other, err));
                }
                _ => {}
            }
            thread::sleep(time::Duration::from_millis(300));
        }
    }

    pub fn mine(&mut self, mut count: u64) -> Result<()> {
        while count > 0 {
            let tip_number = self.rpc.get_tip_block_number().map_err(map_err)?;
            let tip_hash = self
                .rpc
                .get_block_hash(tip_number)
                .map_err(map_err)?
                .ok_or_else(|| Error::new(ErrorKind::Other, "tip hash not found"))?;

            let new_hash = self.rpc.generate_block(None, None).map_err(map_err)?;

            if new_hash != tip_hash {
                count -= 1;
            }
        }

        Ok(())
    }

    pub fn mine_to_committed(&mut self, hash: H256, step: u64) -> Result<()> {
        loop {
            self.mine(step)?;

            if let Some(tx_with_status) = self.rpc.get_transaction(hash.clone()).map_err(map_err)? {
                if tx_with_status.tx_status.status == Status::Committed {
                    return Ok(());
                }
            }
        }
    }
}

impl Drop for Env {
    fn drop(&mut self) {
        println!("Kill child process");
        if let Err(e) = self.ckb.kill() {
            println!("Could not kill child process: {}", e)
        }
    }
}

fn map_err<E>(error: E) -> Error
where
    E: Into<Box<dyn std::error::Error + Send + Sync>>,
{
    Error::new(ErrorKind::Other, error)
}

fn env_var(key: &str) -> Result<String> {
    env::var(key).map_err(|err| Error::new(ErrorKind::Other, err))
}

fn dotenv_load() -> Result<()> {
    dotenv().map_err(|err| match err {
        dotenv::Error::Io(err) => err,
        dotenv::Error::EnvVar(err) => Error::new(ErrorKind::Other, err),
        err => Error::new(ErrorKind::Other, err),
    })?;

    Ok(())
}
