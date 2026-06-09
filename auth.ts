import NextAuth from "next-auth";
import Google from "next-auth/providers/google";

export const { handlers, auth, signIn, signOut } = NextAuth({
  providers: [
    Google({
      authorization: {
        params: {
          scope: [
            "openid",
            "email",
            "profile",
            "https://www.googleapis.com/auth/calendar.readonly",
            "https://www.googleapis.com/auth/calendar.events",
            "https://www.googleapis.com/auth/calendar.freebusy",
          ].join(" "),
          access_type: "offline",
          prompt: "consent",
        },
      },
    }),
  ],
  callbacks: {
    // (A) JWTコールバック：トークンの保存と自動更新を行う心臓部
    async jwt({ token, account }) {
      // --- 初回ログイン時：account に新しいトークンが入っている ---
      if (account) {
        token.access_token = account.access_token;
        token.refresh_token = account.refresh_token;
        token.expires_at = account.expires_at;
        return token;
      }

      // --- 2回目以降：まだ有効ならそのまま使う
      if (token.expires_at && Date.now() < token.expires_at * 1000) {
        return token;
      }

      // --- 失効済み：refresh_token で更新する ---
      if (!token.refresh_token) {
        token.error = "RefreshTokenError";
        return token;
      }

      try {
        const response = await fetch("https://oauth2.googleapis.com/token", {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body: new URLSearchParams({
            client_id: process.env.AUTH_GOOGLE_ID!,
            client_secret: process.env.AUTH_GOOGLE_SECRET!,
            grant_type: "refresh_token",
            refresh_token: token.refresh_token,
          }),
        });

        const newTokens = await response.json();
        if (!response.ok) throw newTokens;

        token.access_token = newTokens.access_token;
        token.expires_at = Math.floor(Date.now() / 1000 + newTokens.expires_in);
        // Googleは更新時に refresh_token を返さないことが多い → 既存を維持
        if (newTokens.refresh_token) {
          token.refresh_token = newTokens.refresh_token;
        }
        return token;
      } catch (error) {
        console.error("アクセストークンの更新に失敗:", error);
        token.error = "RefreshTokenError";
        return token;
      }
    },

    // (B) Sessionコールバック：アプリ側で使えるよう accessToken を露出
    async session({ session, token }) {
      session.accessToken = token.access_token;
      session.error = token.error;
      return session;
    },
  },
});