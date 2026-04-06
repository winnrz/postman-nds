import { FastifyPluginAsync } from "fastify";



const root: FastifyPluginAsync = async (fastify): Promise<void> => {
  fastify.get("/", async (request, reply) => {
    return { status: "ok" };
  });

};

export default root;
