"use client";

import { useEffect, useState } from "react";
import { CheckCircle2, XCircle } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { api } from "@/lib/api";
import type { NotificationDetail } from "@/lib/types";
import { cn } from "@/lib/utils";

/** Full history for one notification, including every delivery attempt. */
export function Inspector({
  notificationId,
  onOpenChange,
}: {
  notificationId: string | null;
  onOpenChange: (open: boolean) => void;
}) {
  const [detail, setDetail] = useState<NotificationDetail | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!notificationId) return;

    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;

    async function load() {
      try {
        const result = await api.notification(notificationId!);
        if (cancelled) return;
        setDetail(result);
        setError(null);
      } catch (caught) {
        if (cancelled) return;
        setError(caught instanceof Error ? caught.message : "Load failed");
      } finally {
        // Keep the attempt list live while a job is still being retried.
        if (!cancelled) timer = setTimeout(load, 1500);
      }
    }

    setDetail(null);
    load();

    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [notificationId]);

  return (
    <Sheet open={notificationId !== null} onOpenChange={onOpenChange}>
      <SheetContent className="w-full gap-0 sm:max-w-md">
        <SheetHeader>
          <SheetTitle className="font-mono text-sm">
            {notificationId?.slice(0, 18)}…
          </SheetTitle>
          <SheetDescription>
            {detail
              ? `${detail.channel} · ${detail.priority} · ${detail.recipientId}`
              : "loading…"}
          </SheetDescription>
        </SheetHeader>

        <Separator />

        <ScrollArea className="flex-1">
          <div className="space-y-4 p-4">
            {error && <p className="text-xs text-destructive">{error}</p>}

            {detail && (
              <>
                <div className="flex flex-wrap items-center gap-1.5">
                  <StatusBadge status={detail.status} />
                  <Badge variant="outline" className="font-mono text-[10px]">
                    attempt {detail.attemptCount}/{detail.maxAttempts}
                  </Badge>
                  {detail.templateId && (
                    <Badge variant="secondary" className="font-mono text-[10px]">
                      templated
                    </Badge>
                  )}
                </div>

                <section className="space-y-1">
                  <h3 className="text-[10px] tracking-wide text-muted-foreground uppercase">
                    Rendered content
                  </h3>
                  <div className="rounded-md bg-muted/50 p-2">
                    {detail.subject && (
                      <p className="mb-1 text-xs font-medium">
                        {detail.subject}
                      </p>
                    )}
                    <p className="font-mono text-[11px] leading-relaxed">
                      {detail.body ?? "—"}
                    </p>
                  </div>
                  {detail.metadata &&
                    Object.keys(detail.metadata).length > 0 && (
                      <p className="font-mono text-[10px] text-muted-foreground">
                        metadata {JSON.stringify(detail.metadata)}
                      </p>
                    )}
                </section>

                {detail.failureReason && (
                  <p className="rounded-md bg-destructive/10 p-2 font-mono text-[11px] text-destructive">
                    {detail.failureReason}
                  </p>
                )}

                <section className="space-y-2">
                  <h3 className="text-[10px] tracking-wide text-muted-foreground uppercase">
                    Attempts · AttemptLog rows
                  </h3>

                  {detail.attempts.length === 0 && (
                    <p className="text-[11px] text-muted-foreground/70">
                      No attempts yet — still waiting on a worker.
                    </p>
                  )}

                  <ol className="space-y-0">
                    {detail.attempts.map((attempt, index) => (
                      <li key={attempt.attemptNumber} className="flex gap-2.5">
                        <div className="flex flex-col items-center">
                          <span
                            className={cn(
                              "mt-1 flex size-4 items-center justify-center rounded-full",
                              attempt.success
                                ? "bg-ok/15 text-ok"
                                : "bg-destructive/15 text-destructive",
                            )}
                          >
                            {attempt.success ? (
                              <CheckCircle2 className="size-3" />
                            ) : (
                              <XCircle className="size-3" />
                            )}
                          </span>
                          {index < detail.attempts.length - 1 && (
                            <span className="w-px flex-1 bg-border" />
                          )}
                        </div>

                        <div className="flex-1 pb-3">
                          <div className="flex items-baseline gap-1.5 font-mono text-[11px]">
                            <span>#{attempt.attemptNumber}</span>
                            <span className="text-muted-foreground">
                              {attempt.provider?.toLowerCase() ?? "—"}
                            </span>
                            <span className="ml-auto text-[10px] text-muted-foreground/70">
                              {new Date(attempt.attemptedAt).toLocaleTimeString(
                                [],
                                { hour12: false },
                              )}
                            </span>
                          </div>
                          <p className="font-mono text-[10px] text-muted-foreground">
                            {attempt.workerId}
                            {attempt.durationMs !== null &&
                              ` · ${attempt.durationMs}ms`}
                          </p>
                          {attempt.errorMessage && (
                            <p className="font-mono text-[10px] text-destructive">
                              {attempt.errorMessage}
                            </p>
                          )}
                          {attempt.providerMessageId && (
                            <p className="truncate font-mono text-[10px] text-ok">
                              {attempt.providerMessageId}
                            </p>
                          )}
                        </div>
                      </li>
                    ))}
                  </ol>
                </section>

                <section className="space-y-0.5 font-mono text-[10px] text-muted-foreground">
                  <Row label="created" value={detail.createdAt} />
                  {detail.scheduledAt && (
                    <Row label="scheduled" value={detail.scheduledAt} />
                  )}
                  {detail.deliveredAt && (
                    <Row label="delivered" value={detail.deliveredAt} />
                  )}
                </section>
              </>
            )}
          </div>
        </ScrollArea>
      </SheetContent>
    </Sheet>
  );
}

function StatusBadge({ status }: { status: string }) {
  const variant =
    status === "DELIVERED"
      ? "default"
      : status === "FAILED"
        ? "destructive"
        : "secondary";
  return (
    <Badge variant={variant} className="font-mono text-[10px]">
      {status}
    </Badge>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-2">
      <span>{label}</span>
      <span className="truncate">{new Date(value).toLocaleString()}</span>
    </div>
  );
}
