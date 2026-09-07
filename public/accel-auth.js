/* =====================================================================
   アクセルダッシュ 共通ログイン（サブドメイン横断セッション）
   ---------------------------------------------------------------------
   Supabase の標準では localStorage にセッションを保存するため、
   accel-dash.com と xxx.accel-dash.com で別扱いになり再ログインが必要でした。
   このファイルは保存先を .accel-dash.com の Cookie に差し替えます。

   使い方: Supabase のライブラリ読み込み後、アプリのコードより前に
     <script src="https://accel-dash.com/accel-auth.js"></script>
   を置き、クライアント生成時に storage を渡します。
     createClient(url, anonKey, {
       auth: { storage: window.accelCookieStorage || undefined }
     })
   読み込みに失敗した場合は undefined になり、標準の localStorage に
   自動でフォールバックします（そのアプリ単体では動き続けます）。
   ===================================================================== */
(function () {
  var SHARED_DOMAIN = 'accel-dash.com';
  var CHUNK = 3000;      // Cookie 1 個あたり約 4KB 上限のため分割する
  var MAX_CHUNKS = 12;
  var MAX_AGE = 60 * 60 * 24 * 30; // 30 日

  function domainAttr() {
    var h = location.hostname;
    var suffix = '.' + SHARED_DOMAIN;
    if (h === SHARED_DOMAIN || h.slice(-suffix.length) === suffix) {
      return '; domain=' + suffix;
    }
    return ''; // localhost などでは現在のホストのみ
  }

  function secureAttr() {
    return location.protocol === 'https:' ? '; secure' : '';
  }

  function readRaw(name) {
    var target = encodeURIComponent(name) + '=';
    var parts = document.cookie ? document.cookie.split('; ') : [];
    for (var i = 0; i < parts.length; i++) {
      if (parts[i].indexOf(target) === 0) return parts[i].slice(target.length);
    }
    return null;
  }

  function writeRaw(name, value) {
    document.cookie =
      encodeURIComponent(name) + '=' + value +
      '; path=/' + domainAttr() + '; max-age=' + MAX_AGE + '; samesite=lax' + secureAttr();
  }

  function deleteRaw(name) {
    document.cookie =
      encodeURIComponent(name) + '=; path=/' + domainAttr() + '; max-age=0; samesite=lax' + secureAttr();
  }

  window.accelCookieStorage = {
    getItem: function (key) {
      var joined = '';
      for (var i = 0; i < MAX_CHUNKS; i++) {
        var part = readRaw(key + '.' + i);
        if (part === null) break;
        joined += part;
      }
      if (!joined) {
        var single = readRaw(key);
        if (single === null) return null;
        joined = single;
      }
      try {
        return decodeURIComponent(joined);
      } catch (e) {
        return null;
      }
    },

    setItem: function (key, value) {
      var encoded = encodeURIComponent(String(value));
      var count = Math.ceil(encoded.length / CHUNK) || 1;
      deleteRaw(key); // 旧形式の単一 Cookie を掃除
      for (var i = 0; i < count; i++) {
        writeRaw(key + '.' + i, encoded.slice(i * CHUNK, (i + 1) * CHUNK));
      }
      for (var j = count; j < MAX_CHUNKS; j++) {
        deleteRaw(key + '.' + j); // 前回より短くなった分を削除
      }
    },

    removeItem: function (key) {
      deleteRaw(key);
      for (var i = 0; i < MAX_CHUNKS; i++) {
        deleteRaw(key + '.' + i);
      }
    }
  };
})();
