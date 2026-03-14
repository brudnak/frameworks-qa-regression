"use client";

import { signIn } from "next-auth/react";

export function SignInButton() {
  return (
    <button className="primary-button" onClick={() => signIn("github")}>
      Sign In With GitHub
    </button>
  );
}
