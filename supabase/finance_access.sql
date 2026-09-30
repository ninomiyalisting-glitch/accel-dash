-- =============================================
-- 財務管理（finance.accel-dash.com）の閲覧範囲
-- =============================================
-- 財務は経営数値なので、社内ドメイン（@accel-partners.co.jp）でも全員には見せない。
-- 見てよい人は public.finance_members（メールアドレス）に載っている人だけ。
--   ・財務のデータ（finance_docs）… もともと finance_members で判定（accel-finance/supabase/finance.sql）
--   ・ポータルの財務タイル       … このファイルで、同じ finance_members で判定するように変える
-- ポータルのユーザー管理で「財務」にチェックを付けると finance_members に入る。
-- 付け外しできるのは ninomiya@accel-partners.co.jp だけ（/api/users でサーバー側でも止めている）。
--
-- 実行後に見られる人：finance_members に載っている人だけ（下の確認用 select で一覧が出る）
-- 実行後に見られなくなる人：finance_members に載っていない社内ドメインの人（財務タイルが消える）
--
-- 何度実行しても壊れない。

-- 財務のアプリかどうか（apps.slug が finance、または URL が finance.accel-dash.com）
create or replace function public.is_finance_app(p_slug text)
returns boolean
language sql
immutable
as $$
  select lower(coalesce(p_slug, '')) = 'finance'
      or lower(coalesce(p_slug, '')) like 'https://finance.accel-dash.com%';
$$;

-- 管理者本人は必ず残す（ポータルからは外せないが、念のため）
insert into public.finance_members (email, note) values
  ('ninomiya@accel-partners.co.jp', '管理者')
on conflict (email) do nothing;

-- apps の閲覧：財務だけは finance_members、それ以外はこれまでどおり（社内ドメイン全員＋権限を付けた人）
drop policy if exists apps_select on public.apps;
create policy apps_select on public.apps
  for select to authenticated
  using (
    case
      when public.is_finance_app(apps.slug) then public.is_finance_member()
      else public.is_staff()
        or exists (
          select 1 from public.app_access a
          where a.app_id = apps.id
            and a.user_id = auth.uid()
        )
    end
  );

-- 確認用：財務のアプリとして扱われる行（1 行出れば OK。0 行ならスラッグを確認）
select id, slug, title from public.apps where public.is_finance_app(slug);

-- 確認用：いま財務を見られる人
select email, note, created_at from public.finance_members order by created_at;
