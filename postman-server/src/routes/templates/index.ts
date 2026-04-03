import { type FastifyPluginAsync } from 'fastify'

const templates: FastifyPluginAsync = async (fastify, opts): Promise<void> => {
  fastify.get('/', async function (request, reply) {
    return 'this is a small example'
  })
}

export default templates
