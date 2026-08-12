"use client";

import { useEffect, useState } from "react";
import { Send, Zap } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { api, type CreateNotificationInput } from "@/lib/api";

/**
 * The demo has no authoring UI — content comes from the one seeded template, so
 * there is nothing to compose. This is just the trigger.
 */

// Sized against the SMS bucket (20/min) so a burst always overflows it. Without
// exceeding the limit nothing would ever reach RATE_LIMITED, and watching the
// overflow park and drain is the point of the burst.
const BURST_SIZE = 25;

// Every send needs a distinct recipient. The idempotency key is
// `recipientId|channel|templateId|bodyHash|scheduledAt`, and with a template the
// body is fixed — so a repeated recipient collides and returns the existing
// notification instead of creating a new one, and nothing would move.
function recipient(): string {
  return `user_${Math.random().toString(36).slice(2, 8)}`;
}

function payload(templateId: string): CreateNotificationInput {
  return {
    templateId,
    recipientId: recipient(),
    channel: "SMS",
    priority: "MEDIUM",
  };
}

export function SendPanel({
  onSent,
  note,
}: {
  onSent: () => void;
  note: (text: string, notificationId?: string) => void;
}) {
  const [busy, setBusy] = useState(false);
  // The seeded template's id is generated at seed time, so it has to be looked
  // up. Content still comes entirely from the server — nothing is composed here.
  const [templateId, setTemplateId] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    api
      .templates()
      .then((templates) => {
        if (cancelled) return;
        const template = templates[0];
        if (template) setTemplateId(template.id);
        else toast.error("No template seeded — run the seed on the API");
      })
      .catch(() => {
        if (!cancelled) toast.error("Could not load the template");
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const ready = templateId !== null && !busy;

  async function sendOne() {
    if (!templateId) return;
    setBusy(true);
    try {
      const result = await api.createNotification(payload(templateId));
      note(`sent ${result.id.slice(0, 8)}`, result.id);
      onSent();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Send failed");
    } finally {
      setBusy(false);
    }
  }

  async function sendBurst() {
    if (!templateId) return;
    setBusy(true);
    try {
      const { results } = await api.createBatch(
        Array.from({ length: BURST_SIZE }, () => payload(templateId)),
      );
      const accepted = results.filter((r) => r.success).length;
      const rejected = results.length - accepted;

      note(`burst of ${accepted} sent`);
      if (rejected > 0) {
        toast.warning(`${rejected} of ${results.length} rejected`);
      }
      onSent();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Burst failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-xs font-medium">Send</CardTitle>
      </CardHeader>
      <CardContent className="space-y-2.5">
        <div className="flex gap-2">
          <Button
            size="sm"
            className="flex-1"
            onClick={sendOne}
            disabled={!ready}
          >
            <Send className="size-3.5" />
            Send one
          </Button>
          <Button
            size="sm"
            variant="secondary"
            className="flex-1"
            onClick={sendBurst}
            disabled={!ready}
          >
            <Zap className="size-3.5" />
            Burst {BURST_SIZE}
          </Button>
        </div>
        <p className="text-[11px] leading-relaxed text-muted-foreground">
          SMS, from the seeded template. The channel allows 20 per minute, so a
          burst of {BURST_SIZE} overflows the bucket — the excess waits in{" "}
          <span className="text-foreground">rate limited</span> until it refills.
        </p>
      </CardContent>
    </Card>
  );
}
