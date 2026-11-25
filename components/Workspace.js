import React, { useEffect, useRef, useState } from 'react';
import { Alert, BackHandler, Image, Pressable, StyleSheet, Text, View } from 'react-native';
import { DefaultTheme, NavigationContainer } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as ImagePicker from 'expo-image-picker';
import Tabs from '../url/navigation/Tabs';
import { Page } from '../url/screens/FinanceScreens';
import { useFinance } from '../syncService';
import { dateLabel, dependencies } from '../finance';
import { ownerOf } from '../supabase';
import FinanceForm, { formNames } from './FinanceForm';
import { Badge, Button, Icon, IconButton, Section, colors, ui } from './FinanceUI';

const theme = {
  ...DefaultTheme,
  colors: { ...DefaultTheme.colors, primary: colors.primary, background: colors.background, card: colors.card, text: colors.ink, border: colors.line },
};
const actionNames = {
  ...formNames, pagar: 'Pagamento', pagar_fixa: 'Pagamento recorrente', receber_entrada_fixa: 'Recebimento recorrente',
};

function status(f) {
  if (f.storeError) return [f.storeError, 'database-alert-outline', 'amber'];
  if (f.error?.status === 401) return ['Entre novamente para sincronizar', 'account-alert-outline', 'amber'];
  if (f.online === false) return [f.queue.length ? 'Offline · alterações salvas no aparelho' : 'Offline', 'cloud-off-outline', 'amber'];
  if (f.syncing) return ['Sincronizando…', 'cloud-sync-outline', 'green'];
  if (f.error) return [f.error.status === 0 ? 'Sincronização indisponível' : 'Sincronização precisa de atenção', 'cloud-alert-outline', 'amber'];
  if (f.queue.length) return ['Há alterações aguardando sincronização', 'cloud-upload-outline', 'amber'];
  if (!f.hasReferences) return ['Aguardando conexão para sincronizar', 'cloud-outline', 'amber'];
  return ['Sincronizado', 'cloud-check-outline', 'green'];
}

