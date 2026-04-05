import { FastifyPluginAsync } from "fastify";
import { NotificationChannel } from "../../models/enums";

import { CreateTemplateDto } from "../../models/dtos/templates";
import { prisma } from "../../plugins/prisma";
import { isUniqueConstraintError } from "../../lib";

// Fastify JSON Schema: validates bodies, shapes serialized responses.
const createTemplateSchema = {
  body: {
    type: "object",
    required: ["name", "channel", "bodyTemplate"],
    properties: {
      name: { type: "string", minLength: 1, maxLength: 255 },
      channel: { type: "string", enum: Object.values(NotificationChannel) },
      subjectTemplate: { type: "string" },
      bodyTemplate: { type: "string", minLength: 1 },
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
      where: { isActive: true },
      select: {
        id: true,
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

    return reply.send(
      templates.map((t) => ({
        ...t,
        createdAt: t.createdAt.toISOString(),
        updatedAt: t.updatedAt.toISOString(),
      })),
    );
  });

  fastify.post<{ Body: CreateTemplateDto }>(
    "/",
    { schema: createTemplateSchema },
    async (request, reply) => {
      const {
        name,
        channel,
        subjectTemplate = null,
        bodyTemplate,
      } = request.body;

      // Cross-field rule: subject lines only apply to email templates.
      if (subjectTemplate && channel !== NotificationChannel.EMAIL) {
        return reply.code(422).send({
          error: "Validation failed",
          field: "subjectTemplate",
          message: "subjectTemplate is only valid for the email channel",
        });
      }

      try {
        const template = await prisma.templates.create({
          data: {
            name,
            channel,
            subjectTemplate,
            bodyTemplate,
          },
          select: {
            id: true,
          },
        });
        return reply.code(201).send({ id: template.id });
      } catch (err) {
        if (isUniqueConstraintError(err)) {
          return reply.code(422).send({
            error: "Validation failed",
            message: `A ${channel} template named "${name}" already exists`,
          });
        }
        throw err;
      }
    },
  );
};

export default root;
