# Status do projeto — 23/11/2026

## Entregue nesta iteração

- Monorepo Next.js + Fastify + Prisma/PostgreSQL.
- Interface inicial de merchant e superadmin, com navegação, dashboard, operações, carteira, API e relatórios.
- Cadastro e login com Argon2id e JWT.
- Dados sensíveis de merchant/carteira criptografados com AES-256-GCM.
- Cadastro de destino USDT em Polygon/Tron com exchange/VASP, titular, CPF/CNPJ e país da entidade VASP.
- Cadastro da carteira de comissão da plataforma por rede, exclusivo do superadmin.
- Criação de pagamentos mock e simulação local 98%/2%.
- Ledger de dupla entrada, transfer legs por beneficiário, idempotency model, audit log e tabela de webhooks.
- Transporte REST Foxbit com assinatura HMAC conforme a documentação geral e validação de assinatura de webhook V2.
- Documentação do fluxo e dos pontos específicos que a Foxbit precisa habilitar.

## Limites da versão

- Nenhuma cobrança PIX real é emitida; a resposta contém `MOCK-PIX-NOT-PAYABLE`.
- Nenhuma conversão USDT real é executada.
- Nenhum saque on-chain é executado.
- O adapter financeiro Foxbit ainda não tem métodos de negócio implementados: não foram inventados endpoints para funding/split.
- O webhook Foxbit é validado e armazenado, mas não altera saldo/pagamento até o mapeamento de eventos ser homologado.
- Cadastro de API keys, outgoing webhooks, gestão completa de KYC/KYB, filas BullMQ e painel de Compliance estão no roadmap.
- Deploy e produção estão bloqueados deliberadamente.

## Verificações executadas no ambiente de desenvolvimento desta entrega

- Testes da matemática 98%/2% com `BigInt`: aprovados.
- Parsing/sintaxe de 16 arquivos TypeScript/TSX: aprovado.
- Validação de JSON nos `package.json`: aprovada.
- Integridade do ZIP: aprovada.
- Build completo, Prisma validate/migrate e E2E: pendentes, pois as dependências do monorepo ainda não foram instaladas neste ambiente.

## Próximos desbloqueios

1. Foxbit aprovar por escrito o arranjo multiusuário e o método exato de PIX para creditar cada merchant/sub-member.
2. Foxbit confirmar funding BRL da subconta, compra BRL→USDT, transferência interna 2% e duas saídas para carteiras externas.
3. Receber sandbox, API keys, permissões, webhook secret, limites, preços e redes habilitadas.
4. Implementar e testar o adapter de produção com os schemas oficiais fornecidos/homologados.
5. Revisão jurídica, regulatória, fiscal e de segurança antes de movimentar dinheiro real.
