all: js go

js:
	pnpm test

go:
	go test -v ./...

.PHONY: all js go
