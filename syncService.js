import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AppState } from 'react-native';
import NetInfo from '@react-native-community/netinfo';
import { randomUUID } from 'expo-crypto';
import {
  confirmOperation, discardOperation, editOperation, enqueue, prepareOperation, readLegacy, readQueue,
  readSnapshot, rejectOperation, saveSnapshot,
} from './storage';
import { createClient, makeWire, migrationMessage, operationError, ownerOf } from './supabase';
import { dashboardView, dateInZone, dependencies, resolveReferences } from './finance';

export async function flushQueue(owner, client, signal, canSend) {
  const queue = await readQueue(owner);
  const operationsById = new Map(queue.map(operation => [operation.id, operation]));
  let madeProgress;
  do {
    madeProgress = false;
    for (const operation of queue) {
      if (signal.aborted || !canSend()) return;
      if (operation.receipt || operation.error) continue;
      if (dependencies(operation.payload).some(id => !operationsById.has(id))) {
        operation.error = 'Um registro vinculado foi removido. Selecione outra conta ou cartão.';
        await rejectOperation(owner, operation.id, operation.error);
        continue;
      }
      const payload = resolveReferences(operation.payload, operationsById);
      if (!payload) continue;
      const wire = operation.wire ?? await makeWire(operation.request_id, payload);
      if (!operation.wire && !await prepareOperation(owner, operation.id, wire)) continue;
      try {
        const receipt = await client.send(wire, signal);
        await confirmOperation(owner, operation.id, receipt);
        operation.receipt = receipt;
        madeProgress = true;
      } catch (problem) {
        if (signal.aborted) return;
        const isRejectedRequest = [400, 409, 422].includes(problem.status) && problem.code !== 'PGRST204';
        if (!isRejectedRequest) {
          if (problem.code === '42501') problem.operationId = operation.id;
          throw problem;
        }
        operation.error = operationError(problem);
        await rejectOperation(owner, operation.id, operation.error);
      }
    }
  } while (madeProgress && queue.some(operation => !operation.receipt && !operation.error));
}

