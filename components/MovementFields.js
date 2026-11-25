import React, { useState } from 'react';
import { Keyboard, Platform, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import DateTimePicker, { DateTimePickerAndroid } from '@react-native-community/datetimepicker';
import { dateLabel } from '../finance';
import { calendarDateValue, displayMoney, localCalendarDate, maskMoney, parseFormDate } from '../formValues';
import { Button, Icon, colors, ui } from './FinanceUI';

const minimumDate = localCalendarDate('2000-01-01');
const maximumDate = localCalendarDate('2100-12-31');

export function MoneyField({ label, value, onChange }) {
  return <View>
    <Text style={ui.label}>{label}</Text>
    <View style={[ui.input, ui.row]}>
      <Text style={styles.currency}>R$</Text>
      <TextInput
        accessibilityLabel={label + ' em reais'} keyboardType="number-pad"
        placeholder="0,00" placeholderTextColor={colors.muted}
        value={displayMoney(value)} onChangeText={text => onChange(maskMoney(text, value))}
        style={[ui.text, ui.grow, styles.moneyInput]}
      />
    </View>
  </View>;
}

export function DateField({ label, value, today, onChange, open, onOpen, onClose }) {
  const [draft, setDraft] = useState(null);
  const selected = parseFormDate(value);
  const displayed = selected ? dateLabel(selected) : 'Selecionar data';

  function openPicker() {
    Keyboard.dismiss();
    const initial = localCalendarDate(selected ?? today);
    if (Platform.OS === 'android') {
      DateTimePickerAndroid.open({
        mode: 'date', display: 'calendar', value: initial, minimumDate, maximumDate,
        positiveButton: { label: 'Confirmar' }, negativeButton: { label: 'Cancelar' },
        onChange: (event, date) => {
          if (event.type === 'set' && date) onChange(calendarDateValue(date));
        },
      });
    } else if (open) {
      onClose();
    } else {
      setDraft(initial);
      onOpen();
    }
  }

  return <View>
    <Text style={ui.label}>{label}</Text>
    <Pressable accessibilityRole="button" accessibilityLabel={label + ', ' + displayed}
      accessibilityState={{ expanded: open }} onPress={openPicker} style={[ui.input, ui.row]}>
      <Icon name="calendar-month-outline" />
      <Text style={[ui.grow, selected ? styles.dateValue : ui.muted]}>{displayed}</Text>
      <Icon name={open ? 'chevron-up' : 'chevron-down'} size={20} />
    </Pressable>
    {open && draft && <View style={[ui.card, styles.calendar]}>
      <DateTimePicker mode="date" value={draft} minimumDate={minimumDate} maximumDate={maximumDate}
        display="inline" accentColor={colors.primary}
        onChange={(event, date) => { if (event.type === 'set' && date) setDraft(date); }}
        style={styles.picker}
      />
      <View style={[ui.wrap, styles.calendarActions]}>
        <Button label="Cancelar" secondary onPress={onClose} />
        <Button label="Confirmar" onPress={() => { onChange(calendarDateValue(draft)); onClose(); }} />
      </View>
    </View>}
  </View>;
}

const styles = StyleSheet.create({
  currency: { color: colors.primary, fontSize: 15, fontWeight: '700' },
  moneyInput: { minHeight: 46, paddingHorizontal: 0, paddingVertical: 7, fontVariant: ['tabular-nums'] },
  dateValue: { color: colors.ink, fontSize: 15, fontVariant: ['tabular-nums'] },
  calendar: { marginTop: 6, padding: 8 },
  picker: { alignSelf: 'stretch' },
  calendarActions: { justifyContent: 'flex-end', paddingHorizontal: 4 },
});

