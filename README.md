# One Block Auctions (OBA):

## Building the Project

```sh
yarn
yarn build
```

## Running Tests

```sh
yarn test
```

The tests can be run in "debug mode" as follows:

```sh
DEBUG=* yarn test
```

## Gas consumption

Start a separate test network and keep it running the background:

```sh
yarn testnet
```

Then run the gas reporter:

```sh
yarn gas-reporter
```
