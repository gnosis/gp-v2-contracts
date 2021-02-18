#!/bin/bash

set -o nounset
set -o pipefail
set -o errexit

GIT_BRANCH="${1:-""}"

fail_if_unset () {
  VAR_NAME="$1"
  if [[ -z "${!VAR_NAME:-""}" ]]; then
    printf '%s not set\n' "$VAR_NAME" >&2
    exit 1
  fi
}
gwei_to_wei () {
  GWEI="$1"
  printf "%s000000000" "${GWEI}"
}

fail_if_unset "ETHERSCAN_API_KEY"
fail_if_unset "INFURA_KEY"
fail_if_unset "PK"

GAS_PRICE_GWEI_MAINNET="$( \
  curl --silent "https://api.etherscan.io/api?module=gastracker&action=gasoracle&apikey=$ETHERSCAN_API_KEY" \
    | jq -e --raw-output .result.FastGasPrice \
)"
if ! [[ "$GAS_PRICE_GWEI_MAINNET" =~ ^[1-9][0-9]{1,2} ]]; then
  echo "Invalid mainnet gas price $GAS_PRICE_GWEI_MAINNET" >&2
  exit 1
fi

yarn deploy --network rinkeby --gasprice "$(gwei_to_wei 1)"
yarn deploy --network xdai --gasprice "$(gwei_to_wei 1)"
yarn deploy --network mainnet --gasprice "$(gwei_to_wei "$GAS_PRICE_GWEI_MAINNET")"

# wait for Etherscan to register the new contracts on the blockchain
sleep 60

yarn verify --network rinkeby
yarn verify --network mainnet

if [ -n "$GIT_BRANCH" ]; then
  GIT_USERNAME="GitHub Actions"
  GIT_USEREMAIL="GitHub-Actions@GPv2-contracts"
  if ! git config --get user.name &>/dev/null; then
    git config user.name "$GIT_USERNAME"
    git config user.email "$GIT_USEREMAIL"
  fi

  git checkout -b "$GIT_BRANCH"
  git add .
  git commit -m "Deploy latest contract version"
  git push --set-upstream origin "$GIT_BRANCH"
fi
