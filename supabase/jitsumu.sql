-- =============================================
-- 実務従事 申込者管理（accel-dash.com/jitsumu）
-- =============================================
-- Excel の「実務従事申込者名簿」をアプリにしたもの。
--   jitsumu_sessions … 開催回（月 × 会場。東京・大阪・名古屋・福岡・Zoom など）
--   jitsumu_people   … 申込者（同じ人が何回申し込んでも 1 人。メールアドレスで同じ人とみなす）
--   jitsumu_entries  … 申込（人 × 開催回）。返信・案内送信・入金確認・課題・実績証明書などのチェックを持つ
--
-- 権限: 担当者（@accel-partners.co.jp、public.is_staff()）だけが読み書きできる。
-- 何度実行しても壊れない（if not exists / drop policy if exists）。

create table if not exists public.jitsumu_sessions (
  id          uuid primary key default gen_random_uuid(),
  ym          text not null,                 -- 開催月 'YYYY-MM'
  venue       text not null default '',      -- 東京 / 大阪 / 名古屋 / 福岡 / Zoom など
  label       text not null default '',      -- Excel の見出し・回の呼び名
  dates       text not null default '',      -- 日程（例：11/15・16・29・30）
  capacity    integer,                       -- 定員
  status      text not null default '',      -- '' / 募集中 / 締切 / 中止 / 検討中
  note        text not null default '',
  sort        integer not null default 0,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create table if not exists public.jitsumu_people (
  id             uuid primary key default gen_random_uuid(),
  name           text not null,
  email          text not null default '',
  phone          text not null default '',
  region         text not null default '',   -- 地域（都道府県）
  pass_year      text not null default '',   -- 合格年度（令和7年度 / 更新ポイント希望 など）
  card           text not null default '',   -- 名刺情報・所属
  note           text not null default '',
  individual_id  text not null default '',   -- 基幹システムの個人顧客（次のステップで連携）
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);
create index if not exists idx_jitsumu_people_email on public.jitsumu_people (lower(email));

create table if not exists public.jitsumu_entries (
  id          uuid primary key default gen_random_uuid(),
  person_id   uuid not null references public.jitsumu_people(id) on delete cascade,
  session_id  uuid references public.jitsumu_sessions(id) on delete set null,
  status      text not null default '申込',  -- 申込 / キャンセル / 検討中
  points      text not null default '',      -- 希望ポイント
  grp         text not null default '',      -- グループ（A/B/C）
  format      text not null default '',      -- リアル / Zoom（古い回のみ）
  party       text not null default '',      -- 懇親会
  tag         text not null default '',      -- メモ札（飲み会・会場変更 など）
  note        text not null default '',      -- 申込時の備考
  raw_status  text not null default '',
  checks      jsonb not null default '{}'::jsonb,  -- {reply, guide, group_add, member, mail, paid, ppt, task, task_return, cert, cert_return}
  extra       jsonb not null default '{}'::jsonb,  -- 古い Excel の列（出欠・チーム・請求書送付 など）をそのまま
  source      text not null default 'manual',      -- excel:シート名 / manual / web
  sort        integer not null default 0,
  applied_at  date,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index if not exists idx_jitsumu_entries_person  on public.jitsumu_entries (person_id);
create index if not exists idx_jitsumu_entries_session on public.jitsumu_entries (session_id);

-- updated_at を自動更新（資料置き場と同じ関数）
create or replace function public.touch_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end $$;
drop trigger if exists trg_jitsumu_sessions_touch on public.jitsumu_sessions;
create trigger trg_jitsumu_sessions_touch before update on public.jitsumu_sessions for each row execute function public.touch_updated_at();
drop trigger if exists trg_jitsumu_people_touch on public.jitsumu_people;
create trigger trg_jitsumu_people_touch before update on public.jitsumu_people for each row execute function public.touch_updated_at();
drop trigger if exists trg_jitsumu_entries_touch on public.jitsumu_entries;
create trigger trg_jitsumu_entries_touch before update on public.jitsumu_entries for each row execute function public.touch_updated_at();

-- RLS：担当者のみ
alter table public.jitsumu_sessions enable row level security;
alter table public.jitsumu_people   enable row level security;
alter table public.jitsumu_entries  enable row level security;

drop policy if exists jitsumu_sessions_staff on public.jitsumu_sessions;
create policy jitsumu_sessions_staff on public.jitsumu_sessions
  for all to authenticated using (public.is_staff()) with check (public.is_staff());
drop policy if exists jitsumu_people_staff on public.jitsumu_people;
create policy jitsumu_people_staff on public.jitsumu_people
  for all to authenticated using (public.is_staff()) with check (public.is_staff());
drop policy if exists jitsumu_entries_staff on public.jitsumu_entries;
create policy jitsumu_entries_staff on public.jitsumu_entries
  for all to authenticated using (public.is_staff()) with check (public.is_staff());

-- ポータルのアプリ一覧にタイルを出す（名前・説明・並び順は画面から編集できる）
insert into public.apps (slug, title, description, "order")
select '/jitsumu', '実務従事 申込者管理', '開催回ごとの申込者・チェック（返信〜実績証明書）・参加歴・集計', 10
where not exists (select 1 from public.apps where slug = '/jitsumu');
