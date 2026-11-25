import React, { useMemo, useState } from 'react';
import { Alert, FlatList, Pressable, RefreshControl, ScrollView, Text, View } from 'react-native';
import * as Clipboard from 'expo-clipboard';
import {
  accountName, cardName, categoryName, cents, dateLabel, dateRange, day, dueExpenses, fixedExpenses,
  monthName, monthShift, normalize, payAction, reais, statement, sum,
} from '../../finance';
import { formNames } from '../../components/FinanceForm';
import { AmountBar, Badge, BankLogo, Bar, Button, Chips, Field, Icon, IconButton, Section, Select, colors, optionsFrom, ui } from '../../components/FinanceUI';

const opts = pairs => pairs.map(([value, label]) => ({ value, label }));
const types = opts([['', 'Todos'], ['entrada', 'Receitas'], ['saida', 'Despesas'], ['transferencia', 'Transferências']]);
const statuses = opts([['', 'Todos'], ['efetivado', 'Efetivado'], ['pendente', 'Pendente']]);
const periods = opts([['90', 'Últimos 90 dias'], ['month', 'Mês selecionado']]);
const statsPeriods = opts([['3', '3 meses'], ['6', '6 meses'], ['12', '12 meses']]);
const paymentIcon = 'check-circle-outline';

export function Page({ f, children }) {
  return <ScrollView style={ui.page} contentContainerStyle={ui.content} keyboardShouldPersistTaps="handled"
    refreshControl={<RefreshControl refreshing={f.syncing} onRefresh={f.sync} tintColor={colors.primary} />}>
    {children}
  </ScrollView>;
}

function Empty({ children }) {
  return <Text style={ui.muted}>{children}</Text>;
}

function PendingBadge({ pending }) {
  return pending ? <Badge>Aguardando sincronização</Badge> : null;
}

