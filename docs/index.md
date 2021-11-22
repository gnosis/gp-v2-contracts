# Gnosis Protocol V2 Smart Contracts

- [Architecture](architecture.md)

## Threat Model

Our set of contracts has an owner and multiple solvers. The owner is trusted (a DAO). The solvers could be unknown addresses: anyone can become a solver by staking some money. The owner is always able to withdraw the staked money at any time if the solver misbehaves. This means that the solvers should be considered untrusted while auditing the contract.
Example of misbehaving is for example withdrawing all the fees from the settlement contract. This is considered to be ok since we are supposed to withdraw from the contract when the fee amount becomes too large.
Of the logic I just described, only the solver/owner role appears in the contract, the DAO and the staking part will be implemented in a different contract in the future. Additionally, the staked amount to become a solver is not yet set, but it's supposed to be fairly large (>50kUSD, but probably <1M).
