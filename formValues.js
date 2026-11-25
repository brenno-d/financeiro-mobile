function normalizeMoneyText(value) {
  const text = String(value ?? '').trim();
  return /^-?\d{1,3}(\.\d{3})+,\d{1,2}$/.test(text) ? text.replace(/\./g, '') : text;
}

export function amount(value, allowNegative) {
  const text = normalizeMoneyText(value);
  if (allowNegative && !text) return '0.00';

  const pattern = allowNegative ? /^-?\d{1,9}([,.]\d{1,2})?$/ : /^\d{1,6}([,.]\d{1,2})?$/;
  const reais = Number(text.replace(',', '.'));
  if (pattern.test(text) && (allowNegative || reais > 0)) return reais.toFixed(2);

  throw new Error(allowNegative
    ? 'Informe um saldo válido com até duas casas decimais.'
    : 'Informe um valor entre R$ 0,01 e R$ 999.999,99, com até duas casas decimais.');
}

function splitDecimal(value) {
  return /^(-?)(\d+)(?:[,.](\d{1,2}))?$/.exec(value);
}

export function displayMoney(value) {
  const parts = splitDecimal(normalizeMoneyText(value));
  if (!parts) return String(value ?? '');
  const [, sign, integer, fraction = ''] = parts;
  return sign + integer.replace(/\B(?=(\d{3})+(?!\d))/g, '.') + ',' + fraction.padEnd(2, '0');
}

export function maskMoney(text, previous) {
  const displayed = displayMoney(previous);
  const pasted = text.includes('R$') || text.length > displayed.length + 1;
  const value = text.replace(/R\$\s*/g, '').trim();
  if (pasted) {
    const normalized = /^-?\d{1,3}(\.\d{3})+$/.test(value) ? value.replace(/\./g, '') : normalizeMoneyText(value);
    const parts = splitDecimal(normalized);
    if (!parts) return value;
    const [, sign, integer, fraction = ''] = parts;
    return sign + integer + '.' + fraction.padEnd(2, '0');
  }
  const digits = value.replace(/\D/g, '');
  const clearingZero = displayed === '0,00' && text.length < displayed.length && !/[1-9]/.test(digits);
  if (!digits || clearingZero) return value === '-' ? '-' : '';
  const padded = digits.replace(/^0+/, '').padStart(3, '0');
  return (value.startsWith('-') ? '-' : '') + padded.slice(0, -2) + '.' + padded.slice(-2);
}

export function parseFormDate(value) {
  const text = String(value ?? '').trim();
  const br = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(text);
  const iso = br ? br[3] + '-' + br[2] + '-' + br[1] : text;
  if (!/^(20\d{2}|2100)-\d{2}-\d{2}$/.test(iso)) return null;
  const parsed = new Date(iso + 'T12:00:00Z');
  return Number.isFinite(+parsed) && parsed.toISOString().slice(0, 10) === iso ? iso : null;
}

export function localCalendarDate(iso) {
  const [year, month, day] = iso.split('-').map(Number);
  return new Date(year, month - 1, day, 12);
}

export function calendarDateValue(date) {
  return [date.getFullYear(), String(date.getMonth() + 1).padStart(2, '0'), String(date.getDate()).padStart(2, '0')].join('-');
}

