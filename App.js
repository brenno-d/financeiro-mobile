import React, { useEffect, useState } from 'react';
import { ActivityIndicator, Platform, Text } from 'react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import AuthScreen from './components/AuthScreen';
import Workspace from './components/Workspace';
import { colors, ui } from './components/FinanceUI';
import { removeLegacyPassword } from './storage';
import { forgetSession, restoreSession } from './supabase';

function MobileApp() {
  const [activeLogin, setActiveLogin] = useState(undefined);
  const [warning, setWarning] = useState(null);

  useEffect(() => {
    let mounted = true;
    removeLegacyPassword().catch(() => {});
    restoreSession().then(session => {
      if (mounted) setActiveLogin(session ? { session } : null);
    }).catch(() => {
      if (mounted) {
        setWarning('A sessão local está indisponível. Entre novamente.');
        setActiveLogin(null);
      }
    });
    return () => { mounted = false; };
  }, []);

  async function logout() {
    await forgetSession();
    setActiveLogin(null);
  }

  let screen;
  if (activeLogin === undefined) {
    screen = <ActivityIndicator style={ui.grow} color={colors.primary} />;
  } else if (activeLogin) {
    const { session, access } = activeLogin;
    screen = <Workspace key={session.id} session={session} initialAccess={access} onLogout={logout} />;
  } else {
    screen = <AuthScreen warning={warning} onLogin={setActiveLogin} />;
  }

  const safeEdges = activeLogin ? ['top', 'left', 'right'] : ['top', 'bottom', 'left', 'right'];
  return <SafeAreaView style={ui.page} edges={safeEdges}>{screen}</SafeAreaView>;
}

export default function App() {
  return <SafeAreaProvider>
    <StatusBar style="dark" />
    {Platform.OS === 'web' ? <SafeAreaView style={[ui.page, ui.content]}>
      <Text style={ui.title}>MyFin</Text>
      <Text style={ui.text}>Abra o aplicativo no Android ou iOS para usar o SQLite e a sincronização.</Text>
    </SafeAreaView> : <MobileApp />}
  </SafeAreaProvider>;
}