export function Overview({ f, open, confirm }) {
  const [forecast, setForecast] = useState(false);
  const d = f.view;
  const bills = dueExpenses(d);
  const revenue = sum(d.entradas.filter(e => forecast || (!e.projetada && day(e.dt_entrada) <= d.hoje)), 'vl_entrada');
  const expenses = sum(d.saidas.filter(s => forecast || (s.ic_pago && day(s.dt_pagamento || s.dt_saida) <= d.hoje)), 'vl_saida')
    + (forecast ? sum(bills.filter(s => s.projetada), 'vl_saida') : 0);
  return <Page f={f}>
    <Text accessibilityRole="header" style={ui.title}>Visão geral</Text>
    {(f.hasSnapshot || d.entradas.length > 0 || d.saidas.length > 0) && <Section title="Receitas e despesas">
      <Chips options={opts([['actual', 'Realizado'], ['forecast', 'Projetado']])}
        value={forecast ? 'forecast' : 'actual'} onChange={value => setForecast(value === 'forecast')} />
      <View><Text style={ui.muted}>{forecast ? 'Saldo projetado do mês' : 'Saldo realizado do mês'}</Text>
        <Text style={[ui.money, revenue < expenses && ui.expense]}>{reais(revenue - expenses)}</Text></View>
      <AmountBar label="Receitas" value={revenue} max={Math.max(revenue, expenses)} />
      <AmountBar label="Despesas" value={expenses} max={Math.max(revenue, expenses)} tone="red" />
    </Section>}
    <Section title="Contas a pagar" action={<IconButton name="plus" label="Nova despesa" disabled={!f.hasReferences} onPress={() => open({ acao: 'saida' })} />}>
      {bills.length ? <Text style={ui.money}>{reais(sum(bills, 'vl_saida'))}</Text> :
        <Empty>{f.hasSnapshot ? 'Nenhuma conta em aberto.' : 'Aguardando dados das contas a pagar.'}</Empty>}
      {bills.map(bill => {
        const due = day(bill.dt_vencimento || bill.dt_saida);
        return <View key={bill.cd_saida} style={ui.between}>
          <View style={ui.grow}><Text style={ui.label}>{bill.ds_motivo_saida}</Text>
            <Text style={ui.muted}>{dateLabel(due)} · {accountName(d, bill.id_conta_usuario)}{bill.id_saida_fixa ? ' · Fixa' : ''}</Text>
            <View style={ui.wrap}>
              {due < d.hoje && <Badge tone="red">Em atraso</Badge>}
              <PendingBadge pending={bill.localPending} />
            </View>
          </View>
          <Text style={ui.expense}>{reais(cents(bill.vl_saida))}</Text>
          <IconButton name={paymentIcon} label={'Marcar como paga: ' + bill.ds_motivo_saida}
            disabled={bill.projetada && !d.extensao_disponivel} onPress={() => confirm(payAction(bill), bill.ds_motivo_saida)} />
        </View>;
      })}
    </Section>
    <Section title="Metas de gastos" action={<IconButton name="plus" label="Nova meta" disabled={!d.metas_disponiveis} onPress={() => open({ acao: 'meta' })} />}>
      {!d.metas.length && <Empty>{f.hasSnapshot ? (d.metas_disponiveis ? 'Nenhuma meta para este mês.' : 'Metas indisponíveis no momento.') : 'Aguardando dados das metas.'}</Empty>}
      {d.metas.map(goal => {
        const spent = sum(d.saidas.filter(s => s.id_categoria_saida === goal.id_categoria_saida &&
          s.ic_pago && day(s.dt_pagamento ?? s.dt_saida) <= d.hoje), 'vl_saida');
        const limit = cents(goal.vl_limite_meta);
        return <View key={goal.cd_meta_gasto} style={{ gap: 7 }}>
          <View style={ui.between}><Text style={[ui.label, ui.grow]}>{goal.nm_meta_gasto}</Text>
            <Text style={limit < spent ? ui.expense : ui.muted}>{limit ? Math.round(spent / limit * 100) : 0}% utilizado</Text></View>
          <Bar ratio={limit ? spent / limit : 0} tone={spent > limit ? 'red' : undefined} />
          <Text style={ui.muted}>{reais(spent)} de {reais(limit)} · {spent > limit ? 'Excedeu ' : 'Restam '}{reais(Math.abs(limit - spent))}</Text>
          <PendingBadge pending={goal.localPending} />
        </View>;
      })}
    </Section>
  </Page>;
}

function Movement({ item, d, confirm, open }) {
  const destination = item.destino ? ' → ' + accountName(d, item.destino) : '';
  const card = item.cartao && d.cartoes.find(row => row.cd_cartao === item.cartao);
  const income = item.tipo === 'entrada';
  const expense = item.tipo === 'saida';
  return <View style={ui.card}>
    <View style={ui.between}>
      <View style={ui.grow}><Text style={ui.label}>{item.descricao}</Text>
        <Text style={ui.muted}>{item.categoria} · {dateLabel(item.data)}</Text>
        <Text style={ui.muted}>{accountName(d, item.conta)}{destination}</Text>
        {(item.metodo || card || item.parcela) ? <Text style={ui.muted}>
          {[item.metodo, card && cardName(card), item.parcela && 'Parcela ' + item.parcela].filter(Boolean).join(' · ')}
        </Text> : null}
      </View>
      <Text style={[ui.label, income && ui.income, expense && ui.expense]}>
        {income ? '+ ' : expense ? '− ' : ''}{reais(item.valor)}
      </Text>
    </View>
    <View style={ui.between}>
      <View style={[ui.wrap, ui.grow]}>
        <Badge tone={item.status === 'efetivado' ? 'green' : 'amber'}>{item.status === 'efetivado' ? 'Efetivado' : 'Pendente'}</Badge>
        <PendingBadge pending={item.localPending} />
      </View>
      <View style={ui.row}>
        {item.edit && <IconButton name="pencil-outline" label={'Editar ' + item.descricao} onPress={() => open(item.edit)} />}
        {item.action && (item.action.acao !== 'pagar_fixa' || d.extensao_disponivel) &&
          <IconButton name={paymentIcon} label={(expense ? 'Marcar como paga: ' : 'Confirmar recebimento: ') + item.descricao}
            onPress={() => confirm(item.action, item.descricao)} />}
      </View>
    </View>
  </View>;
}

