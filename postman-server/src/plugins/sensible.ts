import fp from 'fastify-plugin'
import sensible, { FastifySensibleOptions } from '@fastify/sensible'

// Adds httpErrors, assert, and related helpers for consistent HTTP error responses.
// https://github.com/fastify/fastify-sensible
export default fp<FastifySensibleOptions>(async (fastify) => {
  fastify.register(sensible)
})
