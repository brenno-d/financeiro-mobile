import React, { useState } from 'react';
import {
  ActivityIndicator, Image, Pressable, ScrollView, StyleSheet, Text, TextInput, View,
} from 'react-native';
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import bankLogos from '../assets/bancosLogos';
import { monthName, monthShift, normalize, reais } from '../finance';

export const colors = {
  background: '#F4FAEF', card: '#FFFFFF', ink: '#203318', muted: '#4B5E41', line: '#D5E6CC',
  primary: '#315B22', greenLight: '#E3F8D3', greenSoft: '#EFF9E7',
  red: '#923B59', redLight: '#FBE8EF', amber: '#70531F', amberLight: '#FFF4CF',
};

export const ui = StyleSheet.create({
  page: { flex: 1, backgroundColor: colors.background },
  content: { padding: 16, paddingBottom: 28, gap: 14 },
  title: { color: colors.ink, fontSize: 26, fontWeight: '800' },
  subtitle: { color: colors.ink, fontSize: 18, fontWeight: '700' },
  text: { color: colors.ink, fontSize: 15 },
  muted: { color: colors.muted, fontSize: 13, lineHeight: 19 },
  label: { color: colors.ink, fontWeight: '600', marginBottom: 6 },
  input: { minHeight: 46, borderColor: colors.line, borderWidth: 1, borderRadius: 10, paddingHorizontal: 12, color: colors.ink, backgroundColor: colors.card, fontSize: 15 },
  card: { padding: 15, backgroundColor: colors.card, borderRadius: 16, borderColor: colors.line, borderWidth: 1, gap: 11 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  between: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10 },
  grow: { flex: 1 },
  wrap: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 8 },
  error: { color: colors.red, fontSize: 14 },
  money: { fontSize: 22, fontWeight: '800', color: colors.ink },
  income: { color: colors.primary },
  expense: { color: colors.red },
  divider: { height: 1, backgroundColor: colors.line },
});

export function Icon({ name, size = 22, color = colors.primary }) {
  return <MaterialCommunityIcons name={name} size={size} color={color} />;
}

export function BankLogo({ code, label = '', size = 28 }) {
  const logo = /^\d{8}$/.test(code) ? bankLogos[code] : null;
  const initials = code === 'sem-banco' ? '' : label.trim().slice(0, 2).toUpperCase();
  return <View accessible={false} importantForAccessibility="no-hide-descendants"
    style={[styles.bankMark, { width: size, height: size, borderRadius: size > 28 ? 8 : 5 }, logo && styles.bankImage]}>
    {logo ? <Image source={logo} style={styles.bankAsset} resizeMode="contain" fadeDuration={0} />
      : initials ? <Text style={[styles.bankInitials, { fontSize: size > 28 ? 15 : 12 }]}>{initials}</Text>
        : <Icon name="bank-outline" size={size > 28 ? 22 : 17} />}
  </View>;
}

export function IconButton({ name, label, onPress, disabled }) {
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={label} accessibilityState={{ disabled }}
      disabled={disabled} onPress={onPress} style={({ pressed }) => [styles.iconButton, (disabled || pressed) && styles.dim]}>
      <Icon name={name} />
    </Pressable>
  );
}

export function Button({ label, onPress, secondary, danger, disabled, busy }) {
  return (
    <Pressable accessibilityRole="button" accessibilityState={{ disabled: disabled || busy, busy: Boolean(busy) }}
      disabled={disabled || busy} onPress={onPress}
      style={({ pressed }) => [styles.button, secondary && styles.secondary, danger && styles.danger, (disabled || busy || pressed) && styles.dim]}>
      {busy && <ActivityIndicator color={colors.primary} />}
      <Text style={[styles.buttonText, secondary && { color: colors.primary }, danger && { color: colors.red }]}>{label}</Text>
    </Pressable>
  );
}

export function Field({ label, value, onChangeText, ...props }) {
  return <View><Text style={ui.label}>{label}</Text>
    <TextInput accessibilityLabel={label} placeholderTextColor={colors.muted}
      style={ui.input} value={value ?? ''} onChangeText={onChangeText} {...props} />
  </View>;
}

export function Select({ label, options, value, onChange, renderIcon, empty = 'Selecione' }) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const filtered = options.filter(option => normalize(option.label).includes(normalize(search.trim())));
  const selected = options.find(option => option.value === value);
  const toggle = () => {
    setSearch('');
    setOpen(!open);
  };
  return (
    <View>
      <Text style={ui.label}>{label}</Text>
      <Pressable accessibilityRole="button" accessibilityLabel={label + ', ' + (selected?.label ?? empty)}
        accessibilityState={{ expanded: open }} onPress={toggle} style={[ui.input, ui.between, styles.selectTrigger]}>
        {selected && renderIcon?.(selected)}
        <Text style={[ui.text, ui.grow]}>{selected?.label ?? empty}</Text>
        <Icon name={open ? 'chevron-up' : 'chevron-down'} />
      </Pressable>
      {open && <View style={styles.selectList}>
        {options.length > 8 && <TextInput accessibilityLabel={'Buscar ' + label.toLowerCase()} style={ui.input}
          placeholder="Buscar" placeholderTextColor={colors.muted} value={search} onChangeText={setSearch} />}
        <ScrollView nestedScrollEnabled keyboardShouldPersistTaps="handled" style={{ maxHeight: 192 }}>
          {!filtered.length && <Text style={styles.option}>Nenhuma opção disponível.</Text>}
          {filtered.slice(0, 40).map(option => (
            <Pressable key={option.value} accessibilityRole="button" accessibilityState={{ selected: value === option.value }}
              onPress={() => { onChange(option.value); setOpen(false); }}
              style={[styles.option, renderIcon && ui.row, value === option.value && styles.secondary]}>
              {renderIcon?.(option)}
              <Text style={[ui.text, renderIcon && ui.grow]}>{option.label}</Text>
            </Pressable>
          ))}
          {filtered.length > 40 && <Text style={[ui.muted, styles.option]}>Use a busca para ver mais opções.</Text>}
        </ScrollView>
      </View>}
    </View>
  );
}

