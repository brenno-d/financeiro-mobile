export const expenseHistoryMonths = 12;

const dayFormat = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit',
});
const moneyFormat = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
const monthFormat = new Intl.DateTimeFormat('pt-BR', { month: 'long', year: 'numeric', timeZone: 'UTC' });

export function dateInZone(date = new Date()) {
  const parts = Object.fromEntries(dayFormat.formatToParts(date).map(part => [part.type, part.value]));
  return [parts.year, parts.month, parts.day].join('-');
}

export function day(value) {
  if (!value) return '';
  return value.length === 10 ? value : dateInZone(new Date(value));
}

export const cents = value => Math.round(Number(value ?? 0) * 100);
export const reais = value => moneyFormat.format(value / 100);
export const sum = (rows, field) => rows.reduce((total, row) => total + cents(row[field]), 0);
export const monthName = month => monthFormat.format(new Date(month + '-01T12:00:00Z'));
export const dateLabel = value => day(value).split('-').reverse().join('/');
export const normalize = value => String(value ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();

export function monthShift(month, offset) {
  const date = new Date(month + '-01T12:00:00Z');
  date.setUTCMonth(date.getUTCMonth() + offset);
  return date.toISOString().slice(0, 7);
}

function monthDay(month, number) {
  const last = new Date(Date.parse(monthShift(month, 1) + '-01T12:00:00Z') - 86400000).getUTCDate();
  return month + '-' + String(Math.min(last, Number(number))).padStart(2, '0');
}

export function dateRange(month, today) {
  const end = month === today.slice(0, 7) ? today : monthDay(month, 31);
  const start = new Date(Date.parse(end + 'T12:00:00Z') - 89 * 86400000).toISOString().slice(0, 10);
  return [start, end];
}

export const isLocal = value => typeof value === 'string' && value.startsWith('local:');
const local = (id, slot = 'id') => 'local:' + id + ':' + slot;
const references = ['id', 'id_conta_usuario', 'id_conta_origem', 'id_conta_destino', 'id_cartao'];
export const dependencies = payload => references.flatMap(field => isLocal(payload[field]) ? [payload[field].split(':')[1]] : []);

export function resolveReferences(payload, queue) {
  const values = { ...payload };
  for (const field of references) {
    const value = values[field];
    if (!isLocal(value)) continue;
    const [, id, slot] = value.split(':');
    const receipt = queue.get(id)?.receipt;
    values[field] = slot === 'id' ? receipt?.id : receipt?.ids?.[Number(slot)] ?? (slot === '0' ? receipt?.id : undefined);
    if (!values[field]) return null;
  }
  return values;
}

function movementRows(payload) {
  const { acao, frequencia, parcelas, data } = payload;
  const count = frequencia === 'parcelada' ? Number(parcelas) : 1;
  const total = cents(payload.valor);
  const schedule = (date, index) => monthDay(monthShift(date.slice(0, 7), index), date.slice(8));
  return Array.from({ length: count }, (_, index) => {
    const dataParcela = schedule(data, index);
    const row = {
      ['ds_motivo_' + acao]: payload.descricao,
      ['vl_' + acao]: count === 1 ? payload.valor : ((Math.floor(total / count) + (index < total % count ? 1 : 0)) / 100).toFixed(2),
      ['dt_' + acao]: dataParcela + 'T12:00:00-03:00',
      ['id_categoria_' + acao]: payload.id_categoria,
      id_conta_usuario: payload.id_conta_usuario,
    };
    if (count > 1) row.nr_parcela = index + 1;
    if (acao === 'saida') {
      row.id_forma_pagamento = payload.id_forma_pagamento;
      row.ic_pago = Boolean(payload.pago && index === 0);
      row.dt_vencimento = schedule(payload.vencimento, index);
      row.dt_pagamento = row.ic_pago
        ? (data < day(payload.ocorrido_em) ? data + 'T12:00:00-03:00' : payload.ocorrido_em) : null;
      if (payload.id_cartao) row.id_cartao = payload.id_cartao;
    }
    return row;
  });
}

const accountRow = p => ({
  nm_conta_usuario: p.nome, id_tipo_conta: p.id_tipo_conta, vl_saldo_conta_usuario: p.saldo,
  ...(p.banco ? { cd_ispb_banco: p.banco === 'sem-banco' ? null : p.banco } : {}),
});
const accountDetails = p => ({
  nm_titular: p.titular || null, ds_agencia: p.agencia || null, ds_numero_conta: p.numero || null,
});

export function operationData(p) {
  switch (p.acao) {
    case 'entrada':
    case 'saida': {
      if (p.id) {
        const [row] = movementRows({ ...p, frequencia: 'unica' });
        const field = 'dt_' + p.acao;
        const previousDate = p.original?.[field];
        if (previousDate?.length > 10 && day(previousDate) === p.data) row[field] = previousDate;
        if (p.acao === 'saida') {
          delete row.dt_pagamento;
          row.id_cartao ??= null;
        }
        return ['editar_' + p.acao, { id: p.id, lancamento: row, ocorrido_em: p.ocorrido_em }];
      }
      const rows = movementRows(p);
      if (p.frequencia !== 'fixa') return ['tb_' + p.acao + 's', rows];
      return p.acao === 'entrada'
        ? ['fn_criar_entrada_fixa', { p_entrada: rows[0], p_inicio: p.data }]
        : ['fn_criar_despesa_fixa', { p_saida: rows[0], p_inicio: p.data }];
    }
    case 'conta': return ['fn_salvar_conta_financeira', {
      p_id: p.id || null, p_conta: accountRow(p), p_detalhes: 'titular' in p ? accountDetails(p) : null,
    }];
    case 'transferencia': return ['tb_transferencias', [{
      id_conta_origem: p.id_conta_origem, id_conta_destino: p.id_conta_destino,
      vl_transferencia: p.valor, dt_transferencia: p.data + 'T12:00:00-03:00', ds_observacao: p.descricao || null,
    }]];
    case 'meta': return ['tb_metas_gastos', [{
      nm_meta_gasto: p.nome, vl_limite_meta: p.valor, id_categoria_saida: p.id_categoria_saida, dt_mes_referencia: p.mes + '-01',
    }]];
    case 'pix': return ['tb_chaves_pix', [{ id_conta_usuario: p.id_conta_usuario, tp_chave: p.tipo, ds_chave: p.chave }]];
    case 'cartao': return ['tb_cartoes', [{
      id_conta_usuario: p.id_conta_usuario, nm_cartao: p.nome, tp_cartao: p.tipo, nr_final: p.final,
      dt_validade: p.validade ? p.validade + '-01' : null, nr_dia_vencimento: p.tipo !== 'debito' && p.dia ? Number(p.dia) : null,
    }]];
    case 'pagar': return ['pagar', { id: p.id, dt_pagamento: p.ocorrido_em }];
    case 'pagar_fixa': return ['fn_pagar_despesa_fixa', { p_id: p.id, p_mes: p.mes + '-01', p_pagamento: p.ocorrido_em }];
    case 'receber_entrada_fixa': return ['fn_receber_entrada_fixa', { p_id: p.id, p_mes: p.mes + '-01' }];
    default: throw new Error('Operação inválida.');
  }
}

export function fixedExpenses(d, month = d.mes) {
  return d.fixas.filter(f => f.dt_inicio.slice(0, 7) <= month && (!f.dt_fim || f.dt_fim.slice(0, 7) >= month))
    .map(f => ({
      ...f,
      vencimento: monthDay(month, f.dt_dia_saida_fixa),
    }));
}

function expenseProjection(f) {
  return {
    id_saida_fixa: f.cd_saida_fixa, cd_saida: 'fixa:' + f.cd_saida_fixa, projetada: true,
    ds_motivo_saida: f.nm_saida_fixa, vl_saida: f.vl_saida_fixa, id_conta_usuario: f.id_conta_usuario,
    id_categoria_saida: f.id_categoria_saida, id_forma_pagamento: f.id_forma_pagamento, id_cartao: f.id_cartao,
    dt_vencimento: f.vencimento, dt_saida: f.vencimento, ic_pago: false, localPending: f.localPending,
  };
}

function incomeProjection(f, month) {
  return {
    id_entrada_fixa: f.cd_entrada_fixa, cd_entrada: 'fixa:' + f.cd_entrada_fixa + ':' + month,
    projetada: true, dt_entrada: monthDay(month, f.dt_inicio.slice(8, 10)),
    ds_motivo_entrada: f.ds_motivo_entrada, vl_entrada: f.vl_entrada,
    id_categoria_entrada: f.id_categoria_entrada, id_conta_usuario: f.id_conta_usuario, localPending: f.localPending,
  };
}

export function dueExpenses(d, month = d.mes) {
  const projected = fixedExpenses(d, month)
    .filter(f => !d.historico_saidas.some(s => s.id_saida_fixa === f.cd_saida_fixa && day(s.dt_saida).startsWith(month)))
    .map(expenseProjection);
  return [...d.pendentes, ...projected].sort((a, b) => day(a.dt_vencimento || a.dt_saida).localeCompare(day(b.dt_vencimento || b.dt_saida)));
}

const lists = ['historico_entradas', 'historico_saidas', 'transferencias', 'fixas', 'pendentes', 'metas',
  'fixas_entrada', 'contas', 'cartoes', 'chaves_pix', 'detalhes_contas', 'categorias_entrada',
  'categorias_saida', 'formas_pagamento', 'tipos_conta'];
const shared = ['contas', 'cartoes', 'chaves_pix', 'detalhes_contas', 'categorias_entrada',
  'categorias_saida', 'formas_pagamento', 'tipos_conta', 'bancos', 'metas_disponiveis',
  'extensao_disponivel', 'entradas_recorrentes_disponiveis', 'bancos_disponiveis', 'credito_receitas_disponivel',
  'saldo_movimentacoes_disponivel'];
const put = (rows, key, item) => {
  const index = rows.findIndex(value => value[key] === item[key]);
  if (index === -1) rows.push(item);
  else rows[index] = { ...rows[index], ...item };
};

function addPendingBalance(d, account, delta, date) {
  if (!date || day(date) > d.hoje) return;
  const total = d.movimentacoesSaldoPendentes.get(account) ?? 0;
  d.movimentacoesSaldoPendentes.set(account, total + delta);
}

function addPaidExpense(d, expense, direction = 1) {
  if (!expense.ic_pago) return;
  addPendingBalance(d, expense.id_conta_usuario, -direction * cents(expense.vl_saida), expense.dt_pagamento ?? expense.dt_saida);
}

function trackMovement(d, kind, row, direction = 1) {
  if (kind === 'entrada') {
    addPendingBalance(d, row.id_conta_usuario, direction * cents(row.vl_entrada), row.dt_entrada);
  } else {
    addPaidExpense(d, row, direction);
  }
}

function applyMovementEdit(d, p, badge, balancePending) {
  const isExpense = p.acao === 'saida';
  const key = 'cd_' + p.acao;
  const date = 'dt_' + p.acao;
  const target = isExpense ? 'historico_saidas' : 'historico_entradas';
  const existing = d[target].find(row => row[key] === p.id) ??
    (isExpense ? d.pendentes.find(row => row[key] === p.id) : undefined);
  const previous = existing ?? p.original;
  const [, { lancamento }] = operationData(p);
  const canEstimate = balancePending && Boolean(existing?.saldoEmFila ||
    (isExpense && previous && !previous.ic_pago && !previous.localPending));
  const row = { ...previous, ...lancamento, ...badge, [key]: p.id, saldoEmFila: canEstimate, ocorrido_em: previous?.ocorrido_em };
  if (isExpense) {
    row.dt_pagamento = !p.pago ? null
      : previous?.ic_pago ? previous.dt_pagamento ?? previous.dt_saida : p.ocorrido_em;
    d.pendentes = d.pendentes.filter(item => item[key] !== p.id);
    if (!row.ic_pago) put(d.pendentes, key, row);
  }
  if (canEstimate) {
    if (existing?.saldoEmFila) trackMovement(d, p.acao, existing, -1);
    trackMovement(d, p.acao, row);
  }
  d[target] = d[target].filter(item => item[key] !== p.id);
  if (isExpense ? inExpenseHistory(d.mes, row) : inHistory(d.mes, row[date])) put(d[target], key, row);
}

function apply(d, op, queue, balancePending) {
  const original = op.payload;
  const p = { ...original };
  for (const field of references) {
    if (isLocal(p[field])) {
      const resolved = resolveReferences({ [field]: p[field] }, queue);
      if (resolved) p[field] = resolved[field];
    }
  }
  const id = op.receipt?.id ?? local(op.id);
  const badge = { localPending: !op.receipt, ocorrido_em: p.ocorrido_em };
  if (p.acao === 'entrada' || p.acao === 'saida') {
    if (p.id) {
      applyMovementEdit(d, p, badge, balancePending);
      return;
    }
    const dateField = 'dt_' + p.acao;
    const key = 'cd_' + p.acao;
    const target = p.acao === 'entrada' ? d.historico_entradas : d.historico_saidas;
    movementRows(p).forEach((row, index) => {
      const item = { ...row, ...badge, saldoEmFila: balancePending,
        [key]: op.receipt?.ids?.[index] ?? (p.frequencia === 'unica' && op.receipt ? id : local(op.id, String(index))) };
      if (p.frequencia === 'fixa') {
        item['id_' + p.acao + '_fixa'] = id;
        if (p.acao === 'entrada') {
          put(d.fixas_entrada, 'cd_entrada_fixa', { ...item, cd_entrada_fixa: id, dt_inicio: p.data });
        } else {
          put(d.fixas, 'cd_saida_fixa', {
            ...item, cd_saida_fixa: id, dt_inicio: p.data, nm_saida_fixa: p.descricao,
            vl_saida_fixa: p.valor, dt_dia_saida_fixa: Number(p.vencimento.slice(8)),
          });
        }
      }
      if (balancePending) trackMovement(d, p.acao, item);
      if (p.acao === 'saida' ? inExpenseHistory(d.mes, item) : inHistory(d.mes, item[dateField])) put(target, key, item);
      if (p.acao === 'saida' && !item.ic_pago) put(d.pendentes, key, item);
    });
    return;
  }
  const [action, wire] = operationData(p);
  switch (action) {
    case 'fn_salvar_conta_financeira': {
      const account = p.id || id;
      // O saldo informado no formulário substitui o saldo após os lançamentos anteriores da fila.
      d.movimentacoesSaldoPendentes.delete(account);
      put(d.contas, 'cd_conta_usuario', { ...wire.p_conta, cd_conta_usuario: account, ic_ativa: true, ...badge });
      if (wire.p_detalhes) put(d.detalhes_contas, 'id_conta_usuario', { ...wire.p_detalhes, id_conta_usuario: account, ...badge });
      break;
    }
    case 'tb_transferencias': {
      const transfer = wire[0];
      if (balancePending) {
        const value = cents(transfer.vl_transferencia);
        addPendingBalance(d, transfer.id_conta_origem, -value, transfer.dt_transferencia);
        addPendingBalance(d, transfer.id_conta_destino, value, transfer.dt_transferencia);
      }
      if (inHistory(d.mes, transfer.dt_transferencia)) put(d.transferencias, 'cd_transferencia', { ...transfer, cd_transferencia: id, ...badge });
      break;
    }
    case 'tb_metas_gastos':
      if (p.mes === d.mes) put(d.metas, 'cd_meta_gasto', { ...wire[0], cd_meta_gasto: id, ...badge });
      break;
    case 'tb_chaves_pix': put(d.chaves_pix, 'cd_chave_pix', { ...wire[0], cd_chave_pix: id, ...badge }); break;
    case 'tb_cartoes': put(d.cartoes, 'cd_cartao', { ...wire[0], cd_cartao: id, ...badge }); break;
    case 'pagar': {
      const row = d.pendentes.find(s => s.cd_saida === p.id) ?? d.historico_saidas.find(s => s.cd_saida === p.id);
      if (row) {
        const paid = { ...row, ...badge, ocorrido_em: row.ocorrido_em, ic_pago: true,
          dt_pagamento: p.ocorrido_em, saldoEmFila: balancePending && !row.ic_pago };
        if (balancePending && !row.ic_pago) addPaidExpense(d, paid);
        if (inExpenseHistory(d.mes, paid)) put(d.historico_saidas, 'cd_saida', paid);
      }
      d.pendentes = d.pendentes.filter(s => s.cd_saida !== p.id);
      break;
    }
    case 'fn_pagar_despesa_fixa': {
      const f = fixedExpenses(d, p.mes).find(item => item.cd_saida_fixa === p.id);
      if (f) {
        const paid = { ...expenseProjection(f), ...badge, cd_saida: id, projetada: false, ic_pago: true,
          dt_pagamento: p.ocorrido_em, saldoEmFila: balancePending };
        if (balancePending) addPaidExpense(d, paid);
        if (inExpenseHistory(d.mes, paid)) put(d.historico_saidas, 'cd_saida', paid);
      }
      break;
    }
    case 'fn_receber_entrada_fixa': {
      const f = d.fixas_entrada.find(item => item.cd_entrada_fixa === p.id);
      if (f) {
        const income = { ...incomeProjection(f, p.mes), ...badge, cd_entrada: id, projetada: false, saldoEmFila: balancePending };
        if (balancePending) addPendingBalance(d, income.id_conta_usuario, cents(income.vl_entrada), income.dt_entrada);
        if (inHistory(d.mes, p.mes + '-01')) put(d.historico_entradas, 'cd_entrada', income);
      }
      break;
    }
  }
}

function inHistory(month, value, months = 6) {
  const date = day(value).slice(0, 7);
  return date >= monthShift(month, 1 - months) && date <= month;
}

function inExpenseHistory(month, expense) {
  return inHistory(month, expense.dt_saida, expenseHistoryMonths)
    || inHistory(month, expense.dt_pagamento, expenseHistoryMonths);
}

export function dashboardView(snapshot, fallback, month, queue, today = dateInZone()) {
  const base = snapshot?.data ?? fallback?.data;
  const d = { ...Object.fromEntries(lists.map(name => [name, []])) };
  if (snapshot) Object.assign(d, snapshot.data);
  else if (base) {
    for (const field of shared) d[field] = base[field];
  }
  for (const name of lists) d[name] = [...(d[name] ?? [])];
  d.mes = month;
  d.hoje = today;
  d.movimentacoesSaldoPendentes = new Map();
  const map = new Map(queue.map(op => [op.id, op]));
  const visibleRevision = snapshot?.revision ?? fallback?.revision ?? 0;
  d.resolveId = value => isLocal(value) ? resolveReferences({ id: value }, map)?.id ?? value : value;
  const invalid = new Set();
  for (const op of queue) {
    if (op.error || dependencies(op.payload).some(id => invalid.has(id))) {
      invalid.add(op.id);
      continue;
    }
    const included = op.receipt && op.revision <= visibleRevision;
    if (!included || (!snapshot && !['conta', 'pix', 'cartao'].includes(op.payload.acao))) {
      apply(d, op, map, !included);
    }
  }
  for (const f of d.fixas_entrada) {
    for (let offset = -5; offset <= 0; offset++) {
      const period = monthShift(month, offset);
      if (f.dt_inicio.slice(0, 7) <= period && !d.historico_entradas.some(e => e.id_entrada_fixa === f.cd_entrada_fixa && day(e.dt_entrada).startsWith(period))) {
        d.historico_entradas.push(incomeProjection(f, period));
      }
    }
  }
  d.entradas = d.historico_entradas.filter(row => day(row.dt_entrada).startsWith(month));
  d.saidas = d.historico_saidas.filter(row => day(row.dt_saida).startsWith(month));
  return d;
}

export const accountName = (d, id) => d.contas.find(row => row.cd_conta_usuario === id)?.nm_conta_usuario ?? 'Conta indisponível';
export const categoryName = (d, kind, id) => kind === 'entrada'
  ? d.categorias_entrada.find(row => row.cd_categoria_entrada === id)?.nm_categoria_entrada ?? 'Sem categoria'
  : d.categorias_saida.find(row => row.cd_categoria_saida === id)?.ds_categoria_saida ?? 'Sem categoria';
export const paymentName = (d, id) => d.formas_pagamento.find(row => row.cd_forma_pagamento === id)?.nm_forma_pagamento ?? '';
export const cardName = card => card.nm_cartao + ' · ' + card.nr_final;
export const payAction = s => s.projetada
  ? { acao: 'pagar_fixa', id: s.id_saida_fixa, mes: day(s.dt_saida).slice(0, 7) } : { acao: 'pagar', id: s.cd_saida };

function editMovement(tipo, row, data) {
  const id = row['cd_' + tipo];
  if (row.projetada || !(isLocal(id) || Number(id) > 0)) return null;
  return {
    acao: tipo,
    seed: {
      id, original: row, descricao: row['ds_motivo_' + tipo], valor: row['vl_' + tipo], data,
      id_conta_usuario: row.id_conta_usuario, id_categoria: row['id_categoria_' + tipo],
      ...(tipo === 'saida' ? {
        vencimento: day(row.dt_vencimento ?? row.dt_saida), pago: Boolean(row.ic_pago),
        id_forma_pagamento: row.id_forma_pagamento, id_cartao: row.id_cartao,
      } : {}),
    },
  };
}

function statementTime(date) {
  if (!date) return 0;
  return Date.parse(date.length === 10 ? date + 'T12:00:00-03:00' : date) || 0;
}

export function statement(d) {
  const movements = [];
  for (const tipo of ['entrada', 'saida']) {
    const rows = tipo === 'entrada' ? d.historico_entradas
      : [...d.historico_saidas, ...dueExpenses(d).filter(s => s.projetada)];
    for (const row of rows) {
      const timestamp = statementTime(row['dt_' + tipo]);
      const data = day(row['dt_' + tipo]);
      const efetivado = tipo === 'entrada' ? !row.projetada && data <= d.hoje
        : row.ic_pago && day(row.dt_pagamento || data) <= d.hoje;
      movements.push({
        id: tipo + ':' + row['cd_' + tipo], tipo, data, timestamp, recordedAt: statementTime(row.ocorrido_em ?? row.dt_criacao_lancamento ?? row.created_at),
        edit: editMovement(tipo, row, data), status: efetivado ? 'efetivado' : 'pendente',
        descricao: row['ds_motivo_' + tipo], valor: cents(row['vl_' + tipo]), conta: row.id_conta_usuario,
        categoria: categoryName(d, tipo, row['id_categoria_' + tipo]), cartao: row.id_cartao,
        categoriaId: tipo + ':' + row['id_categoria_' + tipo], parcela: row.nr_parcela, localPending: row.localPending,
        metodo: tipo === 'saida' ? paymentName(d, row.id_forma_pagamento) : '',
        action: tipo === 'saida' && !row.ic_pago ? payAction(row) : tipo === 'entrada' && row.projetada
          ? { acao: 'receber_entrada_fixa', id: row.id_entrada_fixa, mes: data.slice(0, 7) } : null,
      });
    }
  }
  for (const t of d.transferencias) {
    const data = day(t.dt_transferencia);
    movements.push({
      id: 'transferencia:' + t.cd_transferencia, tipo: 'transferencia', data,
      timestamp: statementTime(t.dt_transferencia), recordedAt: statementTime(t.ocorrido_em ?? t.dt_criacao_lancamento ?? t.created_at),
      status: data <= d.hoje ? 'efetivado' : 'pendente',
      descricao: t.ds_observacao || 'Transferência entre contas', valor: cents(t.vl_transferencia),
      conta: t.id_conta_origem, destino: t.id_conta_destino, categoria: 'Transferência', categoriaId: 'transferencia', localPending: t.localPending,
    });
  }
  return movements.sort((a, b) => b.timestamp - a.timestamp || b.recordedAt - a.recordedAt
    || String(a.descricao ?? '').localeCompare(String(b.descricao ?? ''), 'pt-BR') || a.id.localeCompare(b.id));
}

