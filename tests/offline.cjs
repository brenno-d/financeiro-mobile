const assert = require('node:assert/strict');
const { test } = require('node:test');
const { createHash, randomUUID } = require('node:crypto');
const { mkdtempSync, readFileSync, rmSync } = require('node:fs');
const { tmpdir } = require('node:os');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const babel = require('@babel/core');

const root = path.resolve(__dirname, '..');
const project = 'https://financas-teste.supabase.co';
const month = '2026-11';
const time = '2026-11-25T18:00:00.000Z';
process.env.EXPO_PUBLIC_SUPABASE_URL = project;
process.env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_teste';

function loadApp(directory, secrets, oldStorage = new Map()) {
  const databases = [];
  const cache = new Map();
  const mocks = {
    react: {},
    'react-native': {},
    '@react-native-community/netinfo': {},
    '@react-native-async-storage/async-storage': {
      async getItem(key) { return oldStorage.get(key) ?? null; },
      async setItem(key, value) { oldStorage.set(key, value); },
      async multiGet(keys) { return keys.map(key => [key, oldStorage.get(key) ?? null]); },
    },
    'expo-secure-store': {
      async getItemAsync(key) { return secrets.get(key) ?? null; },
      async setItemAsync(key, value) { secrets.set(key, value); },
      async deleteItemAsync(key) { secrets.delete(key); },
    },
    'expo-crypto': {
      randomUUID,
      CryptoDigestAlgorithm: { SHA256: 'sha256' },
      async digestStringAsync(algorithm, value) { return createHash(algorithm).update(value).digest('hex'); },
    },
    'expo-sqlite': {
      async openDatabaseAsync(name) {
        const connection = new DatabaseSync(path.join(directory, name));
        databases.push(connection);
        return {
          async execAsync(sql) { return connection.exec(sql); },
          async runAsync(sql, ...args) { return connection.prepare(sql).run(...args); },
          async getFirstAsync(sql, ...args) { return connection.prepare(sql).get(...args) ?? null; },
          async getAllAsync(sql, ...args) { return connection.prepare(sql).all(...args); },
        };
      },
    },
  };

  function load(name) {
    const filename = path.resolve(root, path.extname(name) ? name : name + '.js');
    if (path.extname(filename) === '.json') return require(filename);
    if (!cache.has(filename)) {
      const content = readFileSync(filename, 'utf8');
      const { code } = babel.transformSync(content, {
        babelrc: false, configFile: false,
        plugins: ['@babel/plugin-transform-modules-commonjs'],
      });
      const module = { exports: {} };
      cache.set(filename, module);
      const imports = key => key.startsWith('.') ? load(path.resolve(path.dirname(filename), key)) : mocks[key];
      new Function('require', 'module', 'exports', code)(imports, module, module.exports);
    }
    return cache.get(filename).exports;
  }

  return { load, close: () => databases.forEach(db => db.close()) };
}