export function useFinance(session, initialAccess) {
  const owner = ownerOf(session);
  const client = useMemo(() => createClient(session, initialAccess), [session, initialAccess]);
  const [month, setMonth] = useState(() => dateInZone().slice(0, 7));
  const selectedMonth = useRef(month);
  const [local, setLocal] = useState({ month, queue: [] });
  const [legacy, setLegacy] = useState([]);
  const [syncing, setSyncing] = useState(false);
  const [online, setOnline] = useState(null);
  const [error, setError] = useState(null);
  const [storeError, setStoreError] = useState(null);
  const lifecycle = useRef(null);
  const connection = useRef(null);
  const syncRequested = useRef(false);
  const retryNeeded = useRef(false);
  const syncTask = useRef(null);
  const localReadVersion = useRef(0);

  const loadLocalData = useCallback(async () => {
    const version = ++localReadVersion.current;
    const target = selectedMonth.current;
    try {
      const { snapshot, fallback } = await readSnapshot(owner, target);
      const queue = await readQueue(owner);
      if (lifecycle.current && version === localReadVersion.current) {
        setLocal({ month: target, snapshot, fallback, queue });
        setStoreError(null);
      }
    } catch {
      if (lifecycle.current && version === localReadVersion.current) {
        setStoreError('Não foi possível abrir o SQLite. Tente novamente.');
      }
    }
  }, [owner]);

  const sync = useCallback(() => {
    syncRequested.current = true;
    if (syncTask.current || connection.current === false || !lifecycle.current) return;
    const signal = lifecycle.current.signal;
    setSyncing(true);
    syncTask.current = (async () => {
      while (syncRequested.current && !signal.aborted && connection.current !== false) {
        syncRequested.current = false;
        try {
          let missingMigration = null;
          try {
            await flushQueue(owner, client, signal, () => connection.current !== false);
          } catch (problem) {
            if (problem.code !== 'PGRST202') throw problem;
            missingMigration = operationError(problem);
          }
          if (signal.aborted || connection.current === false) break;
          const settled = await readQueue(owner);
          const revision = settled.reduce((max, op) => Math.max(max, op.revision ?? 0), 0);
          const target = selectedMonth.current;
          const data = await client.dashboard(target, signal);
          await saveSnapshot(owner, target, revision, data);
          const pendingMigration = missingMigration ?? (data.sincronizacao_disponivel ? null : migrationMessage);
          retryNeeded.current = Boolean(pendingMigration);
          if (!signal.aborted) setError(pendingMigration ? { status: 503, message: pendingMigration } : null);
        } catch (problem) {
          retryNeeded.current = problem.status !== 401;
          if (!signal.aborted) setError({
            status: problem.status,
            operationId: problem.operationId,
            message: problem.status === 401 ? 'Entre novamente para sincronizar.' :
              problem.status === 0 || ['42501', 'PGRST202'].includes(problem.code) ? operationError(problem) :
                'Falha na sincronização. Tente novamente.',
          });
        } finally {
          if (!signal.aborted) await loadLocalData();
        }
      }
    })().finally(() => {
      syncTask.current = null;
      if (lifecycle.current && !lifecycle.current.signal.aborted) {
        setSyncing(false);
        if (syncRequested.current && connection.current !== false) sync();
      }
    });
  }, [client, loadLocalData, owner]);

  useEffect(() => {
    const controller = new AbortController();
    lifecycle.current = controller;
    void loadLocalData();
    readLegacy(session.email).then(records => {
      if (!controller.signal.aborted) setLegacy(records);
    }).catch(() => {});
    const unsubscribe = NetInfo.addEventListener(network => {
      const available = network.isConnected === false || network.isInternetReachable === false ? false : network.isConnected;
      const previous = connection.current;
      connection.current = available;
      setOnline(available);
      if (available === true && previous !== true) sync();
    });
    const foreground = AppState.addEventListener('change', state => {
      if (state === 'active') {
        NetInfo.refresh().catch(() => {});
        sync();
      }
    });
    const retry = setInterval(() => {
      if (retryNeeded.current && AppState.currentState === 'active' && connection.current !== false && !syncTask.current) sync();
    }, 45000);
    return () => {
      controller.abort();
      lifecycle.current = null;
      unsubscribe();
      foreground.remove();
      clearInterval(retry);
    };
  }, [loadLocalData, sync, session.email]);

  function chooseMonth(value) {
    if (value === selectedMonth.current) return;
    selectedMonth.current = value;
    setMonth(value);
    void loadLocalData();
    if (connection.current === true) sync();
  }

  async function save(payload, { operation, legacyId } = {}) {
    const timestamp = operation?.payload.ocorrido_em ?? new Date().toISOString();
    const data = { ...payload, ocorrido_em: timestamp };
    if (operation) await editOperation(owner, operation.id, randomUUID(), data);
    else await enqueue(owner, randomUUID(), data, legacyId);
    await loadLocalData();
    sync();
  }

  async function discard(operation) {
    const queue = await readQueue(owner);
    if (queue.some(op => !op.receipt && dependencies(op.payload).includes(operation.id))) {
      throw new Error('Remova primeiro as operações que dependem deste registro.');
    }
    await discardOperation(owner, operation.id);
    await loadLocalData();
  }

  async function close() {
    lifecycle.current?.abort();
    await syncTask.current;
    await client.waitForRenewal();
  }

  const view = useMemo(() => {
    const exact = local.month === month ? local.snapshot : null;
    const fallback = exact ? null : local.fallback ?? local.snapshot;
    return dashboardView(exact, fallback, month, local.queue);
  }, [local, month]);
  const queue = local.queue.filter(op => !op.receipt);
  const imported = new Set(local.queue.map(op => op.legacy_id).filter(Boolean));
  return {
    month, chooseMonth, view, queue, syncing, online, error, storeError,
    hasSnapshot: local.month === month && Boolean(local.snapshot),
    hasReferences: Boolean(local.snapshot || local.fallback),
    legacy: legacy.filter(item => !imported.has(item.legacyId)),
    save, discard, sync, close,
  };
}