const defaults = { type: '', status: '', account: '', category: '', card: '', search: '' };

export function StatementScreen({ navigation, route, f, confirm, open }) {
  const d = f.view;
  const [period, setPeriod] = useState('90');
  const [filters, setFilters] = useState(defaults);
  const [show, setShow] = useState(false);
  const preset = route.params?.account;
  React.useEffect(() => {
    if (preset !== undefined) {
      setFilters({ ...defaults, account: preset });
      setShow(true);
      navigation.setParams({ account: undefined });
    }
  }, [preset, navigation]);
  const set = (field, value) => setFilters(current => ({ ...current, [field]: value, ...(field === 'account' ? { card: '' } : {}) }));
  const movements = useMemo(() => statement(d), [d]);
  const [start, end] = dateRange(d.mes, d.hoje);
  const search = normalize(filters.search.trim());
  const filtered = movements.filter(item => {
    if (period === 'month' ? !item.data.startsWith(d.mes) : item.data < start || item.data > end) return false;
    if (filters.type && item.tipo !== filters.type) return false;
    if (filters.status && item.status !== filters.status) return false;
    if (filters.account && ![item.conta, item.destino].includes(d.resolveId(filters.account))) return false;
    if (filters.category && item.categoriaId !== filters.category) return false;
    if (filters.card && item.cartao !== d.resolveId(filters.card)) return false;
    return !search || normalize([item.descricao, item.categoria, accountName(d, item.conta), item.destino && accountName(d, item.destino)].filter(Boolean).join(' ')).includes(search);
  });
  const cats = [
    ...d.categorias_entrada.map(c => ({ value: 'entrada:' + c.cd_categoria_entrada, label: 'Receita · ' + c.nm_categoria_entrada })),
    ...d.categorias_saida.map(c => ({ value: 'saida:' + c.cd_categoria_saida, label: 'Despesa · ' + c.ds_categoria_saida })),
    { value: 'transferencia', label: 'Transferências' },
  ];
  const all = [{ value: '', label: 'Todos' }];
  return <FlatList style={ui.page} contentContainerStyle={ui.content} data={filtered}
    keyExtractor={item => item.id} keyboardShouldPersistTaps="handled"
    refreshControl={<RefreshControl refreshing={f.syncing} onRefresh={f.sync} tintColor={colors.primary} />}
    ListHeaderComponent={<View style={{ gap: 12 }}>
      <Text accessibilityRole="header" style={ui.title}>Extrato</Text>
      <Chips value={period} options={periods} onChange={setPeriod} />
      <Field label="Buscar lançamentos" value={filters.search} onChangeText={value => set('search', value)} />
      <Button label={show ? 'Ocultar filtros' : 'Mostrar filtros'} secondary onPress={() => setShow(!show)} />
      {show && <View style={ui.card}>
        <Select label="Tipo" options={types} value={filters.type} onChange={v => set('type', v)} />
        <Select label="Status" options={statuses} value={filters.status} onChange={v => set('status', v)} />
        <Select label="Conta" options={[...all, ...optionsFrom(d.contas, 'cd_conta_usuario', 'nm_conta_usuario')]} value={d.resolveId(filters.account)} onChange={v => set('account', v)} />
        <Select label="Categoria" options={[...all, ...cats]} value={filters.category} onChange={v => set('category', v)} />
        <Select label="Cartão" options={[...all, ...optionsFrom(d.cartoes.filter(c => !filters.account || c.id_conta_usuario === d.resolveId(filters.account)), 'cd_cartao', cardName)]} value={d.resolveId(filters.card)} onChange={v => set('card', v)} />
        <Button label="Limpar filtros" secondary onPress={() => setFilters(defaults)} />
      </View>}
      <Text style={ui.muted}>{filtered.length} {filtered.length === 1 ? 'lançamento' : 'lançamentos'}
        {period === '90' ? ' · ' + dateLabel(start) + ' a ' + dateLabel(end) : ''}</Text>
    </View>}
    renderItem={({ item }) => <Movement item={item} d={d} confirm={confirm} open={open} />}
    ListEmptyComponent={<Empty>{f.hasSnapshot ? 'Nenhum lançamento encontrado.' : 'Aguardando dados do extrato deste mês.'}</Empty>} />;
}

