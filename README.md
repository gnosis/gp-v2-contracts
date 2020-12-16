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

## Deploying contracts

Choose the network and gas price in wei for the deployment.
After replacing these values, run:

```sh
NETWORK='rinkeby'
GAS_PRICE_WEI='1000000000'
yarn deploy --network $NETWORK --gasprice $GAS_PRICE_WEI
```

New files containing details of this deployment will be created in the `deployment` folder.
These files should be committed to this repository.

## Verify Contracts on Etherscan

```
ETHERSCAN_API_KEY=<Your Key>
npx hardhat etherscan-verify --network $NETWORK
```

## Deployed Contract Addresses

This package additonally contains a `networks.json` file at the root with the
address of each deployed contract as well the hash of the Ethereum transaction
used to create the contract.

## Gas Reporter

Gas consumption can be reported using by setting the `REPORT_GAS` flag when running tests as

```sh
REPORT_GAS=1 yarn test
```
