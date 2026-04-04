import { FastifyPluginAsync } from "fastify";

const createNotificationSchema = {
    // TODO: Define the schema for creating notifications based on models/dtos/notifications/notification.dto.ts. 

}

const listTemplatesSchema = {
    // TODO: Define the schema for listing notifications based on models/dtos/notifications/notification.dto.ts.
}


const root: FastifyPluginAsync = async (fastify): Promise<void> => {
  fastify.get("/", {}, async (request, reply) => {
    // TODO: Implement listing notifications, with pagination and filtering based on query parameters.

  });

  fastify.post<{}>("/", {schema: createNotificationSchema}, async (request, reply) => {
    // TODO: Implement creating a notification. Return notification Id and status.
  });
};

export default root;
