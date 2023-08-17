# Custom Script Example

This example demonstrates how to use a custom script [CapacityDiff](https://github.com/doitian/ckb-sdk-examples-capacity-diff).

CapacityDiff verifies the witness matches the capacity difference.

-   The script loads the witness for the first input in the script group using the WitnessArgs layout.
-   The total input capacity is the sum of all the input cells in the script group.
-   The total output capacity is the sum of all the output cells having the same lock script as the script group.
-   The capacity difference is a 64-bit signed integer which equals to total output capacity minus total input capacity.
-   The witness is encoded using two's complement and little endian.

## Examples

-   [Java](README.java.md)
-   [Lumos (JavaScript)](README.js.md)
-   [Golang](README.go.md)
