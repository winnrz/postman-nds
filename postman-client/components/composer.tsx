"use client";

import { useEffect, useMemo, useState } from "react";
import { Dices, Loader2, Plus, Send, Zap } from "lucide-react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { api, type CreateNotificationInput } from "@/lib/api";
import type { Channel, Priority, Template } from "@/lib/types";

const CHANNELS = [
  { value: "EMAIL", label: "Email · SendGrid" },
  { value: "SMS", label: "SMS · Twilio" },
];

const PRIORITIES = [
  { value: "LOW", label: "Low" },
  { value: "MEDIUM", label: "Medium" },
  { value: "HIGH", label: "High" },
];

const SCHEDULES = [
  { value: "0", label: "Send now" },
  { value: "20", label: "In 20 seconds" },
  { value: "60", label: "In 1 minute" },
  { value: "300", label: "In 5 minutes" },
];

const VARIABLE_PATTERN = /\{\{\s*([a-zA-Z0-9_.-]+)\s*\}\}/g;

/** Mirrors the server-side renderer so the form can ask for exactly what a template needs. */
function templateVariables(template: Template | undefined): string[] {
  if (!template) return [];
  const found = new Set<string>();
  for (const source of [template.bodyTemplate, template.subjectTemplate ?? ""]) {
    for (const match of source.matchAll(VARIABLE_PATTERN)) found.add(match[1]);
  }
  // The server always supplies this one.
  found.delete("recipientId");
  return [...found];
}

function randomRecipient() {
  return `user_${Math.floor(Math.random() * 9000 + 1000)}`;
}

