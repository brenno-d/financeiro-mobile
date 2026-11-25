import React from 'react';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { StyleSheet, Text, View } from 'react-native';
import { Icon, MonthControl, colors, ui } from '../../components/FinanceUI';
import { Accounts, NewScreen, Overview, StatementScreen, Stats } from '../screens/FinanceScreens';

const Tab = createBottomTabNavigator();
const screens = [
  ['Visão geral', 'Início', 'view-dashboard-outline', Overview],
  ['Extrato', 'Extrato', 'format-list-bulleted', StatementScreen],
  ['Novo', 'Novo', 'plus-circle-outline', NewScreen],
  ['Contas', 'Contas', 'bank-outline', Accounts],
  ['Estatísticas', 'Análises', 'chart-bar', Stats],
];

export default function Tabs({ finance, open, confirm }) {
  return <Tab.Navigator screenOptions={({ route }) => ({
    headerShown: route.name === 'Visão geral' || route.name === 'Extrato',
    header: () => <View style={styles.period}>
      <MonthControl month={finance.month} onChange={finance.chooseMonth} />
      {!finance.hasSnapshot && !finance.syncing && <Text style={ui.muted}>Este mês ainda não foi baixado neste aparelho.</Text>}
    </View>,
    tabBarActiveTintColor: colors.primary,
    tabBarInactiveTintColor: colors.muted,
    tabBarStyle: { backgroundColor: colors.greenLight, borderColor: colors.line },
    tabBarLabelStyle: { fontSize: 11, fontWeight: '600' },
  })}>
    {screens.map(([name, label, icon, Screen]) => (
      <Tab.Screen key={name} name={name} options={{
        tabBarLabel: label,
        tabBarIcon: ({ color, size }) => <Icon name={icon} color={color} size={size} />,
      }}>
        {props => <Screen {...props} f={finance} open={open} confirm={confirm} />}
      </Tab.Screen>
    ))}
  </Tab.Navigator>;
}

const styles = StyleSheet.create({
  period: { paddingHorizontal: 16, paddingVertical: 6, gap: 6, backgroundColor: colors.greenSoft, borderBottomWidth: 1, borderColor: colors.line },
});

