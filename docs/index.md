# Gnosis Protocol V2 Smart Contracts

- [Architecture](architecture.md)

## Threat Model

Our contracts have an owner and multiple solvers. The owner is trusted (a DAO). The solvers could be unknown addresses: anyone can become a solver by staking some money. The owner is always able to withdraw the staked money at any time if the solver misbehaves. This means that the solvers should be considered partially untrusted by the contract.
Example of a solver misbehaving is for example withdrawing all the fees from the settlement contract. We account for this misbehavior in that we withdraw from the contract when the fee amount becomes larger than the staked amount.
Of this logic, only the solver/owner roles appear in the contract, the DAO and the staking part will be implemented in a different contract in the future. Additionally, the staked amount to become a solver is not yet set, but it's supposed to be fairly large (>50kUSD, but probably <1M).