test('fila sobrevive ao reinício, resolve contas locais e repete o mesmo pedido após perda do recibo', async t => {
  const directory = mkdtempSync(path.join(tmpdir(), 'financas-offline-'));
  const secrets = new Map();
  const old = new Map([
    ['@usuario_cadastrado', JSON.stringify({ email: 'ana@example.com', senha: 'local-antiga' })],
    ['@sistema_entradas', JSON.stringify([{ id: '21', descricao: 'Receita antiga' }])],
  ]);
  let app = loadApp(directory, secrets, old);
  t.after(() => { app.close(); rmSync(directory, { recursive: true, force: true }); });
  const owner = project + '|ana';
  let db = app.load('storage');
  await db.removeLegacyPassword();
  assert.equal(JSON.parse(old.get('@usuario_cadastrado')).senha, undefined);
  assert.equal((await db.readLegacy('ana@example.com')).length, 1);
  assert.equal((await db.readLegacy('outra@example.com')).length, 0);
  await db.saveSnapshot(owner, month, 0, { mes: month, contas: [], historico_saidas: [] });

  const account = randomUUID();
  const expense = randomUUID();
  const pay = randomUUID();
  await db.enqueue(owner, account, { acao: 'conta', nome: 'Carteira', id_tipo_conta: 1, saldo: '0.00', ocorrido_em: time });
  await db.enqueue(owner, expense, {
    acao: 'saida', descricao: 'Compra', data: '2026-11-25', vencimento: '2026-11-25',
    valor: '10.00', id_conta_usuario: 'local:' + account + ':id', id_categoria: 1,
    id_forma_pagamento: 1, frequencia: 'parcelada', parcelas: 3, ocorrido_em: time,
  });
  await db.enqueue(owner, pay, { acao: 'pagar', id: 'local:' + expense + ':0', ocorrido_em: time });
  const signal = new AbortController().signal;
  let calls = 0;
  await app.load('syncService').flushQueue(owner, { async send() { calls++; } }, signal, () => false);
  assert.equal(calls, 0);
  app.close();

  app = loadApp(directory, secrets, old);
  db = app.load('storage');
  const finance = app.load('finance');
  const { snapshot } = await db.readSnapshot(owner, month);
  const view = finance.dashboardView(snapshot, null, month, await db.readQueue(owner), '2026-11-25');
  assert.equal(view.contas[0].nm_conta_usuario, 'Carteira');
  assert.equal(view.saidas[0].vl_saida, '3.34');
  assert.equal(view.saidas[0].ic_pago, true);
  assert.equal(view.saidas[0].localPending, true);
  assert.equal((await db.readQueue('conta-alheia')).length, 0);

  const effects = new Map();
  const sent = [];
  const client = {
    async send(wire) {
      sent.push(wire);
      if (effects.has(wire.p_operacao)) return effects.get(wire.p_operacao);
      if (wire.p_operacao === account) {
        effects.set(account, { id: 42 });
        throw Object.assign(new Error('resposta perdida'), { status: 0 });
      }
      if (wire.p_operacao === expense) {
        assert.equal(wire.p_acao, 'tb_saidas');
        assert.deepEqual(wire.p_dados.map(r => r.id_conta_usuario), [42, 42, 42]);
        assert.deepEqual(wire.p_dados.map(r => r.vl_saida), ['3.34', '3.33', '3.33']);
        effects.set(expense, { id: 51, ids: [51, 52, 53] });
        return effects.get(expense);
      }
      assert.equal(wire.p_dados.id, 51);
      effects.set(pay, { id: 51 });
      return effects.get(pay);
    },
  };

  const { flushQueue } = app.load('syncService');
  await assert.rejects(flushQueue(owner, client, signal, () => true), /resposta perdida/);
  const pending = await db.readQueue(owner);
  assert.deepEqual(pending[0].wire, sent[0]);
  assert.equal(pending[0].receipt, null);
  await assert.rejects(db.discardOperation(owner, account), /Aguarde/);
  await flushQueue(owner, client, signal, () => true);
  assert.deepEqual(sent[0], sent[1]);
  assert.equal(effects.size, 3);
  assert.deepEqual((await db.readQueue(owner)).map(op => op.revision), [1, 2, 3]);

  const reflected = { ...snapshot.data, contas: [{ cd_conta_usuario: 42, nm_conta_usuario: 'Carteira' }],
    historico_saidas: [{ cd_saida: 51, dt_saida: '2026-11-25', ic_pago: true }] };
  const fresh = finance.dashboardView({ data: reflected, revision: 3 }, null, month, await db.readQueue(owner), '2026-11-25');
  assert.equal(fresh.historico_saidas.length, 1);
  assert.equal(fresh.historico_saidas[0].localPending, undefined);
});

test('uma rejeição pode ser corrigida e não impede registros independentes', async t => {
  const directory = mkdtempSync(path.join(tmpdir(), 'financas-rejeicao-'));
  const app = loadApp(directory, new Map());
  t.after(() => { app.close(); rmSync(directory, { recursive: true, force: true }); });
  const db = app.load('storage');
  const { flushQueue } = app.load('syncService');
  const owner = 'ana';
  const id = randomUUID();
  const other = randomUUID();
  const payload = { acao: 'meta', nome: 'Meta', id_categoria_saida: 1, mes: month, valor: '50.00', ocorrido_em: time };
  await db.enqueue(owner, id, payload);
  await db.enqueue(owner, other, payload);
  const client = { async send(wire) {
    if (wire.p_operacao === id) throw Object.assign(new Error('conflito'), { status: 409, code: '23505' });
    return { id: wire.p_operacao === other ? 3 : 4 };
  } };
  const signal = new AbortController().signal;
  await flushQueue(owner, client, signal, () => true);
  let ops = await db.readQueue(owner);
  assert.match(ops[0].error, /Já existe/);
  assert.equal(ops[1].receipt.id, 3);
  const edited = randomUUID();
  await db.editOperation(owner, id, edited, { ...payload, nome: 'Corrigida' });
  await flushQueue(owner, client, signal, () => true);
  ops = await db.readQueue(owner);
  assert.equal(ops[0].receipt.id, 4);
  assert.equal(ops[0].request_id, edited);
  assert.equal(ops[0].wire.p_dados[0].nm_meta_gasto, 'Corrigida');
});

