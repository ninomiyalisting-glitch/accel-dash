-- =============================================
-- アプリごとのアクセス権
-- =============================================
-- これまでポータルは apps を無条件に読んでいたため、Magnet に招待した
-- クライアントが accel-dash.com にログインすると社内アプリ 7 つ全部の
-- タイルが見えてしまっていた。
--
-- accel-dash は Supabase Auth を使っているので、RLS の中で auth.uid() が
-- 使える。つまり画面側のフィルタではなく RLS で本当に止められる。
-- （ビジネスカレッジは Supabase Auth ではないので同じ手が使えない）
--
-- 方針
--   担当者（@accel-partners.co.jp）… 全アプリ
--   それ以外                        … app_access に行があるアプリだけ

-- 担当者判定。Magnet のスキーマと同じ定義（同一プロジェクトなので既にあるが、
-- 単体で実行しても通るように置き直す）
create or replace function public.is_staff()
returns boolean
language sql
stable
as $$
  select coalesce(auth.jwt() ->> 'email', '') like '%@accel-partners.co.jp';
$$;

-- apps.id の型に合わせて作る（uuid でも text でも通るようにしておく）
do $$
declare id_type text;
begin
  select format_type(a.atttypid, a.atttypmod) into id_type
  from pg_attribute a
  where a.attrelid = 'public.apps'::regclass
    and a.attname = 'id'
    and a.attnum > 0;

  if id_type is null then
    raise exception 'public.apps.id が見つかりません';
  end if;

  execute format($f$
    create table if not exists public.app_access (
      app_id     %s   not null references public.apps(id)      on delete cascade,
      user_id    uuid not null references auth.users(id)       on delete cascade,
      granted_by uuid          references auth.users(id)       on delete set null,
      created_at timestamptz not null default now(),
      primary key (app_id, user_id)
    )
  $f$, id_type);
end $$;

create index if not exists idx_app_access_user on public.app_access (user_id);

-- =============================================
-- RLS
-- =============================================
alter table public.app_access enable row level security;

-- 自分の権限は見える。担当者は全員分見える。
drop policy if exists app_access_select on public.app_access;
create policy app_access_select on public.app_access
  for select to authenticated
  using (public.is_staff() or user_id = auth.uid());

-- 付け外しはポータルの API（service_role）からのみ。
-- ここを authenticated に開けると、自分で自分に権限を付けられてしまう。
drop policy if exists app_access_write on public.app_access;
create policy app_access_write on public.app_access
  for all to service_role
  using (true) with check (true);

-- =============================================
-- apps の閲覧範囲を絞る
-- =============================================
-- 書き込みは /api/apps が service_role で行う（RLS を通らない）ので、
-- ここでは SELECT だけを定義する。
alter table public.apps enable row level security;

do $$
declare p record;
begin
  -- 既存の SELECT / ALL ポリシーを外す（無条件に読める古いポリシーが残ると意味が無い）
  for p in
    select policyname from pg_policies
    where schemaname = 'public' and tablename = 'apps' and cmd in ('SELECT', 'ALL')
  loop
    execute format('drop policy if exists %I on public.apps', p.policyname);
    raise notice '外した既存ポリシー: %', p.policyname;
  end loop;
end $$;

create policy apps_select on public.apps
  for select to authenticated
  using (
    public.is_staff()
    or exists (
      select 1 from public.app_access a
      where a.app_id = apps.id
        and a.user_id = auth.uid()
    )
  );

-- =============================================
-- 既存クライアントの取り込み
-- =============================================
-- すでに Magnet の企業に紐づいている人に、Magnet の権限を与える。
-- これをやらないと、今ログインできている人が突然何も見えなくなる。
insert into public.app_access (app_id, user_id)
select app.id, m.user_id
from public.apps app
cross join (
  select distinct user_id
  from public.company_members
  where user_id is not null
) m
where app.slug = 'magnet'
on conflict (app_id, user_id) do nothing;

-- 確認用
select
  (select count(*) from public.app_access) as 権限の行数,
  (select count(*) from public.apps)       as アプリ数;
