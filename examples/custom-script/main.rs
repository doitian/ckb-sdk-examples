use ckb_sdk::{
    traits::{
        DefaultCellCollector, DefaultCellDepResolver, DefaultHeaderDepResolver,
        DefaultTransactionDependencyProvider, SecpCkbRawKeySigner, Signer,
    },
    tx_builder::{transfer::CapacityTransferBuilder, CapacityBalancer, TxBuilder},
    unlock::{ScriptUnlocker, SecpSighashUnlocker},
    Address, AddressPayload, HumanCapacity, NetworkType, ScriptId,
};
use ckb_sdk_examples_env::{Env, Result};
use ckb_types::{
    bytes::Bytes,
    core::{BlockView, ScriptHashType},
    packed::{CellOutput, Script, WitnessArgs},
    prelude::*,
    H256,
};
use std::{collections::HashMap, env, str::FromStr};

fn get_address_from_hashes(env: &Env, cell_index: usize, args: Bytes) -> Result<Address> {
    let cell = &env.dev.system_cells[cell_index];
    let payload = match &cell.type_hash {
        Some(type_hash) => AddressPayload::new_full(ScriptHashType::Type, type_hash.pack(), args),
        None => AddressPayload::new_full(ScriptHashType::Data1, cell.data_hash.pack(), args),
    };

    Ok(Address::new(NetworkType::Testnet, payload, true))
}

fn get_secp256k1_address(env: &Env, args: Bytes) -> Result<Address> {
    get_address_from_hashes(env, 0, args)
}

fn get_named_secp256k1_address(env: &Env, name: &str) -> Result<Address> {
    get_secp256k1_address(env, Bytes::from(hex::decode(&env::var(name)?[2..])?))
}

fn get_custom_address(env: &Env, args: Bytes) -> Result<Address> {
    get_address_from_hashes(env, 4, args)
}

fn lock_witness_placeholder(size: usize) -> WitnessArgs {
    WitnessArgs::new_builder()
        .lock(Some(Bytes::from(vec![0u8; size])).pack())
        .build()
}

fn fill_account(env: &mut Env, receiver: &Address, capacity: u64) -> Result<H256> {
    let miner = get_named_secp256k1_address(env, "MINER_LOCK_ARG")?;
    let miner_key = secp256k1::SecretKey::from_str(&env::var("MINER_PRIVATE_KEY")?[2..])?;
    let miner_lock = Script::from(&miner);

    let witness_placeholder = lock_witness_placeholder(65);
    let balancer = CapacityBalancer::new_simple(miner.payload().into(), witness_placeholder, 1000);
    let cell_dep_resolver = {
        let genesis_block = env
            .rpc
            .get_block_by_number(0.into())?
            .ok_or("genesis block must exist")?;
        DefaultCellDepResolver::from_genesis(&BlockView::from(genesis_block))?
    };
    let header_dep_resolver = DefaultHeaderDepResolver::new(&env.rpc_endpoint);
    let mut cell_collector = DefaultCellCollector::new(&env.rpc_endpoint);
    let tx_dep_provider = DefaultTransactionDependencyProvider::new(&env.rpc_endpoint, 10);

    let output = CellOutput::new_builder()
        .lock(receiver.into())
        .capacity(capacity.pack())
        .build();
    let builder = CapacityTransferBuilder::new(vec![(output, Bytes::default())]);

    let signer: Box<dyn Signer> =
        Box::new(SecpCkbRawKeySigner::new_with_secret_keys(vec![miner_key]));
    let sighash_unlocker: Box<dyn ScriptUnlocker> = Box::new(SecpSighashUnlocker::from(signer));
    let sighash_script_id = ScriptId::from(&miner_lock);
    let unlockers = HashMap::from([(sighash_script_id, sighash_unlocker)]);

    let (tx, _) = builder.build_unlocked(
        &mut cell_collector,
        &cell_dep_resolver,
        &header_dep_resolver,
        &tx_dep_provider,
        &balancer,
        &unlockers,
    )?;

    Ok(env.rpc.send_transaction(tx.data().into(), None)?)
}

fn main() -> Result<()> {
    let mut env = Env::try_new()?;

    let custom_address = get_custom_address(&env, Bytes::new())?;

    let fill_tx_hash = fill_account(
        &mut env,
        &custom_address,
        HumanCapacity::from_str("1000")?.into(),
    )?;

    env.mine_to_committed(&fill_tx_hash, 3)?;

    Ok(())
}
