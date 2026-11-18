"use client";

import { Button } from "@workspace/ui/components/button";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useEffect } from "react";

export function VerifyContent() {
  const searchParams = useSearchParams();
  const status = searchParams.get("status") ?? undefined;
  const token = searchParams.get("token") ?? undefined;

  // If a raw token was provided directly in the URL query, redirect to the API route
  // to perform atomic verification and redirect back with the verified status.
  useEffect(() => {
    if (token && !status) {
      window.location.replace(
        `/api/newsletter/verify?token=${encodeURIComponent(token)}`
      );
    }
  }, [token, status]);

  if (token && !status) {
    return (
      <div className="grid w-full max-w-xl justify-items-center gap-8 text-center animate-pulse">
        <div className="inline-flex items-center gap-2.5 border border-border px-3 py-1.5 font-light font-mono text-foreground text-sm uppercase tracking-[0.28px]">
          <span className="size-2 shrink-0 rounded-[1px] bg-muted-foreground/30" />
          <span>Confirming verification...</span>
        </div>
        <h1 className="max-w-lg text-balance font-normal text-3xl tracking-tight sm:text-4xl text-foreground">
          Verifying your email...
        </h1>
        <p className="max-w-md text-balance text-muted-foreground text-base leading-relaxed">
          Please wait while we confirm your subscription.
        </p>
      </div>
    );
  }

  const content = getContentForStatus(status);

  return (
    <div className="grid w-full max-w-xl justify-items-center gap-8 text-center">
      {/* Status indicator tag */}
      <div className="inline-flex items-center gap-2.5 border border-border px-3 py-1.5 font-light font-mono text-foreground text-sm uppercase tracking-[0.28px]">
        <span
          className={`size-2 shrink-0 rounded-[1px] ${content.dotColor}`}
        />
        <span>{content.tag}</span>
      </div>

      {/* Heading */}
      <h1 className="max-w-lg text-balance font-normal text-3xl tracking-tight sm:text-4xl text-foreground">
        {content.title}
      </h1>

      {/* Description */}
      <p className="max-w-md text-balance text-muted-foreground text-base leading-relaxed">
        {content.description}
      </p>

      {/* Actions */}
      <div className="flex flex-wrap items-center justify-center gap-3 pt-2">
        {content.primaryAction && (
          <Button
            asChild
            className="h-10 rounded-full px-5 font-mono font-normal text-sm uppercase tracking-wide"
            size="sm"
            variant="default"
          >
            <Link href={content.primaryAction.href}>
              {content.primaryAction.label}
            </Link>
          </Button>
        )}

        <Button
          asChild
          className="h-10 rounded-full px-5 font-mono font-normal text-sm uppercase tracking-wide"
          size="sm"
          variant="secondary"
        >
          <Link href="/">Return home</Link>
        </Button>
      </div>
    </div>
  );
}

function getContentForStatus(status?: string) {
  switch (status) {
    case "success":
      return {
        tag: "Subscription Active",
        dotColor: "bg-emerald-500",
        title: "You're all set!",
        description:
          "Thank you for confirming your email address. You are now officially subscribed to our newsletter and will receive our latest articles and updates.",
        primaryAction: {
          label: "Explore blog",
          href: "/blog",
        },
      };

    case "already-active":
      return {
        tag: "Already Subscribed",
        dotColor: "bg-blue-500",
        title: "You're already subscribed",
        description:
          "Your email address is already verified and active on our subscriber list. No further action is needed.",
        primaryAction: {
          label: "Read blog",
          href: "/blog",
        },
      };

    case "expired":
      return {
        tag: "Link Expired",
        dotColor: "bg-amber-500",
        title: "Verification link expired",
        description:
          "For your security, verification links expire after 15 minutes. Please head to our homepage and submit your email again to receive a fresh verification link.",
        primaryAction: {
          label: "Subscribe again",
          href: "/#subscribe",
        },
      };

    case "invalid":
    case "error":
    default:
      return {
        tag: "Verification Error",
        dotColor: "bg-destructive",
        title: "Invalid or expired link",
        description:
          "This verification link is invalid, malformed, or has already been used. If you still need to subscribe, please submit your email on our homepage.",
        primaryAction: {
          label: "Subscribe again",
          href: "/#subscribe",
        },
      };
  }
}
