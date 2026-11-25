import React, { useRef, useState } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, Text, View } from 'react-native';
import { authMessage, configured, login, register, resendConfirmation } from '../supabase';
import { Button, Field, ui } from './FinanceUI';

export default function AuthScreen({ onLogin, warning }) {
  const [mode, setMode] = useState('login');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [message, setMessage] = useState(null);
  const [busy, setBusy] = useState(false);
  const lock = useRef(false);
  const signup = mode === 'signup';

  async function submit(resend = false) {
    if (lock.current) return;
    const address = email.trim().toLowerCase();
    lock.current = true;
    setBusy(true);
    setMessage(null);
    try {
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(address)) throw new Error('Informe um e-mail válido.');
      if (resend) {
        await resendConfirmation(address);
        setMessage({ text: 'Se o cadastro estiver pendente, o link de confirmação será enviado ao e-mail.' });
      } else if (signup) {
        if (!name.trim()) throw new Error('Informe seu nome.');
        if (password.length < 8) throw new Error('A senha precisa ter pelo menos 8 caracteres.');
        if (password !== confirmation) throw new Error('As senhas precisam ser iguais.');
        setMessage({ text: await register(name.trim(), address, password) });
        setMode('login');
        setPassword('');
        setConfirmation('');
      } else {
        if (!password) throw new Error('Informe sua senha.');
        onLogin(await login(address, password));
      }
    } catch (error) {
      setMessage({ text: authMessage(error), error: true });
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }

  return (
    <KeyboardAvoidingView style={ui.page} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={[ui.content, { flexGrow: 1, justifyContent: 'center' }]}>
        <Text accessibilityRole="header" style={ui.title}>MyFin</Text>
        <View style={ui.card}>
          <Text accessibilityRole="header" style={ui.subtitle}>{signup ? 'Criar conta' : 'Entrar'}</Text>
          {signup && <Field label="Nome" value={name} onChangeText={setName} autoComplete="name" maxLength={70} />}
          <Field label="E-mail" value={email} onChangeText={setEmail} autoComplete="email" autoCapitalize="none" keyboardType="email-address" />
          <Field label="Senha" value={password} onChangeText={setPassword} autoComplete={signup ? 'new-password' : 'current-password'} secureTextEntry />
          {signup && <Field label="Confirmar senha" value={confirmation} onChangeText={setConfirmation} secureTextEntry />}
          <Text accessibilityLiveRegion="polite" style={message?.error || !configured ? ui.error : ui.muted}>
            {message?.text ?? (!configured ? 'Configure a conexão do MyFin no arquivo .env.' :
              warning || 'Entre com sua conta. O primeiro acesso precisa de internet.')}
          </Text>
          <Button label={signup ? 'Criar conta' : 'Entrar'} busy={busy} disabled={!configured} onPress={() => submit()} />
          <Button label={signup ? 'Já tenho conta' : 'Criar conta'} secondary disabled={busy}
            onPress={() => { setMode(signup ? 'login' : 'signup'); setMessage(null); }} />
          {!signup && <Button label="Reenviar confirmação" secondary disabled={busy || !configured} onPress={() => submit(true)} />}
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