export function NewScreen({ f, open }) {
  const d = f.view;
  const actions = [
    ['entrada', 'arrow-down-circle-outline', d.contas.length && d.categorias_entrada.length],
    ['saida', 'arrow-up-circle-outline', d.contas.length && d.categorias_saida.length && d.formas_pagamento.length],
    ['transferencia', 'swap-horizontal', d.contas.length >= 2],
    ['conta', 'bank-outline', d.tipos_conta.length],
    ['meta', 'flag-outline', d.metas_disponiveis && d.categorias_saida.length],
  ];
  return <Page f={f}>
    <Text accessibilityRole="header" style={ui.title}>Novo lançamento</Text>
    {!f.hasReferences && <Empty>Conecte-se à internet para carregar contas e categorias no primeiro acesso.</Empty>}
    {f.hasReferences && !d.contas.length && <Empty>Cadastre uma conta para registrar receitas e despesas.</Empty>}
    {actions.map(([acao, icon, enabled]) => <Pressable key={acao} accessibilityRole="button"
      accessibilityState={{ disabled: !enabled }} disabled={!enabled} onPress={() => open({ acao })} style={[ui.card, ui.between, !enabled && { opacity: 0.5 }]}>
      <Icon name={icon} /><Text style={[ui.subtitle, ui.grow]}>{formNames[acao]}</Text><Icon name="chevron-right" />
    </Pressable>)}
  </Page>;
}

function bankLabel(d, account) {
  return d.bancos?.[account.cd_ispb_banco] ??
    d.tipos_conta.find(t => t.cd_tipo_conta === account.id_tipo_conta)?.nm_tipo_conta ?? '';
}

function AccountBalance({ data, account }) {
  const balance = cents(account.vl_saldo_conta_usuario);
  const pending = data.movimentacoesSaldoPendentes.get(account.cd_conta_usuario) ?? 0;
  return <>
    <Text style={ui.money}>{reais(balance)}</Text>
    {pending !== 0 && <Text style={ui.muted}>Saldo estimado após sincronizar · {reais(balance + pending)}</Text>}
  </>;
}

