# MyFin

Aplicativo Expo para Android e iOS. O login, as consultas e as gravações vão diretamente ao Supabase. O app pode usar o mesmo projeto de banco da versão web com o Apache e o PHP desligados.

## Configuração

1. Copie `.env.example` para `.env.local` e informe a URL do projeto e a chave **publishable** ou a chave legada **anon**. A conta do usuário é autenticada pelo Supabase Auth.
2. O projeto Supabase precisa do esquema financeiro base, incluindo `tb_usuarios`, a função `vincular_usuario_auth` e as políticas RLS por proprietário. Se as migrações complementares ainda não tiverem sido aplicadas, execute os scripts de `supabase/` em ordem no SQL Editor. O script `004_sincronizacao_mobile.sql` instala a função de gravação idempotente utilizada pela fila. O script `005_creditar_receitas_no_saldo.sql` habilita o crédito de receitas. O script `006_atualizar_saldo_de_despesas_e_transferencias.sql` habilita o débito de despesas pagas e a movimentação entre contas. Após essas migrações, aplique `007_editar_receitas_e_despesas.sql` para sincronizar edições.
3. Instale as dependências e inicie o Expo.

```powershell
npm ci
npx expo start
```

Abra o app em um emulador ou dispositivo Android ou iOS compatível com Expo SDK 54. O primeiro login e a primeira consulta precisam de conexão para baixar contas e listas de referência. Cadastre `financas://auth/confirmado` em **Authentication → URL Configuration → Redirect URLs** para que o link de confirmação volte ao app instalado. No Expo Go, volte manualmente ao app após confirmar o e-mail.

## Fluxo offline

- O app mantém no SQLite os meses já consultados e as alterações de cada usuário. A sessão é restaurada pelo armazenamento seguro do aparelho.
- Ao salvar uma alteração, ela entra no SQLite antes do envio e aparece com a indicação **Aguardando sincronização**. Toque no indicador no topo para consultar pendências, corrigir registros rejeitados ou sincronizar manualmente.
- Quando você está offline, as mudanças ficam armazenadas no aparelho. Elas são sincronizadas quando você volta a ficar online. A fila repete a mesma operação se a confirmação se perder.
- Lançamentos da versão anterior ficam disponíveis em **Sincronização → Lançamentos da versão anterior** para a conta com o e-mail correspondente. Revise a associação da conta, da categoria e da forma de pagamento antes de enviar.
- Receitas com data de hoje ou anterior creditam a conta ao sincronizar. Parcelas com data posterior entram a partir da data delas, na próxima consulta online de saldo pelo app. O extrato de receitas fixas projeta os meses seguintes e o crédito depende do registro da ocorrência de cada mês.
- Uma despesa reduz o saldo quando o pagamento é registrado, inclusive ao marcar uma despesa em aberto como paga. Uma transferência debita a origem e credita o destino na mesma transação. Transferências com data futura entram no saldo a partir dessa data, na próxima consulta online.
- Em Contas, o app exibe o saldo confirmado e a estimativa com as movimentações pendentes de envio ou de atualização do saldo. As transferências no app movimentam o saldo de controle financeiro.

## Receita anterior à migração 005

A migração começa a contabilizar as receitas registradas depois da instalação. Para regularizar uma receita anterior, confirme no extrato que o valor ainda falta no saldo e anote o `cd_entrada` em `tb_entradas`. No SQL Editor, substitua `123` pelo ID confirmado e execute:

```sql
select public.fn_creditar_entrada_no_saldo(123);
```

A função devolve `true` quando credita a receita. Uma nova execução para o mesmo ID devolve `false` após o crédito. Em projetos com um gatilho próprio de crédito de receitas, use uma única regra de crédito.

## Despesas e transferências anteriores à migração 006

A partir da instalação, as transferências novas e as despesas marcadas como pagas passam a movimentar o saldo. Para regularizar lançamentos já gravados, confira se os valores ainda faltam no saldo e use o `cd_saida` ou o `cd_transferencia` confirmado no SQL Editor. Execute somente a linha correspondente ao registro e substitua os IDs de exemplo.

```sql
select financas_interno.aplicar_movimentacao_no_saldo('saida', 123);
select financas_interno.aplicar_movimentacao_no_saldo('transferencia', 456);
```

O retorno `true` confirma a atualização. O retorno `false` indica que o registro já foi aplicado ou ainda não pode movimentar o saldo. Em projetos com um gatilho próprio de saldo para despesas ou transferências, use uma única regra por tipo.

## Editar lançamentos

No Extrato, toque no lápis da receita ou despesa. Em um lançamento fixo ou parcelado, a alteração se aplica à ocorrência selecionada. Em uma ocorrência fixa, use o mês e a conta da própria recorrência.

Ao sincronizar, a edição recalcula o efeito no saldo para lançamentos já registrados pelas migrações de saldo. Alterações em valores históricos que ainda estavam fora dessas migrações preservam o saldo conciliado existente. Marcar uma despesa em aberto como paga registra um débito.

## Conferir no dispositivo

Os testes automatizados usam SQLite em disco e respostas Supabase simuladas. Use Node.js 22 ou posterior para rodar `npm test`.

1. Entre na conta e aguarde a primeira sincronização.
2. Ative o modo avião e salve uma receita ou despesa em uma conta disponível. Abra o extrato do mês do lançamento e confira o registro e a fila.
3. Feche e reabra o app ainda offline. Confira se o lançamento e o indicador continuam no aparelho.
4. Restabeleça a internet com o app aberto. A fila deve esvaziar quando as alterações forem sincronizadas.

A lista de bancos é uma cópia local dos participantes do STR com número-código, a partir do [Banco Central](https://dadosabertos.bcb.gov.br/dataset/lista-de-participantes-do-str). Os ícones bancários usam os mesmos arquivos e códigos ISPB da versão web. [Origem dos ícones e aviso sobre marcas](assets/bancos/DISCLAIMER.md)

