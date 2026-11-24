# Status do projeto — 24/11/2026

## Entregue e validado

- Monorepo Next.js + Fastify + Prisma/PostgreSQL.
- Interfaces iniciais de superadmin e comerciante, checkout público e fluxo de autenticação.
- Cadastro/login com Argon2id e JWT; RBAC para rotas administrativas e escopo por comerciante.
- Criptografia AES-256-GCM de dados pessoais e segredos sensíveis.
- Chaves de API de comerciante com hash separado, segredo de assinatura criptografado, HMAC, timestamp e nonce anti-replay.
- Cadastro e revisão administrativa de carteiras USDT em Polygon/Tron, com status de verificação, seleção de carteira padrão e endereços mascarados nos painéis.
- Criação e simulação local de cobrança PIX; distribuição contábil modelada em 98%/2%, com duas pernas e ledger.
- Orquestração de liquidação com chaves idempotentes por perna, tentativas preservadas e tratamento conservador de resultados desconhecidos.
- Webhooks com assinatura validada sobre o corpo bruto, fingerprint SHA-256, rejeição de payload divergente sob o mesmo ID, claim atômico por lease, recuperação após expiração e fencing token para impedir que um worker antigo finalize a reserva de outro.
- Migração inicial do banco e migration incremental de leases; CI executa `prisma migrate deploy` em schema PostgreSQL vazio.
- `pnpm db:migrate` executa `prisma migrate deploy`; `pnpm db:migrate:dev` é reservado à criação de migrações durante desenvolvimento.
- Adaptadores Foxbit e TransFi explicitamente bloqueados para `sandbox/live` enquanto os contratos e a homologação não estiverem completos.

## Verificações confirmadas

- PR #4 (webhooks, fingerprint legado, leases e baseline de migrações) integrado no commit `d335c5d`. CI completo aprovado: https://github.com/mdossa07/pix-usdt-platform/actions/runs/45475202890
- PR #5 (bloqueio direto de adaptadores incompletos Foxbit/TransFi) integrado no commit `02042ef`. CI completo aprovado: https://github.com/mdossa07/pix-usdt-platform/actions/runs/45476093116
- A execução inclui install, geração Prisma, lint, testes unitários, migrations em schema vazio, cenários financeiros PostgreSQL, HMAC, webhooks e build.

## Limites atuais — não habilitar dinheiro real

- Nenhuma cobrança PIX real é emitida; os códigos existentes contêm `MOCK-PIX-NOT-PAYABLE`.
- Nenhuma conversão BRL→USDT real é executada.
- Nenhum payout on-chain é executado; os dois repasses 98%/2% ainda não foram homologados.
- O contrato TransFi v3 não está integrado de ponta a ponta: falta onboarding dinâmico de sender/recipient, consulta dos campos obrigatórios por corredor, descoberta do método PIX brasileiro, criação/consulta de payin e os dois payouts independentes.
- Foxbit depende de aprovação comercial e permissões específicas do Partner/Fiat Gateway, além de confirmação do caminho de saldo, sub-members, comissão e withdrawals.
- Os formulários atuais não capturam todos os campos dinâmicos de KYC/KYB, endereço, nascimento e Travel Rule que podem ser exigidos pelo provedor escolhido.
- Reconciliação e recuperação cobrem partes do fluxo, mas ainda não foram comprovadas com eventos e payouts reais do provedor.
- Ainda faltam validação completa de produção, observabilidade, alertas operacionais, runbooks, segurança externa e revisão jurídica/regulatória/fiscal.

## Próximos desbloqueios

1. Escolher o provedor primário e obter aprovação comercial por escrito para coleta PIX de terceiros, conversão BRL/USDT e dois payouts independentes por operação.
2. Receber credenciais sandbox, IDs de conta/MID, permissões de payout, webhook secrets, métodos/corredores disponíveis, limites e tabela de tarifas.
3. Implementar onboarding dinâmico de sender/recipient e persistência dos IDs do provedor, com KYC/KYB e Travel Rule.
4. Implementar payin PIX, conversão e dois payouts separados (com partner IDs idempotentes independentes), além de consulta de status, webhooks e reconciliação.
5. Homologar cenários de timeout, evento duplicado, payout parcialmente liquidado, falha terminal, reembolso e divergência de saldo.
6. Concluir testes visuais/funcionais dos painéis, checkout, logout, exportações e permissões.
7. Fazer revisão de segurança, jurídica, regulatória e fiscal; só então preparar implantação de produção e liberar operações reais.

## Política operacional

- Nunca configurar credenciais reais em repositório público ou em arquivos versionados.
- Nunca trocar para `sandbox/live` para contornar bloqueios do adaptador.
- Um pagamento só pode ser considerado finalizado após confirmação independente dos dois payouts, reconciliação do ledger e conferência do saldo do provedor.