export function Composer({
  onSent,
  note,
}: {
  onSent: () => void;
  note: (text: string, notificationId?: string) => void;
}) {
  const [mode, setMode] = useState<"template" | "adhoc">("template");
  const [channel, setChannel] = useState<Channel>("EMAIL");
  const [priority, setPriority] = useState<Priority>("MEDIUM");
  const [recipient, setRecipient] = useState("user_1042");
  const [delaySeconds, setDelaySeconds] = useState("0");
  const [templateId, setTemplateId] = useState<string>("");
  const [variables, setVariables] = useState<Record<string, string>>({});
  const [subject, setSubject] = useState("Your order shipped");
  const [body, setBody] = useState("Hey — tracking number 1Z999AA10123456784.");
  const [templates, setTemplates] = useState<Template[]>([]);
  const [sending, setSending] = useState(false);
  const [showNewTemplate, setShowNewTemplate] = useState(false);

  async function loadTemplates() {
    try {
      setTemplates(await api.templates());
    } catch {
      // The dashboard header already reports API reachability.
    }
  }

  useEffect(() => {
    loadTemplates();
  }, []);

  const channelTemplates = useMemo(
    () => templates.filter((t) => t.channel === channel),
    [templates, channel],
  );

  const selected = channelTemplates.find((t) => t.id === templateId);
  const needed = templateVariables(selected);

  // A template belongs to one channel; drop the selection when the channel changes.
  useEffect(() => {
    if (templateId && !channelTemplates.some((t) => t.id === templateId)) {
      setTemplateId("");
    }
  }, [channelTemplates, templateId]);

  function buildInput(recipientId: string): CreateNotificationInput {
    const scheduleSeconds = Number(delaySeconds);
    const input: CreateNotificationInput = {
      recipientId,
      channel,
      priority,
    };

    if (scheduleSeconds > 0) {
      input.scheduleAt = new Date(
        Date.now() + scheduleSeconds * 1000,
      ).toISOString();
    }

    if (mode === "template" && templateId) {
      input.templateId = templateId;
      const metadata = Object.fromEntries(
        needed.map((key) => [key, variables[key] ?? ""]),
      );
      if (Object.keys(metadata).length > 0) input.metadata = metadata;
    } else {
      input.body = body;
      if (channel === "EMAIL" && subject) input.subject = subject;
    }

    return input;
  }

  async function send() {
    if (mode === "template" && !templateId) {
      toast.error("Pick a template first");
      return;
    }

    setSending(true);
    try {
      const result = await api.createNotification(buildInput(recipient));
      if (result.deduplicated) {
        toast.info("Deduplicated", {
          description: `Same idempotency key as ${result.id.slice(0, 8)} — no new row.`,
        });
        note(`${result.id.slice(0, 8)} deduplicated (idempotency key hit)`);
      } else {
        toast.success(`Accepted · ${result.status.toLowerCase()}`, {
          description: result.id,
        });
      }
      onSent();
    } catch (error) {
      const message = error instanceof Error ? error.message : "Send failed";
      toast.error("Rejected", { description: message });
      note(`rejected: ${message}`);
    } finally {
      setSending(false);
    }
  }

  async function burst(count: number) {
    setSending(true);
    try {
      // Distinct recipients so the idempotency key differs per item — otherwise
      // the batch collapses into one notification.
      const payload = Array.from({ length: count }, () =>
        buildInput(randomRecipient()),
      );
      const { results } = await api.createBatch(payload);
      const created = results.filter((r) => r.created).length;
      const rejected = results.filter((r) => !r.success);

      if (rejected.length > 0) {
        toast.warning(`${created} queued, ${rejected.length} rejected`, {
          description: rejected[0]?.message,
        });
      } else {
        toast.success(`${created} notifications queued`);
      }
      note(`burst: ${created} queued via POST /notifications/batch`);
      onSent();
    } catch (error) {
      toast.error("Batch failed", {
        description: error instanceof Error ? error.message : undefined,
      });
    } finally {
      setSending(false);
    }
  }

  return (
    <Card size="sm" className="gap-3">
      <div className="flex items-center gap-2 px-3">
        <Send className="size-3.5 text-primary" />
        <h2 className="text-xs font-medium">Compose</h2>
        <Badge variant="outline" className="ml-auto font-mono text-[10px]">
          POST /notifications
        </Badge>
      </div>

      <div className="space-y-3 px-3">
        <Tabs
          value={mode}
          onValueChange={(value) => setMode(value as "template" | "adhoc")}
        >
          <TabsList className="w-full">
            <TabsTrigger value="template" className="flex-1">
              Template
            </TabsTrigger>
            <TabsTrigger value="adhoc" className="flex-1">
              Ad-hoc
            </TabsTrigger>
          </TabsList>
        </Tabs>

        <div className="grid grid-cols-2 gap-2">
          <div className="space-y-1">
            <Label className="text-[10px] text-muted-foreground">Channel</Label>
            <Select
              items={CHANNELS}
              value={channel}
              onValueChange={(value) => setChannel(value as Channel)}
            >
              <SelectTrigger size="sm" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {CHANNELS.map((option) => (
                  <SelectItem key={option.value} value={option.value}>
                    {option.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1">
            <Label className="text-[10px] text-muted-foreground">Priority</Label>
            <Select
              items={PRIORITIES}
              value={priority}
              onValueChange={(value) => setPriority(value as Priority)}
            >
              <SelectTrigger size="sm" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {PRIORITIES.map((option) => (
                  <SelectItem key={option.value} value={option.value}>
                    {option.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        {mode === "template" ? (
          <div className="space-y-2">
            <div className="space-y-1">
              <div className="flex items-center justify-between">
                <Label className="text-[10px] text-muted-foreground">
                  Template
                </Label>
                <Button
                  variant="ghost"
                  size="xs"
                  onClick={() => setShowNewTemplate((open) => !open)}
                >
                  <Plus /> New
                </Button>
              </div>
              <Select
                items={channelTemplates.map((t) => ({
                  value: t.id,
                  label: t.name,
                }))}
                value={templateId}
                onValueChange={(value) => setTemplateId(value as string)}
              >
                <SelectTrigger size="sm" className="w-full">
                  <SelectValue
                    placeholder={
                      channelTemplates.length === 0
                        ? "No templates for this channel"
                        : "Select a template"
                    }
                  />
                </SelectTrigger>
                <SelectContent>
                  {channelTemplates.map((template) => (
                    <SelectItem key={template.id} value={template.id}>
                      {template.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {selected && (
              <div className="space-y-1 rounded-md bg-muted/40 p-2">
                {selected.subjectTemplate && (
                  <p className="font-mono text-[10px] text-muted-foreground">
                    subject: {selected.subjectTemplate}
                  </p>
                )}
                <p className="font-mono text-[11px] leading-relaxed">
                  {selected.bodyTemplate}
                </p>
              </div>
            )}

            {needed.map((key) => (
              <div key={key} className="space-y-1">
                <Label className="font-mono text-[10px] text-muted-foreground">
                  {`{{${key}}}`}
                </Label>
                <Input
                  value={variables[key] ?? ""}
                  onChange={(event) =>
                    setVariables((current) => ({
                      ...current,
                      [key]: event.target.value,
                    }))
                  }
                  placeholder={`metadata.${key}`}
                  className="h-7 font-mono text-xs"
                />
              </div>
            ))}

            {showNewTemplate && (
              <NewTemplateForm
                channel={channel}
                onCreated={async (id) => {
                  await loadTemplates();
                  setTemplateId(id);
                  setShowNewTemplate(false);
                }}
              />
            )}
          </div>
        ) : (
          <div className="space-y-2">
            {channel === "EMAIL" && (
              <div className="space-y-1">
                <Label className="text-[10px] text-muted-foreground">
                  Subject
                </Label>
                <Input
                  value={subject}
                  onChange={(event) => setSubject(event.target.value)}
                  className="h-7 text-xs"
                />
              </div>
            )}
            <div className="space-y-1">
              <Label className="text-[10px] text-muted-foreground">Body</Label>
              <Textarea
                value={body}
                onChange={(event) => setBody(event.target.value)}
                rows={3}
                className="text-xs"
              />
            </div>
          </div>
        )}

        <div className="grid grid-cols-2 gap-2">
          <div className="space-y-1">
            <Label className="text-[10px] text-muted-foreground">
              Recipient
            </Label>
            <div className="flex gap-1">
              <Input
                value={recipient}
                onChange={(event) => setRecipient(event.target.value)}
                className="h-7 font-mono text-xs"
              />
              <Button
                variant="outline"
                size="icon-sm"
                title="Randomise"
                onClick={() => setRecipient(randomRecipient())}
              >
                <Dices />
              </Button>
            </div>
          </div>

          <div className="space-y-1">
            <Label className="text-[10px] text-muted-foreground">Schedule</Label>
            <Select
              items={SCHEDULES}
              value={delaySeconds}
              onValueChange={(value) => setDelaySeconds(value as string)}
            >
              <SelectTrigger size="sm" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {SCHEDULES.map((option) => (
                  <SelectItem key={option.value} value={option.value}>
                    {option.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
      </div>

      <Separator />

      <div className="flex gap-2 px-3">
        <Button onClick={send} disabled={sending} className="flex-1">
          {sending ? <Loader2 className="animate-spin" /> : <Send />}
          Send
        </Button>
        <Button
          variant="outline"
          onClick={() => burst(20)}
          disabled={sending}
          title="POST /notifications/batch with 20 random recipients"
        >
          <Zap /> Burst 20
        </Button>
      </div>

      <p className="px-3 text-[10px] leading-relaxed text-muted-foreground">
        Sending the same content to the same recipient twice within 24h returns
        the original notification — the idempotency key is a hash of recipient,
        channel, template, body and schedule.
      </p>
    </Card>
  );
}

function NewTemplateForm({
  channel,
  onCreated,
}: {
  channel: Channel;
  onCreated: (id: string) => void;
}) {
  const [name, setName] = useState("");
  const [subjectTemplate, setSubjectTemplate] = useState("");
  const [bodyTemplate, setBodyTemplate] = useState("Hi {{name}}, ");
  const [saving, setSaving] = useState(false);

  async function save() {
    setSaving(true);
    try {
      const { id } = await api.createTemplate({
        name,
        channel,
        bodyTemplate,
        // Subject lines are email-only; the API rejects them on SMS templates.
        ...(channel === "EMAIL" && subjectTemplate ? { subjectTemplate } : {}),
      });
      toast.success("Template created");
      onCreated(id);
    } catch (error) {
      toast.error("Could not create template", {
        description: error instanceof Error ? error.message : undefined,
      });
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-2 rounded-md bg-muted/40 p-2">
      <p className="text-[10px] text-muted-foreground">
        New {channel.toLowerCase()} template · use {`{{variables}}`}
      </p>
      <Input
        value={name}
        onChange={(event) => setName(event.target.value)}
        placeholder="order-shipped"
        className="h-7 font-mono text-xs"
      />
      {channel === "EMAIL" && (
        <Input
          value={subjectTemplate}
          onChange={(event) => setSubjectTemplate(event.target.value)}
          placeholder="Order {{orderId}} is on its way"
          className="h-7 font-mono text-xs"
        />
      )}
      <Textarea
        value={bodyTemplate}
        onChange={(event) => setBodyTemplate(event.target.value)}
        rows={2}
        className="font-mono text-xs"
      />
      <Button
        size="sm"
        variant="secondary"
        disabled={saving || !name || !bodyTemplate}
        onClick={save}
        className="w-full"
      >
        Create template
      </Button>
    </div>
  );
}
