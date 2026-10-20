require('dotenv').config();

const path = require('node:path');
const express = require('express');
const { createClient } = require('@supabase/supabase-js');

const { SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY, PORT = 3000 } = process.env;
if (!SUPABASE_URL || !SUPABASE_ANON_KEY || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error('Configure SUPABASE_URL, SUPABASE_ANON_KEY e SUPABASE_SERVICE_ROLE_KEY no arquivo .env.');
  process.exit(1);
}

const app = express();
app.disable('x-powered-by');
app.use(express.json({ limit: '32kb' }));
const adminClient = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false }
});
const USERNAME = /^[a-z0-9_]{3,30}$/;
const loginAttempts = new Map();
const LOGIN_WINDOW_MS = 15 * 60 * 1000;
const LOGIN_MAX_ATTEMPTS = 10;
function limitLoginAttempts(req, res, next) {
  const now = Date.now();
  const key = req.ip;
  const attempt = loginAttempts.get(key);
  if (!attempt || now - attempt.startedAt >= LOGIN_WINDOW_MS) {
    loginAttempts.set(key, { startedAt: now, count: 1 });
  } else if (attempt.count >= LOGIN_MAX_ATTEMPTS) {
    return res.status(429).json({ error: 'Muitas tentativas. Aguarde 15 minutos e tente novamente.' });
  } else {
    attempt.count++;
  }
  if (loginAttempts.size > 5000) {
    for (const [ip, value] of loginAttempts) {
      if (now - value.startedAt >= LOGIN_WINDOW_MS) loginAttempts.delete(ip);
    }
  }
  next();
}
const TABLES = {
  clientes: ['nome', 'email', 'telefone', 'empresa', 'status'],
  vendas: ['clienteId', 'produto', 'valor', 'data', 'status'],
  tarefas: ['titulo', 'status', 'prioridade', 'prazo']
};
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

async function authenticate(req, res, next) {
  const match = /^Bearer\s+(.+)$/i.exec(req.get('authorization') || '');
  if (!match) return res.status(401).json({ error: 'Sessão necessária.' });
  const token = match[1];
  const client = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: `Bearer ${token}` } }
  });
  const { data, error } = await client.auth.getUser(token);
  if (error || !data.user) return res.status(401).json({ error: 'Sessão inválida ou expirada.' });
  req.db = client;
  req.user = data.user;
  next();
}

app.get('/api/health', (_req, res) => res.json({ ok: true }));
app.post('/api/auth/login', limitLoginAttempts, async (req, res) => {
  const username = typeof req.body?.username === 'string' ? req.body.username.trim().toLowerCase() : '';
  const password = typeof req.body?.password === 'string' ? req.body.password : '';
  if (!USERNAME.test(username) || !password) {
    return res.status(400).json({ error: 'Informe um nome de usuário e uma senha válidos.' });
  }

  const { data: profile, error: profileError } = await adminClient
    .from('user_profiles').select('user_id').ilike('username', username).maybeSingle();
  if (profileError) {
    console.error(profileError);
    return res.status(500).json({ error: 'Não foi possível autenticar agora.' });
  }
  if (!profile) return res.status(401).json({ error: 'Nome de usuário ou senha incorretos.' });

  const { data: userData, error: userError } = await adminClient.auth.admin.getUserById(profile.user_id);
  if (userError) {
    console.error(userError);
    return res.status(500).json({ error: 'Não foi possível autenticar agora.' });
  }
  if (!userData.user?.email) return res.status(401).json({ error: 'Nome de usuário ou senha incorretos.' });

  const authClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: { persistSession: false, autoRefreshToken: false }
  });
  const { data, error } = await authClient.auth.signInWithPassword({ email: userData.user.email, password });
  if (error) {
    if (error.message.toLowerCase().includes('email not confirmed')) {
      return res.status(403).json({ error: 'Este e-mail ainda não foi confirmado. Confira sua caixa de entrada.' });
    }
    return res.status(401).json({ error: 'Nome de usuário ou senha incorretos.' });
  }
  res.json({ user: data.user, session: data.session });
});
app.use('/api', (req, res, next) => {
  authenticate(req, res, next).catch(next);
});

app.get('/api/:table', async (req, res) => {
  if (!TABLES[req.params.table]) return res.status(404).json({ error: 'Recurso não encontrado.' });
  const { data, error } = await req.db.from(req.params.table).select('*').order('created_at', { ascending: false });
  if (error) return res.status(400).json({ error: error.message });
  res.json(data || []);
});

app.post('/api/:table', async (req, res) => {
  const fields = TABLES[req.params.table];
  if (!fields) return res.status(404).json({ error: 'Recurso não encontrado.' });
  if (!req.body || typeof req.body !== 'object' || Array.isArray(req.body)) return res.status(400).json({ error: 'Dados inválidos.' });
  const record = Object.fromEntries(fields.filter(key => key in req.body).map(key => [key, req.body[key]]));
  const { data, error } = await req.db.from(req.params.table).insert({ ...record, user_id: req.user.id }).select().single();
  if (error) return res.status(400).json({ error: error.message });
  res.status(201).json(data);
});

app.patch('/api/:table/:id', async (req, res) => {
  const fields = TABLES[req.params.table];
  if (!fields) return res.status(404).json({ error: 'Recurso não encontrado.' });
  if (!UUID.test(req.params.id)) return res.status(400).json({ error: 'Identificador inválido.' });
  if (!req.body || typeof req.body !== 'object' || Array.isArray(req.body)) return res.status(400).json({ error: 'Dados inválidos.' });
  const record = Object.fromEntries(fields.filter(key => key in req.body).map(key => [key, req.body[key]]));
  if (!Object.keys(record).length) return res.status(400).json({ error: 'Nenhum campo válido enviado.' });
  const { data, error } = await req.db.from(req.params.table).update(record).eq('id', req.params.id).select().maybeSingle();
  if (error) return res.status(400).json({ error: error.message });
  if (!data) return res.status(404).json({ error: 'Registro não encontrado.' });
  res.json(data);
});

app.delete('/api/:table/:id', async (req, res) => {
  if (!TABLES[req.params.table]) return res.status(404).json({ error: 'Recurso não encontrado.' });
  if (!UUID.test(req.params.id)) return res.status(400).json({ error: 'Identificador inválido.' });
  const { data, error } = await req.db.from(req.params.table).delete().eq('id', req.params.id).select('id').maybeSingle();
  if (error) return res.status(400).json({ error: error.message });
  if (!data) return res.status(404).json({ error: 'Registro não encontrado.' });
  res.status(204).end();
});

app.delete('/api/:table', async (req, res) => {
  if (!TABLES[req.params.table]) return res.status(404).json({ error: 'Recurso não encontrado.' });
  const { error } = await req.db.from(req.params.table).delete().eq('user_id', req.user.id);
  if (error) return res.status(400).json({ error: error.message });
  res.status(204).end();
});

app.use('/api', (_req, res) => res.status(404).json({ error: 'Rota não encontrada.' }));
app.get('/', (_req, res) => res.sendFile(path.join(__dirname, 'gestãopro.html')));
app.use((error, _req, res, _next) => {
  console.error(error);
  res.status(500).json({ error: 'Erro interno do servidor.' });
});

app.listen(Number(PORT), () => console.log(`GestãoPro disponível em http://localhost:${PORT}`));
