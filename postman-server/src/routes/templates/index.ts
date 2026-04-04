import { FastifyPluginAsync } from "fastify";
import { NotificationChannel } from "../../models/enums";

import { CreateTemplateDto } from "../../models/dtos/templates";
import { prisma } from "../../plugins/prisma";

// Fastify JSON Schema: validates bodies, shapes serialized responses, and can feed OpenAPI.
const createTemplateSchema = {
  body: {
    type: "object",
    required: ["key", "name", "channel", "bodyTemplate"],
    properties: {
      key: { type: "string", minLength: 1, maxLength: 128 },
      name: { type: "string", minLength: 1, maxLength: 255 },
      version: { type: "integer", minimum: 1 },
      // Same values as Prisma `NotificationChannel` so the HTTP API and DB stay aligned.
      channel: { type: "string", enum: Object.values(NotificationChannel) },
      subjectTemplate: { type: "string" },
      bodyTemplate: { type: "string", minLength: 1 },
      isActive: { type: "boolean" },
    },
    additionalProperties: false,
  },
  response: {
    201: {
      type: "object",
      properties: {
        id: { type: "string" },
        status: { type: "string" },
      },
    },
  },
};

const listTemplatesSchema = {
  response: {
    200: {
      type: "array",
      items: {
        type: "object",
        properties: {
          id: { type: "string" },
          key: { type: "string" },
          name: { type: "string" },
          channel: { type: "string" },
          subjectTemplate: { type: ["string", "null"] },
          bodyTemplate: { type: "string" },
          version: { type: "integer" },
          isActive: { type: "boolean" },
          createdAt: { type: "string" },
          updatedAt: { type: "string" },
        },
      },
    },
  },
};

const root: FastifyPluginAsync = async (fastify): Promise<void> => {
  fastify.get("/", { schema: listTemplatesSchema }, async (request, reply) => {
    const templates = await prisma.templates.findMany({
      orderBy: {
        createdAt: "asc",
      },
      select: {
        id: true,
        key: true,
        name: true,
        channel: true,
        subjectTemplate: true,
        bodyTemplate: true,
        version: true,
        isActive: true,
        createdAt: true,
        updatedAt: true,
      },
    });

    return reply.send(templates);
  });

  fastify.post<{ Body: CreateTemplateDto }>(
    "/",
    { schema: createTemplateSchema },
    async (request, reply) => {
      const {
        key,
        name,
        channel,
        subjectTemplate = null,
        bodyTemplate,
        version = 1,
        isActive = true,
      } = request.body;

      // Cross-field rule: subject lines only apply to email templates (JSON Schema cannot express this alone).
      if (subjectTemplate && channel !== NotificationChannel.EMAIL) {
        return reply.code(422).send({
          error: "Validation failed",
          field: "subjectTemplate",
          message: "subjectTemplate is only valid for the email channel",
        });
      }

      const template = await prisma.templates.create({
        data: {
          key,
          name,
          channel,
          subjectTemplate,
          bodyTemplate,
          version,
          isActive,
        },
        select: {
          id: true,
        },
      });

      return reply.code(201).send({
        id: template.id,
        status: "CREATED",
      });
    },
  );
};

export default root;