test('o erro 42501 identifica a receita e mantém a mesma operação pendente para reenvio', async t => {
  const directory = mkdtempSync(path.join(tmpdir(), 'financas-permissao-'));
  const app = loadApp(directory, new Map());
  t.after(() => { app.close(); rmSync(directory, { recursive: true, force: true }); });
  const db = app.load('storage');
  const { flushQueue } = app.load('syncService');
  const { createClient, operationError } = app.load('supabase');
  const id = randomUUID();
  const owner = 'ana';
  await db.enqueue(owner, id, {
    acao: 'entrada', descricao: 'Venda', data: '2026-11-25', ocorrido_em: time, valor: '20.00',
    id_conta_usuario: 1, id_categoria: 2, frequencia: 'unica',
  });

  const backendMessage = 'permission denied for table tb_entradas';
  const requests = [];
  t.mock.method(globalThis, 'fetch', async (uri, options) => {
    assert.equal(uri, project + '/rest/v1/rpc/fn_sincronizar_financas');
    requests.push(JSON.parse(options.body));
    if (requests.length === 1) {
      return Response.json({ message: backendMessage, code: '42501' }, { status: 403 });
    }
    return Response.json({ id: 42, ids: [42] });
  });
  const client = createClient({ id: 'ana' }, { token: 'jwt-test', expires: Date.now() + 3600000 });
  const signal = new AbortController().signal;

  await assert.rejects(flushQueue(owner, client, signal, () => true), error => {
    assert.equal(error.status, 403);
    assert.equal(error.operationId, id);
    assert.match(operationError(error), /42501.*permission denied for table tb_entradas/);
    return true;
  });
  const [pending] = await db.readQueue(owner);
  assert.equal(pending.receipt, null);
  assert.equal(pending.error, null);
  assert.equal(pending.payload.descricao, 'Venda');
  assert.deepEqual(pending.wire, requests[0]);

  await flushQueue(owner, client, signal, () => true);
  assert.deepEqual(requests[0], requests[1]);
  assert.equal((await db.readQueue(owner))[0].receipt.id, 42);
});

test('a previsão do saldo inclui só receitas locais que já venceram', t => {
  const app = loadApp(tmpdir(), new Map());
  t.after(app.close);
  const { dashboardView } = app.load('finance');
  const account = { cd_conta_usuario: 1, vl_saldo_conta_usuario: '100.00' };
  const snapshot = { revision: 0, data: { contas: [account], fixas_entrada: [{
    cd_entrada_fixa: 6, dt_inicio: '2026-10-03', id_conta_usuario: 1,
    ds_motivo_entrada: 'Aluguel', id_categoria_entrada: 2, vl_entrada: '40.00',
  }] } };
  const payload = { acao: 'entrada', descricao: 'Venda', data: '2026-11-25', ocorrido_em: time,
    id_conta_usuario: 1, id_categoria: 2, valor: '10.01', frequencia: 'parcelada', parcelas: 2 };
  const installment = { id: 'venda', payload };
  const scheduled = { id: 'amanha', payload: { ...payload, data: '2026-11-26', frequencia: 'unica' } };
  const recurring = { id: 'aluguel', payload: { acao: 'receber_entrada_fixa', id: 6, mes: month, ocorrido_em: time } };
  const view = dashboardView(snapshot, null, month, [installment, scheduled, recurring], '2026-11-25');

  assert.equal(view.movimentacoesSaldoPendentes.get(1), 4501);
  assert.equal(view.contas[0].vl_saldo_conta_usuario, '100.00');

  const confirmed = { ...installment, revision: 1, receipt: { id: 71, ids: [71, 72] } };
  const staleBalance = dashboardView(snapshot, null, month, [confirmed], '2026-11-25');
  assert.equal(staleBalance.movimentacoesSaldoPendentes.get(1), 501);

  const confirmedSnapshot = { revision: 1, data: { ...snapshot.data, contas: [{ ...account, vl_saldo_conta_usuario: '105.01' }] } };
  const afterSync = dashboardView(confirmedSnapshot, null, month, [confirmed, scheduled, recurring], '2026-11-25');
  assert.equal(afterSync.movimentacoesSaldoPendentes.get(1), 4000);
  assert.equal(afterSync.contas[0].vl_saldo_conta_usuario, '105.01');
});

