use ckb_jsonrpc_types::Status;
use ckb_sdk::{rpc::ckb_indexer, CkbRpcClient};
use ckb_types::H256;
use dotenv::dotenv;
use serde::Deserialize;
use std::{
    collections::HashMap,
    env, fs,
    process::{Child, Command},
    thread, time,
};

pub type Error = Box<dyn std::error::Error>;
pub type Result<T> = std::result::Result<T, Error>;

pub struct Env {
    pub ckb: Child,
    pub rpc: CkbRpcClient,
    pub dev: CKBHashesNetwork,
}

impl Env {
    pub fn try_new() -> Result<Env> {
        dotenv()?;

        let rpc = CkbRpcClient::new(&env::var("CKB_RPC_URL")?);
        let mut hashes: HashMap<String, CKBHashesNetwork> =
            serde_json::from_str(&fs::read_to_string("var/hashes.json")?)?;
        let dev = hashes.remove("ckb_dev").ok_or("expect ckb_dev in hashes")?;

        let ckb = Command::new("bin/ckb-node.sh").spawn()?;

        let mut env = Env { ckb, rpc, dev };

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
                Err(err) => return Err(err.into()),
                _ => {}
            }
            thread::sleep(time::Duration::from_millis(300));
        }
    }

    pub fn mine(&mut self, mut count: u64) -> Result<()> {
        while count > 0 {
            let tip_number = self.rpc.get_tip_block_number()?;
            let tip_hash = self
                .rpc
                .get_block_hash(tip_number)?
                .ok_or("tip hash not found")?;

            let new_hash = self.rpc.generate_block(None, None)?;

            if new_hash != tip_hash {
                count -= 1;
            }
        }

        Ok(())
    }

    pub fn mine_to_committed(&mut self, hash: H256, step: u64) -> Result<()> {
        loop {
            self.mine(step)?;

            if let Some(tx_with_status) = self.rpc.get_transaction(hash.clone())? {
                if tx_with_status.tx_status.status == Status::Committed {
                    return Ok(());
                }
            }
        }
    }
}

impl Drop for Env {
    fn drop(&mut self) {
        if let Err(e) = self.ckb.kill() {
            println!("Could not kill child process: {}", e)
        }
    }
}

#[derive(Deserialize)]
pub struct CKBHashesNetwork {
    pub system_cells: Vec<CKBHashesSystemCell>,
    pub dep_groups: Vec<CKBHashesDepGroup>,
}

#[derive(Deserialize)]
pub struct CKBHashesSystemCell {
    pub tx_hash: String,
    pub type_hash: Option<String>,
    pub index: u32,
}

#[derive(Deserialize)]
pub struct CKBHashesDepGroup {
    pub tx_hash: String,
    pub index: u32,
}
