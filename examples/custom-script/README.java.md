# Custom Script Example - Java

[Full Example](CustomScriptTest.java)

The JAVA SDK provides two tools for transaction handling: [CkbTransactionBuilder] for building transactions, and [TransactionSigner] for signing them. Both of them supports registering handlers for custom scripts.

[CkbTransactionBuilder]: https://github.com/nervosnetwork/ckb-sdk-java/blob/master/ckb/src/main/java/org/nervos/ckb/transaction/CkbTransactionBuilder.java
[TransactionSigner]: https://github.com/nervosnetwork/ckb-sdk-java/blob/master/core/src/main/java/org/nervos/ckb/sign/TransactionSigner.java

## Transaction Builder

The `CkbTransactionBuilder` can register `ScriptHandler`s for both type scripts and lock scripts through [TransactionBuilderConfiguration]. Upon calling `CkbTransactionBuilder#build`, the builder will sequentially execute the `Scripthandler#buildTransaction` method of all registered handlers.

```java
public boolean buildTransaction(AbstractTransactionBuilder txBuilder, ScriptGroup scriptGroup, Object context);
```

The `buildTransaction` function will be called several times, once for each script group and context provided to `CkbTransactionBuilder#build(Object...)`. The `CkbTransactionBuilder#build()` function acts as a wrapper, allowing for only one context to be passed - null.

The `ScriptHandler` has two main functions. Firstly, it automatically adds cell dependencies for the script. Secondly, it pre-fills the witness to accurately calculate the fee. This is necessary because fee calculation occurs after the `ScriptHandler` is called, but before signing.

[TransactionBuilderConfiguration]: https://github.com/nervosnetwork/ckb-sdk-java/blob/master/ckb/src/main/java/org/nervos/ckb/transaction/TransactionBuilderConfiguration.java
[ScriptHandler]: https://github.com/nervosnetwork/ckb-sdk-java/blob/master/ckb/src/main/java/org/nervos/ckb/transaction/handler/ScriptHandler.java

## Transaction Signer

`TransactionSigner` offers `registerLockScriptSigner` and `registerTypeScriptSigner` to register [ScriptSigner].

```java
boolean signTransaction(Transaction transaction, ScriptGroup scriptGroup, Context context);
```

The `signTransaction` is called once for each matched script group and context passed to `TransactionSigner#signTransaction`. The context type is [Context] which simplifies passing EC key pairs for cryptography signing scripts. However, `CapacityDiff` does not need a key, but it needs to get the input cell details, so the context carries an instance of `CapacityDiffContext` as the payload to provide such information. I believe this is significant limitation. It is unfortunate that the offline script handler has weaker capabilities compared to the online contract, given that the contract can obtain input cell and dep headers through syscalls.

[ScriptSigner]: https://github.com/nervosnetwork/ckb-sdk-java/blob/master/core/src/main/java/org/nervos/ckb/sign/ScriptSigner.java
[Context]: https://github.com/nervosnetwork/ckb-sdk-java/blob/master/core/src/main/java/org/nervos/ckb/sign/Context.java

## Issues

-   The interfaces `ScriptHandler` and `ScriptSigner` are lack of Javadoc documentations.
-   `ScriptSigner` is not able to access cell input details and header deps.
-   `Api` does not expose the method to call an arbitrary RPC method.