function SyncPanel({ f, open, close, logout }) {
  const queued = new Map(f.queue.map(op => [op.id, op]));
  function discard(op) {
    Alert.alert('Remover da fila?', 'A alteração local será desfeita.', [
      { text: 'Cancelar', style: 'cancel' },
      { text: 'Remover', style: 'destructive', onPress: () => {
        f.discard(op).catch(error => Alert.alert('Fila de sincronização', error.message));
      } },
    ]);
  }

  return <Page f={f}>
    <View style={ui.between}><Text style={[ui.title, ui.grow]}>Sincronização</Text>
      <IconButton name="close" label="Fechar sincronização" onPress={close} /></View>
    <View style={ui.card}>
      <Text style={ui.text}>{status(f)[0]}</Text>
      <Text style={ui.muted}>Quando você está offline, as mudanças ficam armazenadas no aparelho. Elas são sincronizadas quando você volta a ficar online.</Text>
      {f.error && !f.error.operationId && <Text selectable style={ui.error}>{f.error.message}</Text>}
      {f.error?.status === 401 ? <Button label="Entrar novamente" onPress={logout} /> :
        <Button label="Sincronizar agora" disabled={f.online === false} busy={f.syncing} onPress={f.sync} />}
    </View>
    <Section title={'Pendências (' + f.queue.length + ')'}>
      {!f.queue.length && <Text style={ui.muted}>Nenhuma alteração aguardando envio.</Text>}
      {f.queue.map(op => {
        const waiting = dependencies(op.payload).some(id => queued.has(id));
        const permissionError = f.error?.operationId === op.id ? f.error.message : null;
        const description = op.payload.descricao || op.payload.nome || (op.payload.mes ? op.payload.mes : '');
        return <View key={op.id} style={{ gap: 7 }}>
          <View style={ui.divider} />
          <Text style={ui.label}>{op.payload.id && ['entrada', 'saida'].includes(op.payload.acao) ? 'Edição de ' + actionNames[op.payload.acao].toLowerCase() : actionNames[op.payload.acao]}{description ? ' · ' + description : ''}</Text>
          <Text style={ui.muted}>{dateLabel(op.payload.ocorrido_em)}</Text>
          <Badge tone={op.error || permissionError ? 'red' : 'amber'}>
            {permissionError ? 'Permissão negada' : op.error ? 'Revisar' : waiting ? 'Aguardando outro registro' : 'Aguardando envio'}
          </Badge>
          {permissionError && <Text selectable style={ui.error}>{permissionError}</Text>}
          {op.error && <Text style={ui.error}>{op.error}</Text>}
          <View style={ui.wrap}>
            {op.error && formNames[op.payload.acao] && <Button label="Corrigir" secondary
              onPress={() => open({ acao: op.payload.acao, operation: op })} />}
            {(!op.wire || op.error) && <Button label="Remover" danger onPress={() => discard(op)} />}
          </View>
        </View>;
      })}
    </Section>
    {f.legacy.length > 0 && <Section title="Lançamentos da versão anterior">
      <Text style={ui.muted}>Confira cada lançamento e selecione a conta e a categoria correspondentes antes de enviar.</Text>
      {f.legacy.map(item => {
        const title = item.descricao && item.descricao !== 'Nenhuma descrição' ? item.descricao : item.fornecedor ?? item.destinatario;
        return <View key={item.legacyId} style={ui.between}>
          <View style={ui.grow}>
            <Text style={ui.label}>{title || formNames[item.acao]}</Text>
            <Text style={ui.muted}>{item.data} · R$ {item.valor} · {item.categoria}</Text>
            {item.conta && <Text style={ui.muted}>Conta anterior · {item.conta}</Text>}
          </View>
          <Button label="Revisar" secondary disabled={!f.hasReferences} onPress={() => open({
            acao: item.acao, legacyId: item.legacyId,
            seed: { descricao: title, valor: item.valor, data: item.data, vencimento: item.data },
          })} />
        </View>;
      })}
    </Section>}
  </Page>;
}

function Profile({ f, session, close, logout }) {
  const [photo, setPhoto] = useState(null);
  const key = 'financas.profile.photo:' + ownerOf(session);
  useEffect(() => {
    let mounted = true;
    async function getPhoto() {
      const previous = await AsyncStorage.multiGet([key, '@usuario_cadastrado', '@usuario_foto_perfil']);
      const oldProfile = JSON.parse(previous[1][1] ?? 'null');
      const uri = previous[0][1] || (oldProfile?.email?.trim().toLowerCase() === session.email?.toLowerCase() ? previous[2][1] : null);
      if (mounted) setPhoto(uri);
    }
    getPhoto().catch(() => {});
    return () => { mounted = false; };
  }, [key, session.email]);

  async function choosePhoto() {
    try {
      const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], allowsEditing: true, quality: 0.7 });
      if (!result.canceled) {
        const uri = result.assets[0].uri;
        await AsyncStorage.setItem(key, uri);
        setPhoto(uri);
      }
    } catch {
      Alert.alert('Perfil', 'Não foi possível selecionar a foto.');
    }
  }

  return <Page f={f}>
    <View style={ui.between}><Text style={ui.title}>Perfil</Text><IconButton name="close" label="Fechar perfil" onPress={close} /></View>
    <View style={ui.card}>
      {photo ? <Image source={{ uri: photo }} accessibilityLabel="Foto do perfil" style={styles.avatar} /> : <Icon name="account-circle-outline" size={60} />}
      <Text style={ui.subtitle}>{session.name}</Text>
      <Text style={ui.muted}>{session.email}</Text>
      <Button label="Alterar foto" secondary onPress={choosePhoto} />
      <Button label="Sair da conta" danger onPress={logout} />
    </View>
  </Page>;
}

