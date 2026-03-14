"use client";

import { signOut } from "next-auth/react";

export function SignOutButton() {
  return (
    <button className="secondary-button" onClick={() => signOut()}>
      Sign Out
    </button>
  );
}
