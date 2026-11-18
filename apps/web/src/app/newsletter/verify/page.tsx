import type { Metadata } from "next";
import { Suspense } from "react";
import { VerifyContent } from "./verify-content";

export const metadata: Metadata = {
  title: "Newsletter Verification | Roboto",
  description: "Verify your email address for our newsletter subscription.",
  robots: {
    index: false,
    follow: false,
  },
};

export default function NewsletterVerifyPage() {
  return (
    <main className="flex min-h-[calc(100svh-4rem)] flex-col items-center justify-center px-6 py-24">
      <Suspense fallback={<VerifyPageFallback />}>
        <VerifyContent />
      </Suspense>
    </main>
  );
}

function VerifyPageFallback() {
  return (
    <div className="grid w-full max-w-xl justify-items-center gap-8 text-center animate-pulse">
      <div className="inline-flex items-center gap-2.5 border border-border px-3 py-1.5 font-light font-mono text-foreground text-sm uppercase tracking-[0.28px]">
        <span className="size-2 shrink-0 rounded-[1px] bg-muted-foreground/30" />
        <span>Loading...</span>
      </div>
      <div className="h-10 w-64 bg-muted rounded" />
      <div className="h-4 w-96 bg-muted rounded" />
    </div>
  );
}
