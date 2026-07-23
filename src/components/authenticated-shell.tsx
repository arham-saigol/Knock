"use client";

import { RedirectToSignIn } from "@clerk/nextjs";
import {
  AuthLoading,
  AuthRefreshing,
  Authenticated,
  Unauthenticated,
} from "convex/react";
import type { ReactNode } from "react";

import { Skeleton } from "@/components/ui/skeleton";

export function AuthenticatedShell({ children }: { children: ReactNode }) {
  return (
    <>
      <Authenticated>{children}</Authenticated>
      <AuthLoading>
        <div className="grid min-h-dvh place-items-center p-8">
          <div className="w-full max-w-sm">
            <Skeleton className="h-8 w-28 rounded-none" />
            <Skeleton className="border-foreground/20 mt-4 h-28 w-full rounded-none border" />
          </div>
        </div>
      </AuthLoading>
      <AuthRefreshing>
        <div className="border-foreground bg-card hard-shadow-sm fixed right-4 bottom-4 border-2 px-3 py-2 font-mono text-[10px] uppercase">
          Refreshing session
        </div>
      </AuthRefreshing>
      <Unauthenticated>
        <RedirectToSignIn />
      </Unauthenticated>
    </>
  );
}
