import "next-auth";
import "next-auth/jwt";

// Session（page.tsx などで await auth() して受け取る型）に accessToken を足す
declare module "next-auth" {
  interface Session {
    accessToken?: string;
    error?: "RefreshTokenError";
  }
}

// JWT（サーバー内部で持ち回るトークン）に各種フィールドを足す
declare module "next-auth/jwt" {
  interface JWT {
    access_token?: string;
    refresh_token?: string;
    expires_at?: number;
    error?: "RefreshTokenError";
  }
}