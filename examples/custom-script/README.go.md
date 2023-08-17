# Custom Script Example - Golang

[Full Example](custom_script_test.go)

The SDK SDK provides two tools for transaction handling: [CkbTransactionBuilder] for building transactions, and [TransactionSigner] for signing them. Both of them supports registering handlers for custom scripts.

[CkbTransactionBuilder]: https://github.com/nervosnetwork/ckb-sdk-go/blob/5d229f6489b99fd7fac958675ca68b5b9dba7bb3/collector/builder/ckb.go#L12
[TransactionSigner]: https://github.com/nervosnetwork/ckb-sdk-go/blob/5d229f6489b99fd7fac958675ca68b5b9dba7bb3/transaction/signer/signer.go#L14

## Summary

-   Live Cells Collector: The client must filter live cells. It's not possible for script handlers to filter out newly discovered live cells.
-   Dep Cell: Via `ScriptHandler`
-   Pre-fill Witness: Required, via `ScriptHandler`
-   Signing: Via `ScriptSigner`
-   Extra Data
    -   Cannot access input cells
    -   Cannot access dep headers
    -   Client can pass any object as the context to `ScriptHandler` and `ScriptSigner`

## Transaction Builder

The `CkbTransactionBuilder` can register `ScriptHandler`s for both type scripts and lock scripts. Upon calling `CkbTransactionBuilder.Build`, the builder will sequentially execute the `Scripthandler#BuildTransaction` method of all registered handlers.

```go
func (r *CapacityDiffScriptHandler) BuildTransaction(builder collector.TransactionBuilder, group *transaction.ScriptGroup, context interface{}) (bool, error) {
}
```

The `BuildTransaction` function will be called several times, once for each script group and context provided to `CkbTransactionBuilder.Build(contexts ...interface{})`. `CkbTransactionBuilder` will ensure there is at least one context.

The `ScriptHandler` has two main functions. Firstly, it automatically adds cell dependencies for the script. Secondly, it pre-fills the witness to accurately calculate the fee. This is necessary because fee calculation occurs after the `ScriptHandler` is called, but before signing.

[ScriptHandler]: https://github.com/nervosnetwork/ckb-sdk-go/blob/5d229f6489b99fd7fac958675ca68b5b9dba7bb3/collector/interface.go#L21

## Transaction Signer

`TransactionSigner` offers `registerLockSigner` and `registerTypeSigner` to register [ScriptSigner].

```java
func (s *CapacityDiffScriptSigner) SignTransaction(tx *types.Transaction, group *transaction.ScriptGroup, ctx *transaction.Context) (bool, error) {
}
```

The `SignTransaction` is called once for each matched script group and context passed to `TransactionSigner.SignTransaction`. The context type is [Context] which simplifies passing EC key pairs for cryptography signing scripts. However, `CapacityDiff` does not need a key, but it needs to get the input cell details, so the context carries an instance of `CapacityDiffContext` as the payload to provide such information. I believe this is significant limitation. It is unfortunate that the offline script handler has weaker capabilities compared to the online contract, given that the contract can obtain input cell and dep headers through syscalls.

[ScriptSigner]: https://github.com/nervosnetwork/ckb-sdk-go/blob/5d229f6489b99fd7fac958675ca68b5b9dba7bb3/transaction/signer/signer.go#L10
[Context]: https://github.com/nervosnetwork/ckb-sdk-go/blob/5d229f6489b99fd7fac958675ca68b5b9dba7bb3/transaction/context.go#L8

## Issues

-   The interfaces `ScriptHandler` and `ScriptSigner` are lack of documentations on how to implement them.
-   `ScriptSigner` is not able to access cell input details and header deps.