export function Accounts({ f, open, confirm, navigation }) {
  const d = f.view;
  const [chosen, choose] = useState(null);
  const [copied, setCopied] = useState(null);
  const account = d.contas.find(c => c.cd_conta_usuario === d.resolveId(chosen));
  const balanceNotice = <>
    {d.credito_receitas_disponivel === false && <Text style={ui.muted}>Ative a migração 005 para sincronizar o saldo das receitas.</Text>}
    {d.saldo_movimentacoes_disponivel === false && <Text style={ui.muted}>Ative a migração 006 para sincronizar o saldo de despesas e transferências.</Text>}
  </>;
  if (!account) return <Page f={f}>
    <View style={ui.between}>
      <Text accessibilityRole="header" style={ui.title}>Contas</Text>
      <IconButton name="plus" label="Adicionar conta" disabled={!d.tipos_conta.length} onPress={() => open({ acao: 'conta' })} />
    </View>
    {balanceNotice}
    {(f.hasReferences || d.contas.length > 0) && <Section title="Patrimônio total"><Text style={ui.money}>{reais(sum(d.contas, 'vl_saldo_conta_usuario'))}</Text></Section>}
    {!d.contas.length && <Empty>{f.hasReferences ? 'Nenhuma conta cadastrada.' : 'Aguardando dados das contas.'}</Empty>}
    {d.contas.map(c => <Pressable style={ui.card} key={c.cd_conta_usuario} accessibilityRole="button" onPress={() => choose(c.cd_conta_usuario)}>
      <View style={ui.row}>
        <BankLogo code={c.cd_ispb_banco} label={d.bancos?.[c.cd_ispb_banco] ?? c.nm_conta_usuario} size={43} />
        <View style={ui.grow}>
          <Text style={ui.subtitle}>{c.nm_conta_usuario}</Text>
          <Text style={ui.muted}>{bankLabel(d, c)}</Text>
        </View>
        <Icon name="chevron-right" />
      </View>
      <AccountBalance data={d} account={c} />
      <PendingBadge pending={c.localPending} />
    </Pressable>)}
  </Page>;

  const id = account.cd_conta_usuario;
  const details = d.detalhes_contas.find(row => row.id_conta_usuario === id);
  const pix = d.chaves_pix.filter(row => row.id_conta_usuario === id);
  const cards = d.cartoes.filter(row => row.id_conta_usuario === id);
  const [start, end] = dateRange(d.mes, d.hoje);
  const entries = statement(d).filter(row => [row.conta, row.destino].includes(id) && row.data >= start && row.data <= end);
  async function copyPix(item) {
    try {
      const success = await Clipboard.setStringAsync(item.ds_chave);
      if (!success) throw new Error('Falha ao copiar.');
      setCopied(item.cd_chave_pix);
    } catch {
      Alert.alert('Chave Pix', 'Não foi possível copiar a chave.');
    }
  }

  function edit() {
    open({ acao: 'conta', seed: {
      id, nome: account.nm_conta_usuario, saldo: account.vl_saldo_conta_usuario, id_tipo_conta: account.id_tipo_conta,
      banco: account.cd_ispb_banco || 'sem-banco', titular: details?.nm_titular,
      agencia: details?.ds_agencia, numero: details?.ds_numero_conta,
    } });
  }
  return <Page f={f}>
    <View style={ui.between}>
      <IconButton name="arrow-left" label="Voltar às contas" onPress={() => choose(null)} />
      <Text accessibilityRole="header" style={[ui.title, ui.grow]}>{account.nm_conta_usuario}</Text>
      <IconButton name="pencil-outline" label="Editar conta" onPress={edit} />
    </View>
    <View style={ui.card}>
      <View style={ui.row}>
        <BankLogo code={account.cd_ispb_banco} label={d.bancos?.[account.cd_ispb_banco] ?? account.nm_conta_usuario} size={43} />
        <Text style={[ui.text, ui.grow]}>{bankLabel(d, account)}</Text>
      </View>
      <AccountBalance data={d} account={account} />
      {balanceNotice}
      {details?.nm_titular && <Text style={ui.text}>Titular · {details.nm_titular}</Text>}
      {details?.ds_agencia && <Text style={ui.text}>Agência · {details.ds_agencia}</Text>}
      {details?.ds_numero_conta && <Text style={ui.text}>Conta · {details.ds_numero_conta}</Text>}
      <PendingBadge pending={account.localPending} />
    </View>
    <Section title="Chaves Pix" action={<IconButton name="plus" label="Adicionar chave Pix" disabled={!d.extensao_disponivel} onPress={() => open({ acao: 'pix', accountId: id })} />}>
      {pix.length ? pix.map(item => <View key={item.cd_chave_pix} style={ui.between}>
        <View style={ui.grow}>
          <Text style={ui.label}>{item.tp_chave.toUpperCase()}</Text>
          <Text selectable style={ui.text}>{item.ds_chave}</Text>
          <PendingBadge pending={item.localPending} />
          {copied === item.cd_chave_pix && <Text accessibilityLiveRegion="polite" style={ui.muted}>Chave copiada</Text>}
        </View>
        <IconButton name={copied === item.cd_chave_pix ? 'check' : 'content-copy'}
          label={'Copiar chave Pix ' + item.tp_chave} onPress={() => copyPix(item)} />
      </View>) : <Empty>{d.extensao_disponivel ? 'Nenhuma chave cadastrada.' : 'Cadastro de Pix indisponível.'}</Empty>}
    </Section>
    <Section title="Cartões vinculados" action={<IconButton name="plus" label="Adicionar cartão" disabled={!d.extensao_disponivel} onPress={() => open({ acao: 'cartao', accountId: id })} />}>
      {cards.length ? cards.map(item => <View key={item.cd_cartao}>
        <Text style={ui.label}>{cardName(item)}</Text>
        <Text style={ui.muted}>{({ debito: 'Débito', credito: 'Crédito', multiplo: 'Múltiplo' })[item.tp_cartao]}
          {item.dt_validade && ' · Validade ' + item.dt_validade.slice(0, 7).split('-').reverse().join('/')}
          {item.nr_dia_vencimento && ' · Vence dia ' + item.nr_dia_vencimento}</Text>
        <PendingBadge pending={item.localPending} />
      </View>) : <Empty>{d.extensao_disponivel ? 'Nenhum cartão cadastrado.' : 'Cadastro de cartões indisponível.'}</Empty>}
    </Section>
    <Section title="Extrato da conta" action={<Button label="Ver extrato" secondary onPress={() => navigation.navigate('Extrato', { account: id })} />}>
      <Text style={ui.muted}>Últimos 90 dias</Text>
      {!entries.length && <Empty>{f.hasSnapshot ? 'Nenhum lançamento no período.' : 'Extrato deste mês indisponível no dispositivo.'}</Empty>}
      {entries.slice(0, 8).map(item => <Movement key={item.id} item={item} d={d} confirm={confirm} open={open} />)}
    </Section>
  </Page>;
}

