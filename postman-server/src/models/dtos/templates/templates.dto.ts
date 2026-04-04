import { NotificationChannel } from "../../enums";

// Payload for creating a row in `templates` (version defaults to 1 in the route if omitted).
export interface CreateTemplateDto {
  name: string;
  channel: NotificationChannel;
  subjectTemplate?: string;
  bodyTemplate: string;
}
