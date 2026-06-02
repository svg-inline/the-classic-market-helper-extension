# Deploy Vercel + Supabase

## 1. Supabase

1. Crie um projeto Supabase.
2. Vá em **SQL Editor**.
3. Execute `supabase/migrations/0001_market_cache_schema.sql`.
4. Copie a Project URL.
5. Copie a service role key.

## 2. Vercel

1. Suba este projeto para o GitHub.
2. Crie um projeto na Vercel apontando para o repositório.
3. Configure as variáveis:

```txt
SUPABASE_URL=https://xxxxxxxxxxxxxxxxxxxx.supabase.co
SUPABASE_SERVICE_ROLE_KEY=...
TCMH_EXTENSION_API_KEY=gere-uma-chave-grande
TCMH_CACHE_TTL_HOURS=12
TCMH_ALLOWED_ORIGINS=chrome-extension://SEU_EXTENSION_ID,https://SEU_APP.vercel.app
TCMH_ALLOW_ANY_EXTENSION_ORIGIN=false
```

## 3. Teste

```bash
curl https://SEU_APP.vercel.app/api/health
curl https://SEU_APP.vercel.app/api/market/stats
```

## 4. CORS

Para desenvolvimento, pode usar:

```txt
TCMH_ALLOW_ANY_EXTENSION_ORIGIN=true
```

Para produção, prefira:

```txt
TCMH_ALLOWED_ORIGINS=chrome-extension://ID_REAL_DA_EXTENSAO
TCMH_ALLOW_ANY_EXTENSION_ORIGIN=false
```

## 5. Importante

A service role key é segredo de backend. Não coloque essa chave na extensão, no `NEXT_PUBLIC_*`, no GitHub ou no navegador.