export default function Workspace({ session, initialAccess, onLogout }) {
  const f = useFinance(session, initialAccess);
  const [panel, setPanel] = useState(null);
  const [form, setForm] = useState(null);
  const confirming = useRef(false);
  const insets = useSafeAreaInsets();
  const [text, icon, tone] = status(f);

  useEffect(() => {
    if (!panel) return;
    const listener = BackHandler.addEventListener('hardwareBackPress', () => {
      setPanel(null);
      return true;
    });
    return () => listener.remove();
  }, [panel]);

  function confirm(payload, title) {
    if (confirming.current) return;
    confirming.current = true;
    const payment = payload.acao !== 'receber_entrada_fixa';
    Alert.alert(payment ? 'Confirmar pagamento?' : 'Confirmar recebimento?', title, [
      { text: 'Cancelar', style: 'cancel', onPress: () => { confirming.current = false; } },
      { text: 'Confirmar', onPress: async () => {
        try {
          await f.save(payload);
        } catch (error) {
          Alert.alert('Falha ao salvar', error.message);
        } finally {
          confirming.current = false;
        }
      } },
    ]);
  }

  function logout() {
    Alert.alert('Sair da conta?', 'As pendências ficam no aparelho e voltam a sincronizar no próximo acesso desta conta.', [
      { text: 'Cancelar', style: 'cancel' },
      { text: 'Sair', style: 'destructive', onPress: async () => {
        try {
          await f.close();
          await onLogout();
        } catch (error) {
          Alert.alert('Falha ao sair', error.message);
        }
      } },
    ]);
  }

  return <View style={ui.page}>
    <View style={ui.grow} importantForAccessibility={form ? 'no-hide-descendants' : 'auto'}
      aria-hidden={Boolean(form)} pointerEvents={form ? 'none' : 'auto'}>
      <View style={styles.header}>
        <View style={ui.between}>
          <Text accessibilityRole="header" style={styles.brand}>MyFin</Text>
          <IconButton name="account-circle-outline" label="Abrir perfil" onPress={() => setPanel('profile')} />
        </View>
        <Pressable style={[styles.status, { backgroundColor: tone === 'green' ? colors.card : colors.amberLight }]}
          accessibilityRole="button" accessibilityLabel={'Abrir sincronização. ' + text + '. ' + f.queue.length + ' pendências.'}
          onPress={() => setPanel('sync')}>
          <Icon name={icon} size={19} color={tone === 'green' ? colors.primary : colors.amber} />
          <Text accessibilityLiveRegion="polite" style={[ui.muted, ui.grow]}>{text}</Text>
          {f.queue.length > 0 && <Text style={ui.label}>{f.queue.length}</Text>}
          <Icon name="chevron-right" size={19} />
        </Pressable>
      </View>
      <View style={ui.grow}>
        <View style={ui.grow} importantForAccessibility={panel ? 'no-hide-descendants' : 'auto'} aria-hidden={Boolean(panel)}>
          <NavigationContainer theme={theme}><Tabs finance={f} open={setForm} confirm={confirm} /></NavigationContainer>
        </View>
        {panel && <View style={[StyleSheet.absoluteFillObject, ui.page, { paddingBottom: insets.bottom }]}>
          {panel === 'sync' ? <SyncPanel f={f} open={setForm} close={() => setPanel(null)} logout={logout} /> :
            <Profile f={f} session={session} close={() => setPanel(null)} logout={logout} />}
        </View>}
      </View>
    </View>
    {form && <FinanceForm data={f.view} config={form} onClose={() => setForm(null)} onSave={f.save} />}
  </View>;
}

const styles = StyleSheet.create({
  brand: { fontSize: 23, fontWeight: '800', color: colors.ink },
  header: { paddingHorizontal: 16, paddingBottom: 7, backgroundColor: colors.greenLight, borderBottomColor: colors.line, borderBottomWidth: 1, gap: 6 },
  status: { minHeight: 40, paddingHorizontal: 9, paddingVertical: 5, gap: 7, flexDirection: 'row', alignItems: 'center', borderRadius: 10 },
  avatar: { width: 80, height: 80, borderRadius: 40, backgroundColor: colors.greenLight },
});

