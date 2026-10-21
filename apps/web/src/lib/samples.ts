export const SAMPLE_CHIPS: Record<string, string> = {
  "30cdd41fc24b39fa8b1e47078f17e0b56d4db2c09df44be6f7e484a9f1fc021c": "Ironwood transfer",
  "1bee124c7e0038efff04947cb106b18e75e33ee08a595f1def84f71548319b62": "Orchard to Ironwood",
  "4faf6339572e8097d00b2ea176c5d88908a4ef1dda09cf2f063692e008bc5615": "Sapling payment",
  "a52e4025b46e63a092d74897e9b0a62bbade3317f748a9f668a31d44c8757fdb": "Coinbase reward",
};

export const ERROR_CHIP = {
  label: "Rejected: expired",
  text: "TransactionError::ExpiredTransaction",
  why: "A Zebra error variant name, as it appears in zebra-consensus/src/error.rs and in Zebra's logs.",
};
