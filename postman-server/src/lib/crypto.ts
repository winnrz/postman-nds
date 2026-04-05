import { createHash } from "node:crypto";
import { CreateNotificationDto } from "../models/dtos/notifications";

function sha256Hex(utf8: string): string {
  return createHash("sha256").update(utf8, "utf8").digest("hex");
}

/**
 * Idempotency key: SHA-256 of
 * `recipient_id|channel|template_id|body_hash|scheduled_at`, where `body_hash` is
 * SHA-256 of the body text (empty string when omitted) and `scheduled_at` is
 * ISO 8601 or empty when not scheduled.
 */
function computeNotificationIdempotencyKey(
  body: CreateNotificationDto,
  scheduledAtIso: string,
): string {
  const templateId = body.templateId ?? "";
  const bodyHash = sha256Hex(body.body ?? "");
  const material = [
    body.recipientId,
    body.channel,
    templateId,
    bodyHash,
    scheduledAtIso,
  ].join("|");
  return sha256Hex(material);
}

export { computeNotificationIdempotencyKey };