test('estimativa debita pagamentos e movimenta as duas contas de uma transferência efetivada', t => {
  const app = loadApp(tmpdir(), new Map());
  t.after(app.close);
  const { dashboardView } = app.load('finance');
  const snapshot = { revision: 0, data: {
    contas: [{ cd_conta_usuario: 1, vl_saldo_conta_usuario: '100.00' }, { cd_conta_usuario: 2, vl_saldo_conta_usuario: '20.00' }],
    pendentes: [{ cd_saida: 12, id_conta_usuario: 1, vl_saida: '11.00', dt_saida: '2026-11-03', ic_pago: false }],
    fixas: [{ cd_saida_fixa: 3, id_conta_usuario: 1, nm_saida_fixa: 'Internet',
      dt_inicio: '2026-10-01', dt_dia_saida_fixa: 7, vl_saida_fixa: '5.00' }],
  } };
  const transfer = { id: 'transferencia', payload: { acao: 'transferencia', data: '2026-11-25', valor: '30.00',
    id_conta_origem: 1, id_conta_destino: 2, ocorrido_em: time } };
  const future = { id: 'futura', payload: { ...transfer.payload, data: '2026-11-26', valor: '6.00' } };
  const expense = { id: 'parcelada', payload: { acao: 'saida', descricao: 'Compra', data: '2026-11-25',
    vencimento: '2026-11-25', ocorrido_em: time, id_conta_usuario: 1, id_categoria: 2,
    id_forma_pagamento: 1, valor: '20.01', frequencia: 'parcelada', parcelas: 2, pago: true } };
  const unpaid = { id: 'aberta', payload: { ...expense.payload, pago: false, frequencia: 'unica' } };
  const payment = { id: 'pagamento', payload: { acao: 'pagar', id: 12, ocorrido_em: time } };
  const fixed = { id: 'fixa', payload: { acao: 'pagar_fixa', id: 3, mes: month, ocorrido_em: time } };
  const operations = [transfer, future, expense, unpaid, payment, fixed];
  const before = dashboardView(snapshot, null, month, operations, '2026-11-25');
  assert.equal(before.movimentacoesSaldoPendentes.get(1), -5601);
  assert.equal(before.movimentacoesSaldoPendentes.get(2), 3000);

  const after = dashboardView({ revision: 1, data: { ...snapshot.data, contas: [
    { cd_conta_usuario: 1, vl_saldo_conta_usuario: '70.00' }, { cd_conta_usuario: 2, vl_saldo_conta_usuario: '50.00' },
  ] } }, null, month, [{ ...transfer, receipt: { id: 10 }, revision: 1 }, ...operations.slice(1)], '2026-11-25');
  assert.equal(after.movimentacoesSaldoPendentes.get(1), -2601);
  assert.equal(after.movimentacoesSaldoPendentes.has(2), false);

  const older = { ...expense, payload: {
    ...expense.payload, data: '2025-12-15', vencimento: '2025-12-15', frequencia: 'unica',
  } };
  const annual = dashboardView(snapshot, null, month, [older], '2026-11-25');
  assert.equal(annual.historico_saidas[0].dt_saida, '2025-12-15T12:00:00-03:00');
});

test('máscara monetária e calendário mantêm os valores enviados ao Supabase', t => {
  const app = loadApp(tmpdir(), new Map());
  t.after(app.close);
  const { amount, calendarDateValue, displayMoney, localCalendarDate, maskMoney, parseFormDate } = app.load('formValues');

  const first = maskMoney('1', '');
  assert.equal(first, '0.01');
  assert.equal(displayMoney(first), '0,01');
  assert.equal(maskMoney('0,012', first), '0.12');
  assert.equal(maskMoney('0,0', '0.00'), '');
  assert.equal(maskMoney('R$ 1.234,5', ''), '1234.50');
  assert.equal(amount(maskMoney('R$ 1.234,56', ''), false), '1234.56');
  assert.equal(displayMoney('1234.56'), '1.234,56');
  assert.throws(() => amount(maskMoney('-R$ 15,50', ''), false), /Informe um valor/);
  assert.throws(() => amount(maskMoney('R$ 1.000.000,00', ''), false), /Informe um valor/);

  assert.equal(parseFormDate('29/02/2028'), '2028-02-29');
  assert.equal(parseFormDate('29/02/2026'), null);
  assert.equal(parseFormDate('1999-12-31'), null);
  assert.equal(calendarDateValue(localCalendarDate('2100-12-31')), '2100-12-31');
  assert.equal(calendarDateValue(new Date(2026, 10, 25, 23, 55)), '2026-11-25');
});

