-- =============================================
-- マネーフォワード クラウド連携
-- =============================================
-- accel-dash のサーバー側（Route Handler）だけが読み書きする。
-- RLS を有効にしてポリシーを一つも作らないことで、anon / authenticated からは
-- 一切見えず、service_role だけが触れる状態にしている。
-- トークンは画面にも CRM にも出さない。

-- 接続情報（事業者は 1 つなので行は常に 1 行。id = 'default'）
create table if not exists public.mf_connections (
  id            text primary key default 'default',
  access_token  text not null,
  refresh_token text not null,
  expires_at    timestamptz not null,   -- access_token の期限（発行から 1 時間）
  scope         text not null default '',
  office_name   text not null default '',
  connected_by  text not null default '', -- 認可した人のメールアドレス
  updated_at    timestamptz not null default now()
);
alter table public.mf_connections enable row level security;

-- 同期の実行ログ（画面の「最終同期」と、失敗したときの原因確認に使う）
create table if not exists public.mf_sync_runs (
  id          bigint generated always as identity primary key,
  started_at  timestamptz not null default now(),
  finished_at timestamptz,
  trigger     text not null default 'manual',   -- manual / cron
  range_from  date,
  range_to    date,
  ok          boolean,
  summary     jsonb not null default '{}'::jsonb,
  error       text
);
alter table public.mf_sync_runs enable row level security;
create index if not exists idx_mf_sync_runs_started on public.mf_sync_runs (started_at desc);
