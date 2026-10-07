/**
 * @fileoverview Financial-fraud sample scenario (35 objects, 42 links):
 * 8 Customer (owns), 12 Account, 15 Transaction (from, to). Includes
 * high-risk accounts and large flagged transactions for demo alerts.
 *
 * Write order is Account → Customer → Transaction because link targets must
 * exist before their sources (otherwise the upsert rejects with REF_MISSING):
 * Customer owns Account, so Account is written first; Transaction references
 * Account via `from`/`to`, so Account is already present.
 */

import type {Row, SampleDataset} from '../../contract';

const pad = (n: number) => String(n).padStart(3, '0');
const cust = (i: number) => `CUST-${pad(i + 1)}`;
const acc = (i: number) => `ACC-${pad(i + 1)}`;
const txn = (i: number) => `TXN-${pad(i + 1)}`;

// [holderName, type, balance, riskScore, status]
const ACCOUNTS: [string, string, number, number, string][] = [
  ['Zhang Wei', 'personal', 158000, 12, 'active'],
  ['Zhang Wei', 'business', 820000, 28, 'active'],
  ['Li Na', 'personal', 45200, 8, 'active'],
  ['Wang Qiang', 'personal', 9800, 65, 'frozen'],
  ['Wang Qiang', 'business', 1250000, 88, 'frozen'],
  ['Liu Yang', 'personal', 67300, 15, 'active'],
  ['Chen Min', 'personal', 2300, 91, 'closed'],
  ['Zhao Lei', 'business', 2100000, 34, 'active'],
  ['Sun Li', 'personal', 51000, 47, 'active'],
  ['Sun Li', 'business', 430000, 72, 'frozen'],
  ['Zhou Jie', 'personal', 89000, 22, 'active'],
  ['Zhou Jie', 'business', 670000, 55, 'active'],
];

// account index → customer index
const ACC_OWNER = [0, 0, 1, 2, 2, 3, 4, 5, 6, 6, 7, 7];

/** 12 accounts (no links; written first as link targets). */
function accountRows(): Row[] {
  return ACCOUNTS.map(([holder, type, balance, risk, status], i) => ({
    accountId: acc(i),
    holderName: holder,
    type,
    balance,
    riskScore: risk,
    status,
  }));
}

const CUSTOMERS: [string, string, string][] = [
  ['Zhang Wei', 'zhang.wei@email.com', 'verified'],
  ['Li Na', 'li.na@email.com', 'verified'],
  ['Wang Qiang', 'wang.qiang@email.com', 'pending'],
  ['Liu Yang', 'liu.yang@email.com', 'verified'],
  ['Chen Min', 'chen.min@email.com', 'rejected'],
  ['Zhao Lei', 'zhao.lei@email.com', 'verified'],
  ['Sun Li', 'sun.li@email.com', 'pending'],
  ['Zhou Jie', 'zhou.jie@email.com', 'verified'],
];

/** 8 customers, each owning their accounts via `owns`. */
function customerRows(): Row[] {
  return CUSTOMERS.map(([name, email, kyc], i) => {
    const owned = ACC_OWNER.map((owner, accIdx) =>
      owner === i ? acc(accIdx) : null,
    ).filter((x): x is string => x !== null);
    return {
      customerId: cust(i),
      name,
      email,
      kycStatus: kyc,
      accounts: owned.join(';'),
    };
  });
}

const TXNS: [number, number, number, string, string, boolean][] = [
  // [fromAccIdx, toAccIdx, amount, currency, status, flagged]
  [0, 1, 5000, 'CNY', 'completed', false],
  [2, 5, 1200, 'CNY', 'completed', false],
  [3, 7, 280000, 'CNY', 'completed', true],
  [4, 9, 750000, 'CNY', 'pending', true],
  [5, 2, 3000, 'CNY', 'completed', false],
  [6, 10, 150000, 'CNY', 'completed', true],
  [7, 11, 42000, 'CNY', 'completed', false],
  [8, 3, 18000, 'CNY', 'failed', false],
  [9, 4, 320000, 'USD', 'pending', true],
  [10, 0, 9000, 'CNY', 'completed', false],
  [11, 7, 150000, 'CNY', 'completed', false],
  [1, 6, 600, 'CNY', 'completed', false],
  [4, 8, 95000, 'CNY', 'completed', true],
  [3, 5, 2200, 'CNY', 'failed', false],
  [10, 2, 110000, 'CNY', 'pending', true],
];

/** 15 transactions with from/to links to accounts. */
function transactionRows(): Row[] {
  return TXNS.map(([fromIdx, toIdx, amount, currency, status, flagged], i) => ({
    txnId: txn(i),
    fromAccount: acc(fromIdx),
    toAccount: acc(toIdx),
    amount,
    currency,
    status,
    flagged,
  }));
}

export function financialFraudDatasets(): SampleDataset[] {
  return [
    {
      file: 'accounts.csv',
      rows: accountRows(),
      mapping: {
        targetType: 'Account',
        primaryKey: {from: 'accountId', transform: 'trim'},
        fields: [
          {to: 'accountId', from: 'accountId', transform: 'trim'},
          {to: 'holderName', from: 'holderName', transform: 'trim'},
          {to: 'type', from: 'type', transform: 'trim|lower'},
          {to: 'balance', from: 'balance', transform: 'trim|toNumber'},
          {to: 'riskScore', from: 'riskScore', transform: 'trim|toNumber'},
          {to: 'status', from: 'status', transform: 'trim|lower'},
        ],
      },
    },
    {
      file: 'customers.csv',
      rows: customerRows(),
      mapping: {
        targetType: 'Customer',
        primaryKey: {from: 'customerId', transform: 'trim'},
        fields: [
          {to: 'customerId', from: 'customerId', transform: 'trim'},
          {to: 'name', from: 'name', transform: 'trim'},
          {to: 'email', from: 'email', transform: 'trim'},
          {to: 'kycStatus', from: 'kycStatus', transform: 'trim|lower'},
        ],
        links: [
          {type: 'owns', toType: 'Account', toKey: 'accounts', split: ';'},
        ],
      },
    },
    {
      file: 'transactions.csv',
      rows: transactionRows(),
      mapping: {
        targetType: 'Transaction',
        primaryKey: {from: 'txnId', transform: 'trim'},
        fields: [
          {to: 'txnId', from: 'txnId', transform: 'trim'},
          {to: 'fromAccount', from: 'fromAccount', transform: 'trim'},
          {to: 'toAccount', from: 'toAccount', transform: 'trim'},
          {to: 'amount', from: 'amount', transform: 'trim|toNumber'},
          {to: 'currency', from: 'currency', transform: 'trim|upper'},
          {to: 'status', from: 'status', transform: 'trim|lower'},
          {to: 'flagged', from: 'flagged', transform: 'trim|toBoolean'},
        ],
        links: [
          {type: 'from', toType: 'Account', toKey: 'fromAccount', split: ';'},
          {type: 'to', toType: 'Account', toKey: 'toAccount', split: ';'},
        ],
      },
    },
  ];
}
