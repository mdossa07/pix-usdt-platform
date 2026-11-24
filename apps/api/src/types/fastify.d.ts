import '@fastify/jwt';
import 'fastify';

declare module '@fastify/jwt' {
  interface FastifyJWT { payload: { sub: string; role: 'SUPER_ADMIN' | 'ADMIN' | 'MERCHANT'; purpose?: string; csrfToken?: string; twoFactorVerified?: boolean }; user: { sub: string; role: 'SUPER_ADMIN' | 'ADMIN' | 'MERCHANT'; purpose?: string; csrfToken?: string; twoFactorVerified?: boolean }; }
}

declare module 'fastify' {
  interface FastifyInstance { authenticate: (request: FastifyRequest, reply: FastifyReply) => Promise<void>; }
}
