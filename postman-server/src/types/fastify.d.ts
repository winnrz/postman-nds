import { PrismaClient } from "../generated/prisma/client";

// Augments Fastify typings when the instance is decorated with a shared Prisma client (e.g. `fastify.decorate('prisma', …)`).
declare module "fastify" {
  interface FastifyInstance {
    prisma: PrismaClient;
  }
}