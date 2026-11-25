import React, { useEffect, useRef, useState } from 'react';
import { BackHandler, KeyboardAvoidingView, Platform, ScrollView, StyleSheet, Switch, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { cardName, day } from '../finance';
import { amount, parseFormDate } from '../formValues';
import { BankLogo, Button, Field, IconButton, Select, colors, optionsFrom, ui } from './FinanceUI';
import { DateField, MoneyField } from './MovementFields';

export const formNames = {
  entrada: 'Receita', saida: 'Despesa', transferencia: 'Transferência', conta: 'Conta',
  meta: 'Meta de gastos', pix: 'Chave Pix', cartao: 'Cartão',
};

const options = pairs => pairs.map(([value, label]) => ({ value, label }));
const frequencies = options([['unica', 'Única'], ['fixa', 'Fixa (mensal)'], ['parcelada', 'Parcelada']]);
const pixTypes = options([['cpf', 'CPF'], ['cnpj', 'CNPJ'], ['email', 'E-mail'], ['telefone', 'Telefone'], ['aleatoria', 'Aleatória']]);
const cardTypes = options([['debito', 'Débito'], ['credito', 'Crédito'], ['multiplo', 'Múltiplo']]);
const empty = [{ value: '', label: 'Nenhum' }];
const masterBank = '33923798';

function bankOptions(banks = {}) {
  const entries = Object.entries(banks);
  const ordered = [...entries.filter(([code]) => code === masterBank), ...entries.filter(([code]) => code !== masterBank)];
  return [{ value: 'sem-banco', label: 'Sem banco vinculado' }, ...options(ordered)];
}

function requireDate(value, label) {
  const iso = parseFormDate(value);
  if (!iso) throw new Error('Informe uma data válida em ' + label.toLowerCase() + ' (DD/MM/AAAA).');
  return iso;
}

function requireMonth(value, label) {
  const br = /^(\d{2})\/(\d{4})$/.exec(value);
  const iso = br ? br[2] + '-' + br[1] : value;
  return requireDate(iso + '-01', label).slice(0, 7);
}

function documentValid(value, length) {
  if (value.length !== length || !/^\d+$/.test(value) || /^(\d)\1+$/.test(value)) return false;
  const cpf = length === 11;
  const digits = [...value].map(Number);
  for (let size = length - 2; size < length; size++) {
    const sum = digits.slice(0, size).reduce((total, digit, i) =>
      total + digit * (cpf ? size + 1 - i : (size - i - 1) % 8 + 2), 0);
    if (digits[size] !== (sum % 11 < 2 ? 0 : 11 - sum % 11)) return false;
  }
  return true;
}

function buildFormFields(d, acao, values, fixedAccountId) {
  const accounts = optionsFrom(d.contas, 'cd_conta_usuario', 'nm_conta_usuario');
  const income = optionsFrom(d.categorias_entrada, 'cd_categoria_entrada', 'nm_categoria_entrada');
  const expense = optionsFrom(d.categorias_saida, 'cd_categoria_saida', 'ds_categoria_saida');
  const select = (key, label, choices, optional = false) => ({ key, label, choices, optional });
  const input = (key, label, kind = 'text', maxLength, optional = false) => ({ key, label, kind, maxLength, optional });
  const account = select('id_conta_usuario', 'Conta', accounts);
  const money = input('valor', 'Valor', 'money');
  const when = input('data', 'Data do lançamento', 'date', 10);
  const desc = (len, optional = false) => input('descricao', 'Descrição', 'text', len, optional);
  const name = (label, len = 60) => input('nome', label, 'text', len);
  if (acao === 'entrada' || acao === 'saida') {
    const isExpense = acao === 'saida';
    const fields = [desc(isExpense ? 60 : 45), money, when];
    if (!fixedAccountId) fields.push(account);
    fields.push(select('id_categoria', 'Categoria', isExpense ? expense : income));

    if (isExpense) {
      const cards = d.cartoes.filter(card => card.id_conta_usuario === values.id_conta_usuario);
      const paymentMethods = optionsFrom(d.formas_pagamento, 'cd_forma_pagamento', 'nm_forma_pagamento');
      fields.push(input('vencimento', 'Vencimento', 'date', 10));
      fields.push(select('id_forma_pagamento', 'Forma de pagamento', paymentMethods));
      if (cards.length) {
        const cardOptions = [...empty, ...optionsFrom(cards, 'cd_cartao', cardName)];
        fields.push(select('id_cartao', 'Cartão vinculado (opcional)', cardOptions, true));
      }
      fields.push({ key: 'pago', label: 'Já paga', kind: 'switch' });
    }

    if (values.id) return fields;
    const availableFrequencies = frequencies.filter(({ value }) => {
      if (value === 'unica') return true;
      if (isExpense) return value === 'parcelada' || d.extensao_disponivel;
      return d.entradas_recorrentes_disponiveis;
    });
    fields.push(select('frequencia', 'Frequência', availableFrequencies));
    if (values.frequencia === 'parcelada') {
      fields.push(input('parcelas', 'Quantidade de parcelas', 'integer', 2));
    }
    return fields;
  }
  if (acao === 'conta') return [
    name('Nome da conta', 45), select('id_tipo_conta', 'Tipo de conta', optionsFrom(d.tipos_conta, 'cd_tipo_conta', 'nm_tipo_conta')),
    ...(d.bancos_disponiveis ? [select('banco', 'Instituição', bankOptions(d.bancos))] : []),
    input('saldo', 'Saldo (R$)', 'balance', 16, true),
    ...(d.extensao_disponivel ? [
      input('titular', 'Titular (opcional)', 'text', 120, true),
      input('agencia', 'Agência (opcional)', 'text', 15, true), input('numero', 'Número da conta (opcional)', 'text', 30, true),
    ] : []),
  ];
  if (acao === 'transferencia') return [
    select('id_conta_origem', 'Conta de origem', accounts), select('id_conta_destino', 'Conta de destino', accounts),
    money, when, desc(60, true),
  ];
  if (acao === 'meta') return [
    name('Nome da meta'), select('id_categoria_saida', 'Categoria da despesa', expense),
    input('valor', 'Limite (R$)', 'amount', 16), input('mes', 'Mês de referência', 'month', 7),
  ];
  if (acao === 'pix') return [
    ...(fixedAccountId ? [] : [account]), select('tipo', 'Tipo de chave', pixTypes), input('chave', 'Chave Pix', 'text', 180),
  ];
  return [
    ...(fixedAccountId ? [] : [account]), name('Nome do cartão'), select('tipo', 'Tipo de cartão', cardTypes),
    input('final', 'Últimos quatro dígitos', 'integer', 4), input('validade', 'Validade (opcional)', 'month', 7, true),
    ...(values.tipo !== 'debito' ? [input('dia', 'Dia do vencimento (opcional)', 'integer', 2, true)] : []),
  ];
}

function validateForm(acao, fields, values, fixedAccountId) {
  const data = { acao, ...(values.id ? { id: values.id } : {}), ...(fixedAccountId ? { id_conta_usuario: fixedAccountId } : {}) };
  if (values.id && (acao === 'entrada' || acao === 'saida')) data.original = values.original;
  for (const field of fields) {
    const { key, label, choices, optional, kind, maxLength } = field;
    const value = values[key] ?? '';
    if (choices) {
      const validChoice = value ? choices.some(item => item.value === value) : optional;
      if (!validChoice) throw new Error('Selecione ' + label.toLowerCase() + '.');
      if (value) data[key] = value;
      continue;
    }
    if (kind === 'switch') {
      data[key] = Boolean(value);
      continue;
    }
    if (['money', 'amount', 'balance'].includes(kind)) {
      data[key] = amount(value, kind === 'balance');
      continue;
    }

    const text = String(value).trim();
    if (!optional && !text) throw new Error('Preencha ' + label.toLowerCase() + '.');
    if (text.length > maxLength) throw new Error('Verifique o tamanho de ' + label.toLowerCase() + '.');
    if (kind === 'integer' && text && !/^\d+$/.test(text)) {
      throw new Error('Informe apenas números em ' + label.toLowerCase() + '.');
    }
    if (text && kind === 'date') data[key] = requireDate(text, label);
    else if (text && kind === 'month') data[key] = requireMonth(text, label);
    else data[key] = text;
  }
  if ((values.original?.id_entrada_fixa || values.original?.id_saida_fixa)
    && data.data.slice(0, 7) !== day(values.original['dt_' + acao]).slice(0, 7)) {
    throw new Error('Escolha uma data dentro do mês desta ocorrência.');
  }
  if (acao === 'transferencia' && data.id_conta_origem === data.id_conta_destino) throw new Error('Escolha contas diferentes para origem e destino.');
  if (data.parcelas && (data.parcelas < 2 || data.parcelas > 60 || Math.round(Number(data.valor) * 100) < Number(data.parcelas))) {
    throw new Error('Informe de 2 a 60 parcelas, com pelo menos R$ 0,01 por parcela.');
  }
  if (data.parcelas && [data.data, data.vencimento].filter(Boolean).some(day => {
    return Number(day.slice(0, 4)) * 12 + Number(day.slice(5, 7)) + Number(data.parcelas) - 1 > 2100 * 12 + 12;
  })) throw new Error('As parcelas devem terminar até dezembro de 2100.');
  if (acao === 'cartao' && (!/^\d{4}$/.test(data.final) || (data.dia && (Number(data.dia) < 1 || Number(data.dia) > 31)))) {
    throw new Error('Confira os quatro últimos dígitos e o dia de vencimento (1 a 31).');
  }
  if (acao === 'pix') {
    const checks = {
      cpf: value => documentValid(value, 11), cnpj: value => documentValid(value, 14),
      email: value => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value),
      telefone: value => /^\+?[1-9]\d{9,14}$/.test(value),
      aleatoria: value => /^[\da-f]{8}(-[\da-f]{4}){3}-[\da-f]{12}$/i.test(value),
    };
    if (!checks[data.tipo](data.chave)) throw new Error('Confira a chave Pix. Use apenas dígitos para CPF ou CNPJ e inclua o DDI no telefone.');
  }
  return data;
}

