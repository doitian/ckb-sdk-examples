all: js go java rust

js:
	pnpm test

go:
	go test -v ./...

java:
	gradle test

rust:
	cargo run --example 2>&1 | grep -E '^ ' | xargs -n1 cargo run --example

.PHONY: all js go java rust
