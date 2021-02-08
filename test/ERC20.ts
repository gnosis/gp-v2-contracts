export const NON_STANDARD_ERC20 = [
  "function transfer(address recipient, uint256 amount)",
  "function transferFrom(address sender, address recipient, uint256 amount)",
];

export const ERC20_RETURNING_BYTES = [
  "function transfer(address recipient, uint256 amount) returns (bytes)",
  "function transferFrom(address sender, address recipient, uint256 amount) returns (bytes)",
];

export const ERC20_RETURNING_UINT = [
  "function transfer(address recipient, uint256 amount) returns (uint256)",
  "function transferFrom(address sender, address recipient, uint256 amount) returns (uint256)",
];
