import { NotificationChannel } from "./generated/prisma/client";
import { prisma } from "./plugins/prisma";

/**
 * Seeds the single template the demo sends from. Templates are not user-created
 * — `POST /templates` is admin-gated — so this is the only way one gets in.
 *
 * Runs on every deploy as part of the pre-deploy command, so it upserts against
 * the `@@unique([name, channel])` constraint rather than inserting.
 */

// SMS deliberately: the channel is capped at 20/min while the dashboard bursts
// 25, so the overflow visibly parks in RATE_LIMITED and drains on the next
// refill. An EMAIL template (100/min) would never trip the limiter.
const TEMPLATE = {
  name: "Order shipped",
  channel: NotificationChannel.SMS,
  subjectTemplate: null,
  // `{{recipientId}}` is always supplied by the service, so no `metadata` is
  // needed on the request — which is what lets the client stay a bare button.
  bodyTemplate:
    "Order for {{recipientId}} has shipped and is out for delivery. Reply STOP to opt out.",
  isActive: true,
};

async function main(): Promise<void> {
  const template = await prisma.templates.upsert({
    where: {
      name_channel: { name: TEMPLATE.name, channel: TEMPLATE.channel },
    },
    update: {
      bodyTemplate: TEMPLATE.bodyTemplate,
      subjectTemplate: TEMPLATE.subjectTemplate,
      isActive: TEMPLATE.isActive,
    },
    create: TEMPLATE,
  });

  // eslint-disable-next-line no-console
  console.info(`[seed] template ready: ${template.name} (${template.id})`);
}

main()
  .catch((error) => {
    // eslint-disable-next-line no-console
    console.error("[seed] failed", error);
    process.exit(1);
  })
  .finally(() => {
    void prisma.$disconnect();
  });