test('o extrato ordena pelo instante e pelo registro sem agrupar tipos', t => {
  const app = loadApp(tmpdir(), new Map());
  t.after(app.close);
  const { dashboardView, statement } = app.load('finance');
  const snapshot = { data: {
    historico_entradas: [
      { cd_entrada: 1, ds_motivo_entrada: 'Variação antiga', dt_entrada: '2026-11-24T23:25:00-03:00' },
      { cd_entrada: 2, ds_motivo_entrada: 'Receita', dt_entrada: '2026-11-25T12:00:00-03:00',
        dt_criacao_lancamento: '2026-11-25T13:45:00-03:00' },
    ],
    historico_saidas: [{ cd_saida: 39, ds_motivo_saida: 'Despesa', dt_saida: '2026-11-25T12:00:00-03:00',
      dt_criacao_lancamento: '2026-11-25T13:15:00-03:00', ic_pago: true }],
    transferencias: [{ cd_transferencia: 8, dt_transferencia: '2026-11-25T18:00:00-03:00' }],
  } };
  const view = dashboardView(snapshot, null, month, [], '2026-11-25');
  assert.deepEqual(statement(view).map(item => item.id), ['transferencia:8', 'entrada:2', 'saida:39', 'entrada:1']);
});

test('edição offline substitui o lançamento na tela e atualiza o ID local antes do reenvio', async t => {
  const directory = mkdtempSync(path.join(tmpdir(), 'myfin-edicao-'));
  let app = loadApp(directory, new Map());
  t.after(() => { app.close(); rmSync(directory, { recursive: true, force: true }); });
  let db = app.load('storage');
  const owner = 'ana';
  const creation = randomUUID();
  const edit = randomUUID();
  const original = { acao: 'entrada', descricao: 'Venda', data: '2026-11-25', ocorrido_em: time,
    id_conta_usuario: 1, id_categoria: 2, valor: '30.00', frequencia: 'unica' };
  await db.enqueue(owner, creation, original);
  await db.enqueue(owner, edit, { ...original, id: 'local:' + creation + ':0', descricao: 'Venda corrigida', valor: '25.50' });
  app.close();

  app = loadApp(directory, new Map());
  db = app.load('storage');
  const { dashboardView, statement } = app.load('finance');
  const view = dashboardView(null, null, month, await db.readQueue(owner), '2026-11-25');
  const items = statement(view);
  assert.equal(items.length, 1);
  assert.equal(items[0].descricao, 'Venda corrigida');
  assert.equal(items[0].localPending, true);
  assert.equal(view.movimentacoesSaldoPendentes.get(1), 2550);

  const { flushQueue } = app.load('syncService');
  const signal = new AbortController().signal;
  const requests = [];
  const client = { async send(wire) {
    requests.push(wire);
    if (wire.p_acao === 'tb_entradas') return { id: 101, ids: [101] };
    if (requests.length === 2) throw Object.assign(new Error('conexão interrompida'), { status: 0 });
    return { id: 101 };
  } };
  await assert.rejects(flushQueue(owner, client, signal, () => true), /conexão interrompida/);
  assert.equal(requests[1].p_acao, 'editar_entrada');
  assert.equal(requests[1].p_dados.id, 101);
  assert.equal(requests[1].p_dados.lancamento.vl_entrada, '25.50');
  await flushQueue(owner, client, signal, () => true);
  assert.deepEqual(requests[1], requests[2]);
  assert.equal((await db.readQueue(owner))[1].receipt.id, 101);
});

