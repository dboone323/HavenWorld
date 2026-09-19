export class ItemNotFoundError extends Error {
  constructor(message = 'Item not found') {
    super(message);
    this.name = 'ItemNotFoundError';
  }
}

export class InsufficientFundsError extends Error {
  constructor(message = 'Insufficient funds') {
    super(message);
    this.name = 'InsufficientFundsError';
  }
}

export class InsufficientMaterialsError extends Error {
  constructor(message = 'Insufficient materials for crafting') {
    super(message);
    this.name = 'InsufficientMaterialsError';
  }
}

export class CraftNotReadyError extends Error {
  constructor(message = 'Craft is not yet ready to claim') {
    super(message);
    this.name = 'CraftNotReadyError';
  }
}