export function Stats({ f }) {
  const d = f.view;
  const [range, setRange] = useState('6');
  const fixed = fixedExpenses(d);
  const total = sum(fixed, 'vl_saida_fixa');
  const categories = new Map();
  for (const item of fixed) {
    categories.set(item.id_categoria_saida, (categories.get(item.id_categoria_saida) ?? 0) + cents(item.vl_saida_fixa));
  }
  const historic = Array.from({ length: Number(range) }, (_, i) => {
    const month = monthShift(d.mes, i + 1 - Number(range));
    const value = sum(d.historico_saidas.filter(s => day(s.dt_saida).startsWith(month) && s.ic_pago &&
      day(s.dt_pagamento || s.dt_saida) <= d.hoje), 'vl_saida');
    return { month, value };
  });
  const hasHistory = Number(range) <= (d.meses_historico_saidas ?? 6);
  const historicMax = Math.max(...historic.map(point => point.value));
  return <Page f={f}>
    <Text accessibilityRole="header" style={ui.title}>Estatísticas</Text>
    <Section title="Gastos fixos">
      {(f.hasSnapshot || fixed.length > 0) && <Text style={ui.money}>{reais(total)}</Text>}
      {!fixed.length && <Empty>{f.hasSnapshot ? 'Nenhum gasto fixo neste mês.' : 'Aguardando dados de gastos fixos.'}</Empty>}
      {[...categories].sort((a, b) => b[1] - a[1]).map(([id, value]) =>
        <AmountBar key={id} label={categoryName(d, 'saida', id) + ' · ' + Math.round(value / total * 100) + '%'} value={value} max={total} />)}
      {fixed.map(row => <View key={row.cd_saida_fixa} style={ui.between}>
        <Text style={[ui.text, ui.grow]}>{row.nm_saida_fixa} · dia {row.dt_dia_saida_fixa}</Text>
        <Text style={ui.label}>{reais(cents(row.vl_saida_fixa))}</Text>
      </View>)}
    </Section>
    <Section title="Histórico de despesas pagas">
      <Chips options={statsPeriods} value={range} onChange={setRange} />
      {!hasHistory ? <Empty>{f.syncing ? 'Carregando o histórico de 12 meses…' : 'Sincronize para carregar o histórico de 12 meses.'}</Empty> :
        f.hasSnapshot || historic.some(point => point.value) ? <>
          <Text style={ui.money}>{reais(historic.reduce((totalValue, point) => totalValue + point.value, 0))}</Text>
          {historic.map(point => <AmountBar key={point.month} label={monthName(point.month)} value={point.value}
            max={historicMax} tone="red" />)}
        </> : <Empty>Aguardando dados do histórico.</Empty>}
    </Section>
  </Page>;
}

