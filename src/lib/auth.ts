import type { NextAuthOptions } from "next-auth";
import GitHubProvider from "next-auth/providers/github";
import { getGitHubAuthConfig } from "@/lib/config";

const authConfig = getGitHubAuthConfig();

export const authOptions: NextAuthOptions = {
  secret: authConfig.nextAuthSecret,
  providers: [
    GitHubProvider({
      clientId: authConfig.clientId,
      clientSecret: authConfig.clientSecret,
    }),
  ],
  callbacks: {
    async jwt({ token, profile }) {
      if (profile && "login" in profile) {
        token.login = String(profile.login);
      }

      return token;
    },
    async session({ session, token }) {
      if (session.user) {
        session.user.login =
          typeof token.login === "string" ? token.login : undefined;
      }

      return session;
    },
  },
};
