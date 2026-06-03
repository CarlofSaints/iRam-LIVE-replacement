import { Suspense } from "react";
import SSOCallbackClient from "./SSOCallbackClient";

export const dynamic = "force-dynamic";

export default function SSOCallbackPage() {
  return (
    <Suspense
      fallback={
        <div className="flex min-h-screen items-center justify-center bg-zinc-50">
          <div className="text-sm text-zinc-400">Signing in...</div>
        </div>
      }
    >
      <SSOCallbackClient />
    </Suspense>
  );
}
