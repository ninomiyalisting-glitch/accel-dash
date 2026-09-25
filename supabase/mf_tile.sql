-- 「マネーフォワード連携」（accel-dash.com/mf）をアプリ一覧のタイルとして登録する。
-- slug が '/' で始まる行はポータル内のページへのリンクになる（資料置き場と同じ仕組み）。
-- 名前・説明・並び順は他のアプリと同じく画面から編集できる。実行済み（2026-09-25）。
insert into public.apps (slug, title, description, "order")
select '/mf', 'マネーフォワード連携', 'クラウド請求書と会計の実績を CRM・財務管理に取り込む（接続・同期・記録）', 99
where not exists (select 1 from public.apps where slug = '/mf');
