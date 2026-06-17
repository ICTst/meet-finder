// Auth.js（NextAuth）が、面倒で難しいログイン作業(GoogleやGithubなど)を、裏側で全て自動でやってくれるというライブラリ
// → Auth.jsは、Next.jsでOAuth 2.0の仕組みを簡単に実現してくれている
// Auth.js はインストールした時点で、/api/auth/ 配下のURLを自分専用として使うという仕様になっている
import NextAuth from "next-auth";
import Google from "next-auth/providers/google"; // Googleのログイン機能を追加するための部品

// Auth.jsの役割: return された token を暗号化して Cookie に保存する
export const { handlers, auth, signIn, signOut } = NextAuth({
  // providers と callbacks は NextAuth のエンジンを動かすための、共通の設定フォーマット
  // providers = 「どのログイン方法を提供するか」のリスト / 将来的にここにGitHubやLINEログインなどを並べて追加していくことができる
  providers: [
    // Googleログインの認証時(authorizaiton)に追加の指示(params)があれば書いてね という設定枠をAuth.js側が用意している
    Google({
      authorization: {
        params: {
          // 下記はGoogle公式ルールであり、OAuth2.0の仕様書で定義されているルール
          // scope = 何の権限が欲しいか
          scope: [
            "openid",
            "email",
            "profile",
            "https://www.googleapis.com/auth/calendar.readonly", // カレンダーを読み取る
            "https://www.googleapis.com/auth/calendar.events", // 予定を作成する
            "https://www.googleapis.com/auth/calendar.freebusy", // 空き時間を調べる
          ].join(" "), // Google側のルールで、権限を要求するときは 「半角スペース区切りの１つの長い文字列」 にして送る必要があるため（例： "openid email profile https://... https://..." ）  
          // 裏口の鍵であるリフレッシュトークンが欲しい
          access_type: "offline", // 通常カレンダーを見るための鍵(アクセストークン)は1時間で期限切れになるが、これがあればユーザが再ログインしなくても、裏側で自動的に新しいかぎを再発行してくれる
          // 必ず同意画面を出してね
          prompt: "consent",
        },
      },
    }),
  ],
  // callbacks = 「ログインが成功した直後などに、なにか追加でやりたいことはありますか？」という設定枠
  // 役割: token の中身を加工して return するだけ / 根本的な役割は「tokenの中身を最新の状態に保ち続けること」
  callbacks: {
    // (A) JWTコールバック：トークンの保存と自動更新を行う心臓部
    // jwt = Auth.js のルールで決められた「固定の名前」 / トークンに関する割り込み処理を書きたい時
    // ユーザがGoogleログインに成功した直後、
    // Auth.js は「Googleから受け取ったばかりの生の情報（アクセストークンなど）」を account に詰めて渡してくれる
    // token と account は定型の名前
    async jwt({ token, account }) {
      // --- 初回ログイン時：account に新しいトークンが入っている ---
      if (account) {
        // Googleから渡された「カレンダーを見るための鍵(access_token)」と                                                                                                                                                                        
        // 「裏口の鍵(refresh_token)」を、Auth.jsの金庫(token)に保存する
        // account はログインしたその一瞬しか存在しないため、token に情報を移し替えることで、ブラウザで保持し続けることが可能であり、どの画面に遷移しても「退場！」にならないようにする
        token.access_token = account.access_token;
        token.refresh_token = account.refresh_token;
        token.expires_at = account.expires_at;
        return token; // 受取先は Auth.js / 受け取った token を暗号でロックし、ユーザのブラウザの Cookie に保管してくれる
      }

      // --- 2回目以降：まだ有効ならそのまま使う ---
      // 「1970年1月1日 00:00:00（UTC）から何秒経ったか」を表す整数
      // 例えば 1750000000 は「2025年6月15日 頃」を意味する
      // expires_at　は秒単位 / Date.now() はミリ秒単位 / そのため、* 1000 で単位をそろえる
      if (token.expires_at && Date.now() < token.expires_at * 1000) {
        return token; // ユーザのブラウザの Cookie にある token をそのまま使ってOK
      }

      // --- アクセストークンが期限切れ、かつ refresh_token もない → 更新不可 ---
      if (!token.refresh_token) {
        token.error = "RefreshTokenError";
        return token;
      }

      // --- アクセストークンが期限切れだが、refresh_token はある: refresh_token を使って新しいアクセストークンを取得する ---
      try {
        // 下記内容のPOSTでGoogleが審査OKと判断したら、responseにaccess_tokenなどが入ったオブジェクトが返ってくる
        const response = await fetch("https://oauth2.googleapis.com/token", {
          method: "POST",
          // これはGoogleのルールで、データをURL形式の文字列で送れという意味
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          // new URLSearchParams({...}) = JSのオブジェクトをURL形式に自動変換してくれる
          // オブジェクト { client_id: "xxx", grant_type: "refresh_token" }
          // // ↓ URLSearchParams が自動変換
          // "client_id=xxx&grant_type=refresh_token"
          body: new URLSearchParams({
            client_id: process.env.AUTH_GOOGLE_ID!,
            client_secret: process.env.AUTH_GOOGLE_SECRET!,
            grant_type: "refresh_token",
            refresh_token: token.refresh_token,
          }),
        });

        const newTokens = await response.json();
        if (!response.ok) throw newTokens;

        // 新しく入手した access_token を格納
        token.access_token = newTokens.access_token;
        // newTokens.expires_in = 「あと何秒有効か」という残り時間 / expires_in = 3599 ← 「今から3599秒後に切れる」という意味
        // でも token.expires_at に必要なのは「いつ切れるかという絶対時刻」 / expires_at = 1750003599 ← 「2025年6月15日 XX時XX分に切れる」という意味
        // 1: Date.now() → 例: 1750000000000（ミリ秒）
        // 2: 1の答え / 1000 → 例: 1750000000（秒に変換）
        // 3: 2の答え + 3599 → 例: 1750003599（切れる時刻）
        token.expires_at = Math.floor(Date.now() / 1000 + newTokens.expires_in);
        // Googleは更新時に refresh_token を返さないことが多い → 既存を維持
        if (newTokens.refresh_token) {
          token.refresh_token = newTokens.refresh_token;
        }
        return token; // 書き換えた内容を Auth.js に返して、また Cookie に保存し直してもらっている
      // その他イレギュラーが起きたときのError処理
      // ネットワークエラー・refresh_token失効・Googleサーバエラーで500 など
      } catch (error) {
        console.error("アクセストークンの更新に失敗:", error);
        // 後ほど session コールバックで、UI側が session.error === "RefreshTokenError" を見て「再ログインしてください」と表示するために使う
        token.error = "RefreshTokenError";
        return token;
      }
    },

    // (B) Sessionコールバック：アプリ側で使えるよう accessToken を露出
    // session = Auth.js のルールで決められた「固定の名前」 / セッション（ログイン状態）に関する割り込み処理を書きたい時
    // 役割:  Cookie の token を UI側が使える形に変換する
    // → CookieはHttpOnlyで、JSから読めないため(JSで読めるとXSSでCookie盗まれる) / Cookieの中身が暗号化されているため
    // → Auth.js は UI 側に auth() という関数を提供していて、これを呼ぶと session オブジェクトが取得できる
    async session({ session, token }) {
      session.accessToken = token.access_token;
      session.error = token.error;
      return session;
    },
  },
});