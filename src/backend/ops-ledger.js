/**
 * ops-ledger.js — Ledger append-only de operaciones atómicas por orquestación.
 */

const fs   = require('fs');
const path = require('path');
const { ensureDir } = require('./config');

function getLedgerPath(projectPath, orchestrationId) {
  return path.join(projectPath, '.agent-hub', 'ops', `${orchestrationId}-ledger.json`);
}

function readLedger(projectPath, orchestrationId) {
  const p = getLedgerPath(projectPath, orchestrationId);
  if (!fs.existsSync(p)) return { ops: [] };
  try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return { ops: [] }; }
}

function appendOps(projectPath, orchestrationId, newOps) {
  const ledgerPath = getLedgerPath(projectPath, orchestrationId);
  ensureDir(path.dirname(ledgerPath));
  const ledger = readLedger(projectPath, orchestrationId);
  ledger.ops.push(...newOps);
  ledger.lastUpdated = new Date().toISOString();
  ledger.projectId   = ledger.projectId || '';
  ledger.orchestrationId = orchestrationId;
  const tmp = ledgerPath + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(ledger, null, 2), 'utf8');
  fs.renameSync(tmp, ledgerPath);
}

function markOpReverted(projectPath, orchestrationId, opId) {
  const ledger = readLedger(projectPath, orchestrationId);
  const op = ledger.ops.find(o => o.id === opId);
  if (!op || op.status === 'reverted') return false;
  op.status     = 'reverted';
  op.revertedAt = new Date().toISOString();
  const ledgerPath = getLedgerPath(projectPath, orchestrationId);
  const tmp = ledgerPath + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(ledger, null, 2), 'utf8');
  fs.renameSync(tmp, ledgerPath);
  return op;
}

module.exports = { readLedger, appendOps, markOpReverted };
