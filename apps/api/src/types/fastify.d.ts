import '@fastify/jwt';
import 'fastify';

declare module '@fastify/jwt' {
  interface FastifyJWT { payload: { sub: string; role: 'SUPER_ADMIN' | 'ADMIN' | 'MERCHANT'; purpose?: string }; user: { sub: string; role: 'SUPER_ADMIN' | 'ADMIN' | 'MERCHANT'; purpose?: string }; }
}

declare module 'fastify' {
  interface FastifyInstance { authenticate: (request: FastifyRequest, reply: FastifyReply) => Promise<void>; }
}
