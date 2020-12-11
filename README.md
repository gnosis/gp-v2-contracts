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
INFURA_KEY="Your infura key"
yarn deploy --network $NETWORK --gasprice $GAS_PRICE_WEI
```

New files containing details of this deployment will be created in the `deployment` folder.
These files should be committed to this repository.

In order to verify the contract in Etherscan, run:

```
MY_ETHERSCAN_API_KEY="your key"
npx hardhat verify --network $NETWORK DEPLOYED_CONTRACT_ADDRESS "Constructor argument 1"
```