test('autenticação, consultas paginadas e gravação usam somente o Supabase', async t => {
  const app = loadApp(tmpdir(), new Map());
  t.after(app.close);
  const api = app.load('supabase');
  let renewals = 0;
  let migrationMissing = false;
  const refreshedBalances = new Set();
  const calls = [];
  const json = (data, headers = {}) => new Response(JSON.stringify(data), { headers });
  t.mock.method(globalThis, 'fetch', async (uri, options) => {
    const parsed = new URL(uri);
    const auth = parsed.searchParams.get('grant_type');
    assert.equal(parsed.origin, project);
    assert.equal(options.headers.apikey, process.env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY);
    calls.push(parsed.pathname);
    if (auth === 'password' || auth === 'refresh_token') {
      if (auth === 'refresh_token') renewals++;
      return json({ access_token: auth + '-token', refresh_token: 'refresh', expires_in: 3600,
        user: { id: 'ana', email: 'ana@example.com' } });
    }
    if (parsed.pathname.endsWith('/vincular_usuario_auth')) return json([{ cd_usuario: 9, nm_usuario: 'Ana' }]);
    assert.equal(options.headers.Authorization, 'Bearer refresh_token-token');
    if (['/rest/v1/rpc/fn_atualizar_saldos_receitas', '/rest/v1/rpc/fn_atualizar_saldos_movimentacoes'].includes(parsed.pathname)) {
      assert.equal(options.method, 'POST');
      if (migrationMissing) return Response.json({ code: 'PGRST202' }, { status: 404 });
      await new Promise(resolve => setImmediate(resolve));
      refreshedBalances.add(parsed.pathname);
      return json(1);
    }
    if (parsed.pathname.endsWith('/tb_contas_usuarios')) assert.equal(refreshedBalances.size, migrationMissing ? 0 : 2);
    if (migrationMissing && parsed.pathname.endsWith('/tb_operacoes_mobile')) {
      return new Response(JSON.stringify({ code: 'PGRST205' }), { status: 404 });
    }
    if (parsed.pathname.endsWith('/fn_sincronizar_financas')) return json({ id: 7, ids: [7] });
    if (parsed.pathname.endsWith('/fn_editar_lancamento_mobile')) return json({ id: 7 });
    if (parsed.pathname.endsWith('/tb_saidas') && parsed.searchParams.has('or')) {
      const filter = parsed.searchParams.get('or');
      assert.match(filter, /dt_saida\.gte\.2025-12-01T00:00:00-03:00/);
      assert.match(filter, /dt_pagamento\.gte\.2025-12-01T00:00:00-03:00/);
      return json([{ cd_saida: 4, dt_saida: '2025-12-15', ic_pago: true }], { 'Content-Range': '0-0/1' });
    }
    if (parsed.pathname.endsWith('/tb_entradas')) {
      assert.equal(parsed.searchParams.get('id_usuario'), 'eq.9');
      assert.match(parsed.searchParams.get('and'), /2026-06-01T00:00:00-03:00/);
      if (parsed.searchParams.get('offset') === '0') return json([{ cd_entrada: 1 }, { cd_entrada: 2 }], { 'Content-Range': '0-1/3' });
      return json([{ cd_entrada: 3 }], { 'Content-Range': '2-2/3' });
    }
    return json([], { 'Content-Range': '*/0' });
  });

  const { session } = await api.login('ana@example.com', 'teste');
  assert.deepEqual(await api.restoreSession(), session);
  const client = api.createClient(session);
  const data = await client.dashboard(month);
  assert.equal(data.historico_entradas.length, 3);
  assert.equal(data.historico_saidas[0].dt_saida, '2025-12-15');
  assert.equal(data.meses_historico_saidas, 12);
  assert.equal(data.sincronizacao_disponivel, true);
  assert.equal(data.credito_receitas_disponivel, true);
  assert.equal(data.saldo_movimentacoes_disponivel, true);
  assert.equal(renewals, 1);
  const receipt = await client.send({ p_operacao: randomUUID(), p_hash: 'hash', p_acao: 'tb_entradas', p_dados: [] });
  assert.equal(receipt.id, 7);
  const edited = await client.send({ p_operacao: randomUUID(), p_hash: 'hash', p_acao: 'editar_entrada', p_dados: { id: 7 } });
  assert.equal(edited.id, 7);
  assert.ok(calls.includes('/rest/v1/rpc/fn_editar_lancamento_mobile'));
  assert.equal(calls.filter(pathname => pathname.endsWith('/tb_entradas')).length, 2);
  migrationMissing = true;
  refreshedBalances.clear();
  const beforeMigration = await client.dashboard(month);
  assert.equal(beforeMigration.sincronizacao_disponivel, false);
  assert.equal(beforeMigration.credito_receitas_disponivel, false);
  assert.equal(beforeMigration.saldo_movimentacoes_disponivel, false);
  assert.equal(beforeMigration.historico_entradas.length, 3);
});

