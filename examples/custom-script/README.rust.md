# Custom Script Example - Rust

[Full Example](main.rs)

The Rust SDK trait [TxBuilder] provides various transaction building methods. Among them, `build_unlocked` automatically adds inputs to ensure a balance between the input and output CKB capacity.

[TxBuilder]: https://docs.rs/ckb-sdk/2.5.0/ckb_sdk/tx_builder/trait.TxBuilder.html

To make a custom script work with `TxBuilder`, there are two major tasks.

First, register the script cell dep information into [CellDepResolver]. This is a table from script `hash_type` and `code_hash` to `CellDep`.

Then, implement [ScriptUnlocker] to set the correct witness.

[CellDepResolver]: https://docs.rs/ckb-sdk/2.5.0/ckb_sdk/traits/trait.CellDepResolver.html
[ScriptUnlocker]: https://docs.rs/ckb-sdk/2.5.0/ckb_sdk/unlock/trait.ScriptUnlocker.html

## Summary

-   Live Cells Collector: `CellCollector` is the data source of live cells, and `Balancer` filters live cells belonging to specified address.
-   Dep Cell: Via `CellDepResolver`
-   Pre-fill Witness: Required, via `Balancer` and `ScriptUnlocker::fill_placeholder_witness`.
-   Signing: Via `ScriptUnlocker`
-   Extra Data
    -   `ScriptUnlocker` has access to `TransactionDependencyProvider` to lookup cells.
    -   The `ScriptUnlocker` is a struct and can access additional data by adding new fields.
