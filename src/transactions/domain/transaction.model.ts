export enum TransactionStatus {
  PENDING = 'PENDING',
  SUBMITTED = 'SUBMITTED',
  CONFIRMED = 'CONFIRMED',
  FAILED = 'FAILED',
}

const ALLOWED_TRANSITIONS: Record<TransactionStatus, TransactionStatus[]> = {
  [TransactionStatus.PENDING]: [
    TransactionStatus.SUBMITTED,
    TransactionStatus.CONFIRMED,
    TransactionStatus.FAILED,
  ],
  [TransactionStatus.SUBMITTED]: [
    TransactionStatus.CONFIRMED,
    TransactionStatus.FAILED,
  ],
  // Terminal states: no outgoing transitions.
  [TransactionStatus.CONFIRMED]: [],
  [TransactionStatus.FAILED]: [],
};

/**
 * Returns true when a transaction may move from `from` to `to`.
 * Terminal states (CONFIRMED, FAILED) cannot be left.
 */
export function canTransitionTransactionStatus(
  from: TransactionStatus,
  to: TransactionStatus,
): boolean {
  return ALLOWED_TRANSITIONS[from]?.includes(to) ?? false;
}

export interface Transaction {
  id: string;
  walletId: string;
  senderWalletId: string;
  amount: string;
  assetCode: string;
  assetType: string;
  status: TransactionStatus;
  memo?: string;
  createdAt: Date;
  updatedAt: Date;
}
