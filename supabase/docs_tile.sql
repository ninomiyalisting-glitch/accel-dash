-- 「資料置き場」をアプリ一覧のタイルとして登録する。
-- slug が '/' で始まる行はポータル内のページ（accel-dash.com/docs）へのリンクになる。
-- 名前・説明・並び順は他のアプリと同じく画面から編集できる。
insert into public.apps (slug, title, description, "order")
select '/docs', '資料置き場', 'Google ドライブの重要資料・マニュアル・共有シート', 0
where not exists (select 1 from public.apps where slug = '/docs');