function getInitialValues(d, config) {
  const seed = config.operation?.payload ?? config.seed ?? {};
  return { data: d.hoje, vencimento: d.hoje, mes: d.mes, banco: 'sem-banco', frequencia: 'unica', ...seed };
}

export default function FinanceForm({ data, config, onClose, onSave }) {
  const { acao, accountId, operation, legacyId } = config;
  const [rawValues, setValues] = useState(() => getInitialValues(data, config));
  const values = { ...rawValues };
  for (const field of ['id', 'id_conta_usuario', 'id_conta_origem', 'id_conta_destino', 'id_cartao']) {
    if (values[field]) values[field] = data.resolveId(values[field]);
  }
  const [openDateField, setOpenDateField] = useState(null);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const saveInProgress = useRef(false);
  const editingMovement = Boolean(values.id && (acao === 'entrada' || acao === 'saida'));
  const fixedMovement = editingMovement && Boolean(values.original?.id_entrada_fixa || values.original?.id_saida_fixa);
  const fixedAccountId = fixedMovement ? values.id_conta_usuario : accountId;
  const fields = buildFormFields(data, acao, values, fixedAccountId);

  useEffect(() => {
    const listener = BackHandler.addEventListener('hardwareBackPress', () => {
      if (!saveInProgress.current) onClose();
      return true;
    });
    return () => listener.remove();
  }, [onClose]);

  function updateField(key, value) {
    setValues(current => {
      const next = { ...current, [key]: value };
      if (key === 'id_conta_usuario') next.id_cartao = '';
      if (key === 'data' && current.data === current.vencimento) next.vencimento = value;
      return next;
    });
  }

  async function submitForm() {
    if (saveInProgress.current) return;
    saveInProgress.current = true;
    setBusy(true);
    setError(null);
    try {
      await onSave(validateForm(acao, fields, values, data.resolveId(fixedAccountId)), { operation, legacyId });
      onClose();
    } catch (problem) {
      setError(problem.message);
    } finally {
      saveInProgress.current = false;
      setBusy(false);
    }
  }

  return (
    <SafeAreaView style={[StyleSheet.absoluteFillObject, ui.page]} edges={['bottom']} accessibilityViewIsModal>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={ui.grow}>
        <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={ui.content}>
          <View style={ui.between}>
            <Text accessibilityRole="header" style={[ui.title, ui.grow]}>{editingMovement ? 'Editar ' + formNames[acao].toLowerCase() : formNames[acao]}</Text>
            <IconButton name="close" label="Fechar formulário" disabled={busy} onPress={onClose} />
          </View>
          {config.legacyId && <Text style={ui.muted}>Revise o lançamento e selecione a conta e a categoria.</Text>}
          {fixedMovement && <Text style={ui.muted}>Edite esta ocorrência dentro do mês e da conta da recorrência.</Text>}
          {editingMovement && values.original?.nr_parcela && <Text style={ui.muted}>Editando a parcela {values.original.nr_parcela}.</Text>}
          {operation?.error && <Text style={ui.error}>{operation.error}</Text>}
          {fields.map(({ key, choices, label, kind, maxLength }) => {
            if (choices) return <Select key={key} label={label} value={values[key]} options={choices} onChange={v => updateField(key, v)}
              renderIcon={key === 'banco' ? option => <BankLogo code={option.value} label={option.label} /> : undefined} />;
            if (kind === 'money') return <MoneyField key={key} label={label} value={values[key]} onChange={v => updateField(key, v)} />;
            if (kind === 'date') return <DateField key={key} label={label} value={values[key]} today={data.hoje}
              onChange={v => updateField(key, v)} open={openDateField === key} onOpen={() => setOpenDateField(key)} onClose={() => setOpenDateField(null)} />;
            if (kind === 'switch') return <View key={key} style={ui.between}>
              <Text style={ui.label}>{label}</Text><Switch accessibilityLabel={label} value={Boolean(values[key])}
                onValueChange={v => updateField(key, v)} trackColor={{ true: colors.primary }} />
            </View>;
            return <Field key={key} label={label} value={String(values[key] ?? '')} onChangeText={v => updateField(key, v)}
              maxLength={maxLength} placeholder={kind === 'month' ? 'MM/AAAA' : undefined}
              keyboardType={kind === 'integer' ? 'number-pad' : ['amount', 'balance'].includes(kind) ? 'decimal-pad' : 'default'}
              autoCapitalize={key === 'chave' ? 'none' : 'sentences'} />;
          })}
          {error && <Text accessibilityLiveRegion="polite" style={ui.error}>{error}</Text>}
          <Button label="Salvar" onPress={submitForm} busy={busy} />
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

