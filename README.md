# GestãoPro

Aplicação web com frontend HTML, API Node.js/Express e banco Supabase.

## Configuração

1. No painel do Supabase, abra **SQL Editor**, execute o conteúdo de `supabase-schema.sql` e confirme que as tabelas e políticas RLS foram criadas. O script também recupera perfis de contas já cadastradas que ainda não estavam em `user_profiles`; pode ser executado novamente com segurança.
2. Copie `.env.example` para `.env` e preencha `SUPABASE_URL`, `SUPABASE_ANON_KEY` e `SUPABASE_SERVICE_ROLE_KEY` com os dados do mesmo projeto Supabase. Use a chave `publishable` (ou `anon` legado) em `SUPABASE_ANON_KEY`; obtenha a chave secreta `service_role` nas configurações de API do Supabase e use-a somente no `.env` do servidor. Nunca coloque essa chave no HTML, publique o `.env` ou a envie a alguém.
3. Instale o Node.js 18.18 ou superior. Na pasta do projeto, execute:

   ```bash
   npm install
   npm start
   ```

4. Abra `http://localhost:3000` no navegador. Não abra o HTML diretamente pelo explorador de arquivos: a API precisa estar rodando.

O frontend faz login e cadastro pelo Supabase Auth. As operações de clientes, vendas e tarefas passam pela API, que valida o token da sessão antes de acessar o banco. A URL e a chave pública do Supabase no início de `gestãopro.html` precisam corresponder ao mesmo projeto informado no `.env`.

## E-mail de confirmação

O cadastro pode exigir confirmação do e-mail conforme a configuração de **Authentication** do projeto Supabase. Se estiver habilitada, confirme o endereço antes de entrar. Para testar sem envio de e-mails, ajuste essa opção no painel do Supabase.
