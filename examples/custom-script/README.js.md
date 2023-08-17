# Custom Script Example - Lumos (JavaScript)

[Full Example](custom-script.test.js)

To add new scripts, Lumos provides [registerCustomLockScriptInfos]. For each lock script, a [LockScriptInfo] object is mandatory.

[registerCustomLockScriptInfos]: https://lumos-website-git-stable-magickbase.vercel.app/api/modules/common_scripts.html#registercustomlockscriptinfos-2
[LockScriptInfo]: https://lumos-website-git-stable-magickbase.vercel.app/api/interfaces/common_scripts.lockscriptinfo.html

Inside `LockScriptInfo.lockScriptInfo`, the lock script must implement following interfaces:

-   The `CellCollector` must be a constructor function or class and is used by Lumos to locate live cells for transaction inputs. For each address and registered lock script, Lumos will create an instance of `CellCollector`. The responsibility of filtering out cells that do not match the lock script lies with the `CellCollector`; Lumos does not perform this check. The initialized object's mandatory interface is `async *collect()`, an async generator.
-   When a live cell is found by the `CellCollector` instance, Lumos invokes the `setupInputCell` method within the corresponding `LockScriptInfo`. This method is responsible for adding the input to the transaction and including a matching output cell. This is necessary since Lumos searches for the available balance of an address in the outputs during transaction building.
-   The `prepareSigningEntries` method serves as a callback in [lumos.commons.common.prepareSigningEntries]. Its purpose is to add signing entries for each input that requires storing a signature in the witness. A singing entry has 3 fields:
    -   `index`: the witness index where the signature is stored
    -   `message`: this refers to the message waiting for signature.
    -   `type`: the one available value is `witness_args_lock`. This value specifies that the witness is a serialized `WitnessArgs`, and its lock field contains the signature of the lock script.

[lumos.commons.common.prepareSigningEntries]: https://lumos-website-git-stable-magickbase.vercel.app/api/modules/common_scripts.html#preparesigningentries-13

## Issues

-   `LockScriptInfo` lacks documentations about the interfaces.
-   `Lumos` imposes many implict requirements on the implementation of `setupInputCell`.
-   Setting up a script requires a significant amount of bootstrap code. Compared to the Java example, it took over 100 lines of code more.
