use ckb_sdk::{
    traits::{
        DefaultCellCollector, DefaultCellDepResolver, DefaultHeaderDepResolver,
        DefaultTransactionDependencyProvider, SecpCkbRawKeySigner, Signer,
        TransactionDependencyProvider,
    },
    tx_builder::{transfer::CapacityTransferBuilder, CapacityBalancer, TxBuilder},
    unlock::{ScriptUnlocker, SecpSighashUnlocker, UnlockError},
    Address, AddressPayload, HumanCapacity, NetworkType, ScriptGroup, ScriptId,
};
use ckb_sdk_examples_env::{Env, Result};
use ckb_types::{
    bytes::Bytes,
    core::{BlockView, DepType, ScriptHashType, TransactionView},
    packed::{CellDep, CellOutput, OutPoint, Script, WitnessArgs},
    prelude::*,
    H256,
};
use std::{collections::HashMap, env, str::FromStr};

fn main() -> Result<()> {
    let mut env = pre_main()?;

    // This is the address locked by CapacityDiff, which has a balance of 1000 CKB
    let capacity_diff_address = get_custom_address(&env, Bytes::new())?;
    // I want to transfer 500 CKB back to miner
    let miner = get_named_secp256k1_address(&env, "MINER_LOCK_ARG")?;

    // I need information about the CapacityDiff contract cell
    let capacity_diff_contract = &env.dev.system_cells[4];
    let capacity_diff_script_id = ScriptId::new(
        capacity_diff_contract
            .type_hash
            .clone()
            .ok_or("expect type_hash")?,
        ScriptHashType::Type,
    );
    let capacity_diff_cell_dep = CellDep::new_builder()
        .dep_type(DepType::Code.into())
        .out_point(OutPoint::new(
            capacity_diff_contract.tx_hash.clone().pack(),
            capacity_diff_contract.index,
        ))
        .build();

    // To build transactions, I need these there providers to lookup headers, txs, cells, and live
    // cells
    // 1. HeaderDepResolver: lookup header by tx hash or block number
    let header_dep_resolver = DefaultHeaderDepResolver::new(&env.rpc_endpoint);
    // 2. TransactionDependencyProvider: lookup tx and cells
    let tx_dep_provider = DefaultTransactionDependencyProvider::new(&env.rpc_endpoint, 10);
    // 3. CellCollector: lookup live cells. CellCollector is stateful, it should return each live
    //    cell only once.
    let mut cell_collector = DefaultCellCollector::new(&env.rpc_endpoint);

    // The CellDepResolver automatically adds CellDep when input or output cells are added to a
    // transaction. It operates through a lookup table which matches script (hash_type, code_hash)
    // to the relevant CellDep.
    let cell_dep_resolver = {
        // To extract cell dependency information from system scripts in the genesis block, the
        // `DefaultCellDepResolver::from_genesis` function is available and recommended as a
        // starting point
        let genesis_block = env
            .rpc
            .get_block_by_number(0.into())?
            .ok_or("genesis block must exist")?;
        let mut resolver = DefaultCellDepResolver::from_genesis(&BlockView::from(genesis_block))?;
        resolver.insert(
            capacity_diff_script_id.clone(),
            capacity_diff_cell_dep,
            "capacity_diff".to_string(),
        );
        resolver
    };

    // Balancer auto insert inptus from the specified lock script when the total capacity of all
    // inputs is less than outputs.
    //
    // It's crucial to pre-fill the witness, because fee rate calculation is based on transaction size.
    // When the size of the script witness is unknown, the maximum size should be used
    // as a placeholder. Only 8 bytes are required for CapacityDiff.
    let witness_placeholder = lock_witness_placeholder(8);
    let balancer = CapacityBalancer::new_simple(
        capacity_diff_address.payload().into(),
        witness_placeholder,
        1000,
    );

    // Add outputs, and let balancer to fill inputs automatically.
    let output = CellOutput::new_builder()
        .lock((&miner).into())
        .capacity(HumanCapacity::from_str("500")?.0.pack())
        .build();
    let builder = CapacityTransferBuilder::new(vec![(output, Bytes::default())]);

    // Unlocker is responsible to set correct witness for different scripts. See
    // CapacityDiffUnlocker for details.
    let capacity_diff_unlocker: Box<dyn ScriptUnlocker> = Box::new(CapacityDiffUnlocker {});
    let unlockers = HashMap::from([(capacity_diff_script_id.clone(), capacity_diff_unlocker)]);

    // Add `use ckb_sdk::tx_builder::TxBuilder` to make advanced build methods available.
    let (tx, _) = builder.build_unlocked(
        &mut cell_collector,
        &cell_dep_resolver,
        &header_dep_resolver,
        &tx_dep_provider,
        &balancer,
        &unlockers,
    )?;

    env.rpc.send_transaction(tx.data().into(), None)?;

    Ok(())
}

struct CapacityDiffUnlocker {}
impl ScriptUnlocker for CapacityDiffUnlocker {
    // This works for any args
    fn match_args(&self, _args: &[u8]) -> bool {
        true
    }

    fn unlock(
        &self,
        tx: &TransactionView,
        _script_group: &ScriptGroup,
        _tx_dep_provider: &dyn TransactionDependencyProvider,
    ) -> std::result::Result<TransactionView, UnlockError> {
        // TODO: set witness to the capacity diff
        Ok(tx.as_advanced_builder().build())
    }

    fn fill_placeholder_witness(
        &self,
        tx: &TransactionView,
        _script_group: &ScriptGroup,
        _tx_dep_provider: &dyn TransactionDependencyProvider,
    ) -> std::result::Result<TransactionView, UnlockError> {
        // If the transaction is built using balancer, the witness placehodler has already been
        // added. Just double check here.
        // TODO: fill placeholder witness
        Ok(tx.clone())
    }
}

fn pre_main() -> Result<Env> {
    let mut env = Env::try_new()?;

    // Send 1000 CKB to the address locked by CapacityDiff
    let reciever = get_custom_address(&env, Bytes::new())?;
    let fill_tx_hash = fill_account(&mut env, &reciever, HumanCapacity::from_str("1000")?.into())?;

    env.mine_to_committed(&fill_tx_hash, 3)?;

    Ok(env)
}

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