export function Chips({ options, value, onChange }) {
  return <View style={ui.wrap}>
    {options.map(option => (
      <Pressable key={option.value} accessibilityRole="button" accessibilityState={{ selected: option.value === value }}
        onPress={() => onChange(option.value)} style={[styles.chip, option.value === value && styles.secondary]}>
        <Text style={styles.chipText}>{option.label}</Text>
      </Pressable>
    ))}
  </View>;
}

export function Badge({ children, tone = 'amber' }) {
  return <View style={[styles.badge, tone === 'red' ? styles.badgeRed : tone === 'green' ? styles.secondary : styles.badgeAmber]}>
    <Text style={[styles.chipText, tone === 'red' ? ui.expense : tone === 'amber' && { color: colors.amber }]}>{children}</Text>
  </View>;
}

export function MonthControl({ month, onChange }) {
  return <View style={ui.between}>
    <IconButton name="chevron-left" label="Mês anterior" disabled={month <= '2000-01'} onPress={() => onChange(monthShift(month, -1))} />
    <Text accessibilityLiveRegion="polite" style={[ui.text, { fontWeight: '700', textTransform: 'capitalize' }]}>{monthName(month)}</Text>
    <IconButton name="chevron-right" label="Próximo mês" disabled={month >= '2100-12'} onPress={() => onChange(monthShift(month, 1))} />
  </View>;
}

export function Section({ title, action, children }) {
  return <View style={ui.card}>
    <View style={ui.between}><Text accessibilityRole="header" style={[ui.subtitle, ui.grow]}>{title}</Text>{action}</View>
    {children}
  </View>;
}

export function Bar({ ratio, tone }) {
  return <View style={styles.track}><View style={[styles.fill, {
    width: Math.min(100, Math.max(0, ratio * 100)) + '%',
    backgroundColor: tone === 'red' ? colors.red : colors.primary,
  }]} /></View>;
}

export function AmountBar({ label, value, max, tone }) {
  return <View style={{ gap: 4 }}>
    <View style={ui.between}><Text style={ui.muted}>{label}</Text><Text style={ui.text}>{reais(value)}</Text></View>
    <Bar ratio={max ? value / max : 0} tone={tone} />
  </View>;
}

export function optionsFrom(rows, id, label) {
  return rows.map(row => ({ value: row[id], label: typeof label === 'function' ? label(row) : row[label] }));
}

const styles = StyleSheet.create({
  bankMark: { alignItems: 'center', justifyContent: 'center', flexShrink: 0, overflow: 'hidden', backgroundColor: '#e9eee4' },
  bankImage: { backgroundColor: colors.card },
  bankAsset: { width: '100%', height: '100%' },
  bankInitials: { color: '#526347', fontWeight: '600' },
  selectTrigger: { paddingVertical: 6 },
  button: { minHeight: 42, paddingHorizontal: 12, paddingVertical: 8, borderRadius: 10, backgroundColor: colors.greenLight, alignItems: 'center', justifyContent: 'center', flexDirection: 'row', gap: 8 },
  iconButton: { width: 44, height: 44, borderRadius: 12, backgroundColor: colors.greenLight, alignItems: 'center', justifyContent: 'center' },
  buttonText: { fontSize: 14, fontWeight: '700', color: colors.ink, textAlign: 'center' },
  secondary: { backgroundColor: colors.greenSoft },
  danger: { backgroundColor: colors.redLight },
  dim: { opacity: 0.55 },
  selectList: { padding: 5, borderWidth: 1, borderColor: colors.line, borderRadius: 10, marginTop: 4, backgroundColor: colors.card },
  option: { padding: 10, borderRadius: 8 },
  chip: { paddingHorizontal: 11, paddingVertical: 8, borderRadius: 18, borderWidth: 1, borderColor: colors.line, backgroundColor: colors.card },
  chipText: { fontSize: 13, fontWeight: '600', color: colors.primary },
  badge: { alignSelf: 'flex-start', borderRadius: 7, paddingHorizontal: 8, paddingVertical: 3 },
  badgeAmber: { backgroundColor: colors.amberLight },
  badgeRed: { backgroundColor: colors.redLight },
  track: { height: 7, backgroundColor: colors.background, borderRadius: 6, overflow: 'hidden' },
  fill: { height: 7, borderRadius: 6 },
});

