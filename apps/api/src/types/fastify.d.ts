import '@fastify/jwt';
import 'fastify';

declare module '@fastify/jwt' {
  interface FastifyJWT { payload: { sub: string; role: 'SUPER_ADMIN' | 'ADMIN' | 'MERCHANT' }; user: { sub: string; role: 'SUPER_ADMIN' | 'ADMIN' | 'MERCHANT' }; }
}

declare module 'fastify' {
  interface FastifyInstance { authenticate: (request: FastifyRequest, reply: FastifyReply) => Promise<void>; }
}
