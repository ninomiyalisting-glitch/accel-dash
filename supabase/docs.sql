-- =============================================
-- 資料置き場（Google ドライブ等へのリンク集）
-- =============================================
-- 重要な資料・マニュアル・共有シートを「事業部 × 用途」で整理して、
-- ポータル（/docs）からサッと探せるようにする。
-- ファイル本体は Google ドライブに置いたまま、ここにはリンクだけを持つ。
--
-- 権限: 担当者（@accel-partners.co.jp、public.is_staff()）だけが読み書きできる。
--       Magnet に招待したクライアントなど社外ユーザーには一切見えない。
-- 何度実行しても壊れない（if not exists / drop policy if exists）。

-- 事業部（横軸のタブ）
create table if not exists public.doc_divisions (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  sort_order  integer not null default 0,
  created_at  timestamptz not null default now()
);

-- 用途（マニュアル・テンプレート・管理シート・規程 など）
create table if not exists public.doc_purposes (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  sort_order  integer not null default 0,
  created_at  timestamptz not null default now()
);

-- リンク本体
create table if not exists public.doc_links (
  id           uuid primary key default gen_random_uuid(),
  title        text not null,
  description  text,
  url          text not null,
  -- URL から判定した種類。sheet / doc / slide / form / folder / pdf / file / link
  kind         text not null default 'link',
  division_id  uuid references public.doc_divisions(id) on delete set null,
  purpose_id   uuid references public.doc_purposes(id)  on delete set null,
  -- 重要資料。一覧の先頭に固定表示する
  pinned       boolean not null default false,
  created_by   uuid references auth.users(id) on delete set null,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create index if not exists idx_doc_links_division on public.doc_links (division_id);
create index if not exists idx_doc_links_purpose  on public.doc_links (purpose_id);

-- updated_at を自動更新
create or replace function public.touch_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end $$;

drop trigger if exists trg_doc_links_touch on public.doc_links;
create trigger trg_doc_links_touch
  before update on public.doc_links
  for each row execute function public.touch_updated_at();

-- =============================================
-- RLS：担当者のみ
-- =============================================
alter table public.doc_divisions enable row level security;
alter table public.doc_purposes  enable row level security;
alter table public.doc_links     enable row level security;

drop policy if exists doc_divisions_staff on public.doc_divisions;
create policy doc_divisions_staff on public.doc_divisions
  for all to authenticated
  using (public.is_staff()) with check (public.is_staff());

drop policy if exists doc_purposes_staff on public.doc_purposes;
create policy doc_purposes_staff on public.doc_purposes
  for all to authenticated
  using (public.is_staff()) with check (public.is_staff());

drop policy if exists doc_links_staff on public.doc_links;
create policy doc_links_staff on public.doc_links
  for all to authenticated
  using (public.is_staff()) with check (public.is_staff());

-- =============================================
-- 初期データ（無いときだけ入れる。名前は画面から変えられる）
-- =============================================
insert into public.doc_divisions (name, sort_order)
select v.name, v.ord from (values
  ('全社共通', 1), ('コンサルティング', 2), ('ビジネスカレッジ', 3), ('採用支援', 4)
) as v(name, ord)
where not exists (select 1 from public.doc_divisions);

insert into public.doc_purposes (name, sort_order)
select v.name, v.ord from (values
  ('マニュアル', 1), ('テンプレート', 2), ('管理シート', 3), ('規程・ルール', 4), ('提案資料', 5), ('その他', 9)
) as v(name, ord)
where not exists (select 1 from public.doc_purposes);
