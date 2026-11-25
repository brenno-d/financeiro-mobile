import * as SecureStore from 'expo-secure-store';
import * as Crypto from 'expo-crypto';
import { operationData, dateInZone, expenseHistoryMonths, monthShift } from './finance';
import banks from './assets/bancos.json';

const url = (process.env.EXPO_PUBLIC_SUPABASE_URL ?? '').trim().replace(/\/+$/, '');
const key = (process.env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? '').trim();
const sessionKey = 'financas.supabase.session';
const confirmationRedirect = process.env.EXPO_PUBLIC_SUPABASE_AUTH_REDIRECT_URL?.trim() || 'financas://auth/confirmado';
const redirect = '?redirect_to=' + encodeURIComponent(confirmationRedirect);

function publicKey(value) {
  if (value.startsWith('sb_publishable_')) return true;
  try {
    const encoded = value.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
    return JSON.parse(atob(encoded)).role === 'anon';
  } catch {
    return false;
  }
}

export const configured = /^https:\/\/[^/?#@]+$/i.test(url) && publicKey(key);

class SupabaseError extends Error {
  constructor(message, status, code) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

async function request(path, { token, body, signal, headers, includeRange } = {}) {
  if (!configured) throw new Error('Configure a conexão para sincronizar.');
  const controller = new AbortController();
  const abort = () => controller.abort();
  signal?.addEventListener('abort', abort);
  if (signal?.aborted) abort();
  const timeout = setTimeout(abort, 20000);
  try {
    const response = await fetch(url + path, {
      method: body === undefined ? 'GET' : 'POST',
      headers: {
        apikey: key,
        ...(token ? { Authorization: 'Bearer ' + token } : {}),
        ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
        ...headers,
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: controller.signal,
    });
    const raw = await response.text();
    let data;
    try {
      data = raw ? JSON.parse(raw) : null;
    } catch {
      throw new SupabaseError('O serviço de sincronização retornou uma resposta inválida.', response.status);
    }
    if (!response.ok) {
      throw new SupabaseError(
        data?.message ?? data?.msg ?? data?.error_description ?? 'Não foi possível acessar o serviço de sincronização.',
        response.status, data?.error_code ?? data?.code,
      );
    }
    return includeRange ? { data, range: response.headers.get('Content-Range') } : data;
  } catch (error) {
    if (error instanceof SupabaseError) throw error;
    throw new SupabaseError('Sincronização indisponível no momento. As alterações continuam no aparelho.', 0);
  } finally {
    clearTimeout(timeout);
    signal?.removeEventListener('abort', abort);
  }
}

function auth(path, body) {
  return request('/auth/v1/' + path, { body });
}

export async function login(email, senha) {
  const result = await auth('token?grant_type=password', { email, password: senha });
  const profiles = await request('/rest/v1/rpc/vincular_usuario_auth', { token: result.access_token, body: {} });
  const profile = profiles?.[0];
  if (!profile?.cd_usuario || !result.user?.id || !result.refresh_token) {
    throw new Error('O perfil financeiro está indisponível.');
  }
  const session = {
    url, id: result.user.id, userId: profile.cd_usuario,
    email: result.user.email, name: profile.nm_usuario, refresh: result.refresh_token,
  };
  await saveSession(session);
  return { session, access: { token: result.access_token, expires: Date.now() + result.expires_in * 1000 } };
}

export async function register(nome, email, senha) {
  const result = await auth('signup' + redirect, { email, password: senha, data: { nome } });
  return result?.access_token ? 'Conta criada. Entre com seu e-mail e senha.' :
    'Confirme sua conta pelo link enviado ao seu e-mail.';
}

export function resendConfirmation(email) {
  return auth('resend' + redirect, { email, type: 'signup' });
}

export async function restoreSession() {
  const raw = await SecureStore.getItemAsync(sessionKey);
  const session = raw && JSON.parse(raw);
  return session?.url === url && session.id && session.refresh ? session : null;
}

function saveSession(session) {
  return SecureStore.setItemAsync(sessionKey, JSON.stringify(session));
}

export function forgetSession() {
  return SecureStore.deleteItemAsync(sessionKey);
}

export function ownerOf(session) {
  return session.url + '|' + session.id;
}

export function authMessage(error) {
  const messages = {
    invalid_credentials: 'E-mail ou senha incorretos.',
    email_not_confirmed: 'Confirme seu e-mail antes de entrar.',
    user_already_exists: 'Este e-mail já está cadastrado.',
    email_exists: 'Este e-mail já está cadastrado.',
    weak_password: 'A senha precisa ter pelo menos 8 caracteres.',
    PGRST202: 'O serviço de perfil precisa ser configurado.',
  };
  return messages[error.code] ?? error.message;
}

export function createClient(session, initialAccess) {
  let current = session;
  let access = initialAccess;
  let renewal;

  function renew() {
    renewal ??= auth('token?grant_type=refresh_token', { refresh_token: current.refresh })
      .then(async result => {
        if (result.user?.id !== current.id || !result.refresh_token || !result.access_token) {
          throw new SupabaseError('Entre novamente para sincronizar.', 401);
        }
        current = { ...current, refresh: result.refresh_token };
        await saveSession(current);
        access = { token: result.access_token, expires: Date.now() + result.expires_in * 1000 };
        return access.token;
      }).catch(error => {
        if ([400, 401, 403].includes(error.status)) {
          throw new SupabaseError('Entre novamente para sincronizar.', 401, error.code);
        }
        throw error;
      }).finally(() => { renewal = null; });
    return renewal;
  }

  async function authorized(path, options = {}) {
    const token = access?.expires > Date.now() + 30000 ? access.token : await renew();
    try {
      return await request(path, { ...options, token });
    } catch (error) {
      if (error.status !== 401 || options.signal?.aborted) throw error;
      const newToken = access?.token !== token ? access?.token : await renew();
      return request(path, { ...options, token: newToken });
    }
  }

  async function rows(table, order, filters, own, signal) {
    const query = new URLSearchParams({
      select: '*', order: order + '.asc', ...filters,
      ...(own ? { id_usuario: 'eq.' + session.userId } : {}),
    });
    query.set('limit', '500');
    const records = [];
    for (let offset = 0; ; offset = records.length) {
      query.set('offset', String(offset));
      const { data, range } = await authorized('/rest/v1/' + table + '?' + query, {
        signal, headers: { Prefer: 'count=exact' }, includeRange: true,
      });
      if (!Array.isArray(data)) throw new Error('Dados inválidos recebidos na sincronização.');
      records.push(...data);
      const total = Number(range?.split('/')[1]);
      if (!data.length || (Number.isFinite(total) && records.length >= total)) return records;
    }
  }

  async function dashboard(month, signal) {
    const start = monthShift(month, -5) + '-01T00:00:00-03:00';
    const expenseStart = monthShift(month, 1 - expenseHistoryMonths) + '-01T00:00:00-03:00';
    const end = monthShift(month, 1) + '-01T00:00:00-03:00';
    const range = (field, from = start) => field + '.gte.' + from + ',' + field + '.lt.' + end;
    const period = field => ({ and: '(' + range(field) + ')' });
    const optional = promise => promise.then(data => ({ data, available: true })).catch(error => {
      if (error.status === 404 && ['42P01', 'PGRST205'].includes(error.code)) {
        return { data: [], available: false };
      }
      throw error;
    });
    const own = (table, order, filters = {}) => rows(table, order, filters, true, signal);
    const lookup = (table, order) => rows(table, order, {}, false, signal);
    const refreshBalances = rpc => authorized('/rest/v1/rpc/' + rpc, { body: {}, signal })
      .then(() => true)
      .catch(error => {
        if (error.status === 404 && error.code === 'PGRST202') return false;
        throw error;
      });
    const balanceSupport = Promise.all([
      refreshBalances('fn_atualizar_saldos_receitas'),
      refreshBalances('fn_atualizar_saldos_movimentacoes'),
    ]);
    const [historico_entradas, historico_saidas, transferencias, fixas, pendentes, contas,
      categorias_entrada, categorias_saida, formas_pagamento, tipos_conta, metas, detalhes, pix, cartoes, fixasEntrada, syncSupport, [creditsAvailable, movementsAvailable]] =
      await Promise.all([
        own('tb_entradas', 'cd_entrada', period('dt_entrada')),
        own('tb_saidas', 'cd_saida', { or: '(and(' + range('dt_saida', expenseStart) + '),and(ic_pago.eq.true,' + range('dt_pagamento', expenseStart) + '))' }),
        own('tb_transferencias', 'cd_transferencia', period('dt_transferencia')),
        own('tb_saidas_fixas', 'cd_saida_fixa', { ic_ativa: 'eq.true' }),
        own('tb_saidas', 'cd_saida', { ic_pago: 'eq.false' }),
        balanceSupport.then(() => own('tb_contas_usuarios', 'cd_conta_usuario', { ic_ativa: 'eq.true' })),
        lookup('tb_categoria_entrada', 'cd_categoria_entrada'),
        lookup('tb_categorias_saidas', 'cd_categoria_saida'),
        lookup('tb_formas_pagamentos', 'cd_forma_pagamento'),
        lookup('tb_tipos_contas', 'cd_tipo_conta'),
        optional(own('tb_metas_gastos', 'cd_meta_gasto', { dt_mes_referencia: 'eq.' + month + '-01' })),
        optional(own('tb_detalhes_contas', 'id_conta_usuario')),
        optional(own('tb_chaves_pix', 'cd_chave_pix')),
        optional(own('tb_cartoes', 'cd_cartao')),
        optional(own('tb_entradas_fixas', 'cd_entrada_fixa', { ic_ativa: 'eq.true' })),
        optional(authorized('/rest/v1/tb_operacoes_mobile?select=operacao&limit=0', { signal })),
        balanceSupport,
      ]);
    return {
      mes: month, hoje: dateInZone(), historico_entradas, historico_saidas, transferencias, fixas, pendentes, contas,
      categorias_entrada, categorias_saida, formas_pagamento, tipos_conta, metas: metas.data,
      detalhes_contas: detalhes.data, chaves_pix: pix.data, cartoes: cartoes.data, fixas_entrada: fixasEntrada.data,
      metas_disponiveis: metas.available, extensao_disponivel: detalhes.available && pix.available && cartoes.available,
      entradas_recorrentes_disponiveis: fixasEntrada.available, bancos_disponiveis: fixasEntrada.available, bancos: banks,
      sincronizacao_disponivel: syncSupport.available, credito_receitas_disponivel: creditsAvailable,
      saldo_movimentacoes_disponivel: movementsAvailable, meses_historico_saidas: expenseHistoryMonths,
    };
  }

  async function send(wire, signal) {
    const editing = ['editar_entrada', 'editar_saida'].includes(wire.p_acao);
    const rpc = editing ? 'fn_editar_lancamento_mobile' : 'fn_sincronizar_financas';
    try {
      const receipt = await authorized('/rest/v1/rpc/' + rpc, { body: wire, signal });
      if (!(Number(receipt?.id) > 0)) throw new Error('A sincronização não confirmou a operação.');
      return receipt;
    } catch (error) {
      if (editing && error.code === 'PGRST202') error.migration = 'Ative a migração 007 para sincronizar edições.';
      throw error;
    }
  }

  return { dashboard, send, waitForRenewal: () => renewal?.catch(() => {}) };
}

export async function makeWire(id, payload) {
  const [action, data] = operationData(payload);
  return {
    p_operacao: id,
    p_hash: await Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, JSON.stringify([action, data])),
    p_acao: action,
    p_dados: data,
  };
}

export const migrationMessage = 'Ative a migração 004 para sincronizar alterações.';

export function operationError(error) {
  if (error.code === 'PGRST202') return error.migration ?? migrationMessage;
  if (error.code === '42501') return 'Permissão negada na sincronização (42501). ' + error.message;
  if (error.code === '23505') return 'Já existe um registro com esses dados.';
  if (error.code === '23503') return 'A conta, categoria ou cartão vinculado está indisponível.';
  if (error.code === '23514' || error.code === '22P02') return 'Confira os dados informados.';
  if (error.code === 'P0002') return 'O registro não está mais disponível.';
  return error.message;
}

