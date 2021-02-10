# Gnosis Protocol V2

This repository contains the Solidity smart contract code for the Gnosis Protocol version 2.
For more documentation on how the protocol works on a smart contract level, see the [documentation pages](docs/index.md).

## Getting Started

### Building the Project

```sh
yarn
yarn build
```

### Running Tests

```sh
yarn test
```

The tests can be run in "debug mode" as follows:

```sh
DEBUG=* yarn test
```

### Gas Reporter

Gas consumption can be reported by setting the `REPORT_GAS` flag when running tests as

```sh
REPORT_GAS=1 yarn test
```

### Benchmarking

This repository additionally includes tools for gas benchmarking and tracing.

In order to run a gas benchmark on a whole bunch of settlement scenarios:

```sh
yarn bench
```

These gas benchmarks can be compared against any other git reference and will default to the merge-base if omitted:

```sh
yarn bench:compare [<ref>]
```

In order to get a detailed trace of a settlement to identify how much gas is being spent where:

```sh
yarn bench:trace
```

## Deployment

### Deploying contracts

Choose the network and gas price in wei for the deployment.
After replacing these values, run:

```sh
NETWORK='rinkeby'
GAS_PRICE_WEI='1000000000'
yarn deploy --network $NETWORK --gasprice $GAS_PRICE_WEI
```

New files containing details of this deployment will be created in the `deployment` folder.
These files should be committed to this repository.

### Verify Contracts on Etherscan

```sh
ETHERSCAN_API_KEY=<Your Key>
yarn verify --network $NETWORK
```

### Deployed Contract Addresses

This package additionally contains a `networks.json` file at the root with the address of each deployed contract as well the hash of the Ethereum transaction used to create the contract.

### Solver Authentication

This repo contains scripts to manage the list of authenticated solvers in all networks the contract has been deployed.

The scripts are called with:

```sh
yarn solvers command [arg ...]
```

Here is a list of available commands.
The commands flagged with [*] require the private key of the authentication contract owner to be available to the script, for example by exporting it with `export PK=<private key>`.

1. `add $ADDRESS` [*]. Adds the address to the list of registered solvers.
2. `remove $ADDRESS` [*]. Removes the address from the list of registered solvers.
3. `check $ADDRESS`. Checks if the given address is in the list of registered solvers.

For example, adding the address `0x0000000000000000000000000000000000000042` to the solver list:

```sh
export PK=<private key>
yarn solvers add 0x0000000000000000000000000000000000000042
```
