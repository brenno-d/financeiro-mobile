import AsyncStorage from '@react-native-async-storage/async-storage';
import { openDatabaseAsync } from 'expo-sqlite';

let database;

function openLocalDatabase() {
  database ??= openDatabaseAsync('financas.db').then(async db => {
    await db.execAsync(`
      PRAGMA journal_mode = WAL;
      CREATE TABLE IF NOT EXISTS snapshots (
        owner TEXT NOT NULL, month TEXT NOT NULL, revision INTEGER NOT NULL,
        data TEXT NOT NULL, PRIMARY KEY (owner, month)
      );
      CREATE TABLE IF NOT EXISTS operations (
        position INTEGER PRIMARY KEY AUTOINCREMENT,
        owner TEXT NOT NULL, id TEXT NOT NULL, request_id TEXT NOT NULL,
        payload TEXT NOT NULL, wire TEXT, receipt TEXT, revision INTEGER,
        error TEXT, legacy_id TEXT, UNIQUE (owner, id), UNIQUE (owner, legacy_id)
      );
      CREATE INDEX IF NOT EXISTS operations_owner ON operations (owner, position);
    `);
    return db;
  }).catch(error => {
    database = undefined;
    throw error;
  });
  return database;
}

function decodeSnapshot(row) {
  return row && {
    ...row,
    data: JSON.parse(row.data),
  };
}

export async function readSnapshot(owner, month) {
  const db = await openLocalDatabase();
  const snapshot = await db.getFirstAsync('SELECT * FROM snapshots WHERE owner = ? AND month = ?', owner, month);
  const fallback = snapshot ? null : await db.getFirstAsync(
    'SELECT * FROM snapshots WHERE owner = ? ORDER BY revision DESC, month DESC LIMIT 1', owner,
  );
  return { snapshot: decodeSnapshot(snapshot), fallback: decodeSnapshot(fallback) };
}

export async function saveSnapshot(owner, month, revision, data) {
  const db = await openLocalDatabase();
  await db.runAsync(
    'INSERT OR REPLACE INTO snapshots (owner, month, revision, data) VALUES (?, ?, ?, ?)',
    owner, month, revision, JSON.stringify(data),
  );
}

export async function readQueue(owner) {
  const db = await openLocalDatabase();
  const rows = await db.getAllAsync('SELECT * FROM operations WHERE owner = ? ORDER BY position', owner);
  return rows.map(row => ({
    ...row,
    payload: JSON.parse(row.payload),
    wire: row.wire && JSON.parse(row.wire),
    receipt: row.receipt && JSON.parse(row.receipt),
  }));
}

export async function enqueue(owner, id, payload, legacyId = null) {
  const db = await openLocalDatabase();
  await db.runAsync(
    'INSERT INTO operations (owner, id, request_id, payload, legacy_id) VALUES (?, ?, ?, ?, ?)',
    owner, id, id, JSON.stringify(payload), legacyId,
  );
}

export async function prepareOperation(owner, id, wire) {
  const db = await openLocalDatabase();
  const result = await db.runAsync(
    'UPDATE operations SET wire = ? WHERE owner = ? AND id = ? AND wire IS NULL AND receipt IS NULL AND error IS NULL',
    JSON.stringify(wire), owner, id,
  );
  return result.changes > 0;
}

export async function confirmOperation(owner, id, receipt) {
  const db = await openLocalDatabase();
  await db.runAsync(
    `UPDATE operations SET receipt = ?, error = NULL, revision =
      (SELECT COALESCE(MAX(revision), 0) + 1 FROM operations WHERE owner = ?)
      WHERE owner = ? AND id = ? AND receipt IS NULL`,
    JSON.stringify(receipt), owner, owner, id,
  );
}

export async function rejectOperation(owner, id, message) {
  const db = await openLocalDatabase();
  await db.runAsync(
    'UPDATE operations SET error = ? WHERE owner = ? AND id = ? AND receipt IS NULL', message, owner, id,
  );
}

export async function editOperation(owner, id, requestId, payload) {
  const db = await openLocalDatabase();
  const result = await db.runAsync(
    `UPDATE operations SET request_id = ?, payload = ?, wire = NULL, error = NULL
      WHERE owner = ? AND id = ? AND receipt IS NULL AND error IS NOT NULL`,
    requestId, JSON.stringify(payload), owner, id,
  );
  if (!result.changes) throw new Error('Esta operação já está em processamento. Atualize a fila.');
}

export async function discardOperation(owner, id) {
  const db = await openLocalDatabase();
  const result = await db.runAsync(
    'DELETE FROM operations WHERE owner = ? AND id = ? AND receipt IS NULL AND (wire IS NULL OR error IS NOT NULL)',
    owner, id,
  );
  if (!result.changes) throw new Error('Aguarde a confirmação da sincronização desta operação.');
}

const legacyUser = '@usuario_cadastrado';

export async function removeLegacyPassword() {
  const raw = await AsyncStorage.getItem(legacyUser);
  if (!raw) return;
  const profile = JSON.parse(raw);
  if (profile && Object.hasOwn(profile, 'senha')) {
    delete profile.senha;
    await AsyncStorage.setItem(legacyUser, JSON.stringify(profile));
  }
}

export async function readLegacy(email) {
  const pairs = await AsyncStorage.multiGet([legacyUser, '@sistema_entradas', '@sistema_saidas']);
  const profile = JSON.parse(pairs[0][1] ?? 'null');
  if (profile?.email?.trim().toLowerCase() !== email?.toLowerCase()) return [];
  return ['entrada', 'saida'].flatMap((acao, index) => {
    const records = JSON.parse(pairs[index + 1][1] ?? '[]');
    return Array.isArray(records) ? records.map((record, i) => ({
      ...record, acao, legacyId: acao + ':' + (record.id ?? '') + ':' + i,
    })) : [];
  });
}

