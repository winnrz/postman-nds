import { FastifyPluginAsync } from "fastify";
import { NotificationChannel } from "../../models/enums";

import { CreateTemplateDto } from "../../models/dtos/templates";
import { prisma } from "../../plugins/prisma";


// Schemas stay the same
const createTemplateSchema = {
  body: {
    type: "object",
    required: ["key", "name", "channel", "bodyTemplate"],
    properties: {
      key: { type: "string", minLength: 1, maxLength: 128 },
      name: { type: "string", minLength: 1, maxLength: 255 },
      version: { type: "integer", minimum: 1 },
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
  // GET /
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

  // POST /
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

      // Validation
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
