# Status do projeto PixSplit — 24/11/2026

## Progresso estimado

**68% concluído.** O percentual representa a entrega de software verificável. Não significa que o produto possa movimentar dinheiro real; a etapa financeira de produção continua bloqueada por homologação e credenciais externas.

## Entregue e integrado no master

### Plataforma e contas
- Monorepo Next.js + Fastify + Prisma/PostgreSQL.
- Painéis iniciais de superadmin e comerciante, checkout público, histórico, relatórios, carteira e conciliação.
- Cadastro/login com Argon2id, JWT, RBAC e escopo por comerciante.
- Dados sensíveis criptografados com AES-256-GCM.
- Cadastro e revisão administrativa de carteiras USDT em Polygon/Tron, com verificação, carteira padrão e endereços mascarados.
- Chaves de API de comerciante com hash de verificação separado, segredo HMAC criptografado, timestamp e nonce anti-replay.
- Sessões de navegador em cookie `HttpOnly`, com `Secure` e `SameSite=None` em produção. O JWT não é devolvido ao JavaScript nem guardado no `localStorage`.
- Proteção CSRF em mutações autenticadas por cookie, usando `Origin` da aplicação e `x-csrf-token` vinculado ao JWT assinado. Novas abas recuperam o token da sessão sem rotacioná-la.
- TOTP RFC 6238 e dez códigos de recuperação independentes, armazenados apenas como hashes; o login desafia o segundo fator quando ele está habilitado.
- O middleware revalida usuário ativo e papel atual no PostgreSQL em cada rota autenticada.
- O logout limpa o cookie de navegador. O JWT é stateless e tem validade de duas horas; ainda não há revogação individual centralizada por JTI/sessão.

### Pagamentos e segurança financeira
- Criação de pagamentos em modo de demonstração, com código explícito `MOCK-PIX-NOT-PAYABLE`.
- Motor de cálculo e ledger para split contábil 98%/2%, com pernas independentes de comerciante e plataforma.
- Idempotência transacional de cobrança: chave por comerciante/endpoint, hash canônico, resposta original persistida e evento de auditoria na mesma transação PostgreSQL.
- Requisições simultâneas com a mesma chave criam apenas uma cobrança; mesmo corpo recupera a resposta; corpo diferente recebe HTTP 409.
- Tentativas e transferências preservadas, tratamento de resultados desconhecidos e reconciliação conservadora. Não há retry cego de payout ambíguo.
- Webhooks de entrada com validação de assinatura sobre o corpo bruto, fingerprint SHA-256, detecção de payload divergente, claim atômico por lease, recuperação após expiração e fencing token.
- Migração inicial do banco e migrações incrementais testadas em schema PostgreSQL vazio.
- `pnpm db:migrate` usa `prisma migrate deploy`; `pnpm db:migrate:dev` é reservado à criação de migrações locais.

### Provedores
- Foxbit e TransFi permanecem bloqueados para `sandbox/live`; os adaptadores não podem ser ativados por instanciação direta.
- Cliente TransFi v3 tipado com Basic Auth + MID obrigatório, descoberta dinâmica de campos de sender/recipient, cadastro individual/empresa, descoberta de métodos de pagamento, criação/consulta/listagem de ordens, saldo e KYC/KYB.
- A criação de ordem TransFi usa `partnerId` no corpo, valida o posicionamento do valor em `source` ou `destination` e não faz retry automático de mutações financeiras.
- O cliente TransFi v3 é uma camada de API testada, mas ainda não está conectado ao adaptador ativo de pagamentos. O fluxo continua mock-only.

## PRs integrados e validação

- PR #4 — claims, fingerprint, recuperação de webhooks e baseline de migrações.
- PR #5 — bloqueio de adaptadores Foxbit/TransFi incompletos.
- PR #6 — CSV seguro, métricas financeiras exatas, logout e documentação.
- PR #7 — status de provedor restrito ao superadmin.
- PR #8 e #9 — idempotência da criação de cobrança ligada ao endpoint e dashboard.
- PR #10 — TOTP e códigos de recuperação.
- PR #11 — cookies HttpOnly e proteção CSRF do painel; merge commit `05ce453`.
- PR #12 — cliente TransFi v3 e testes de contrato; merge commit `88b77a7`.

CI completo aprovado no head do PR #12: https://github.com/mdossa07/pix-usdt-platform/actions/runs/45492613470

O pipeline inclui instalação, Prisma, lint, testes unitários, migrações em schema vazio, cenários financeiros PostgreSQL, concorrência de idempotência, HMAC, webhooks, TOTP e build.

## Bloqueios — não habilitar dinheiro real

- Nenhuma cobrança PIX real é emitida.
- Nenhuma conversão BRL→USDT real é executada.
- Nenhum payout on-chain é executado; os dois repasses independentes (comerciante 98% e plataforma 2%) ainda não foram homologados.
- Ainda não há credenciais sandbox, MIDs, permissões, webhook secrets, corredores, limites ou tarifas aprovados para um provedor.
- TransFi v3 exige onboarding de sender/recipient, dados dinâmicos por país/tipo, confirmação do método PIX BRL habilitado para o MID e confirmação de que o modelo permite o cadastro do pagador final. Payin usa userId de sender; payout usa recipient/userId conforme a ordem.
- Foxbit Partner depende de permissões comerciais específicas. Fiat Gateway no nível do parceiro e funding de sub-member são fluxos distintos; a arquitetura de saldo e os dois withdrawals precisam de aprovação escrita.
- O cadastro atual de comerciante/carteira não completa todo o KYC/KYB dinâmico exigido pelos corredores e provedores.
- Webhooks de saída seguros para sistemas dos comerciantes ainda não foram implementados.
- TOTP está disponível, mas ainda não é obrigatório para todos os superadministradores; também falta documentar um processo multi-pessoa de break-glass.
- Faltam revogação centralizada por sessão/JTI, teste E2E de navegador, observabilidade/alertas, runbooks, pentest externo e revisão jurídica/regulatória/fiscal.
- O repositório GitHub continua público. Não inserir credenciais, MIDs, webhook secrets, certificados ou dados reais. O issue #13 registra a ação do proprietário para mudar a visibilidade para Private antes da homologação.

## Próximas etapas

1. Tornar o repositório Private e confirmar que nenhuma credencial ou dado real foi versionado.
2. Escolher o provedor principal e obter aprovação comercial escrita para o fluxo marketplace: payin PIX, saldo em USDT e dois payouts independentes.
3. Confirmar ownership legal do dinheiro, requisitos de sender/recipient, KYC/KYB, Travel Rule, método PIX BRL, redes, limites, tarifas e tratamento de saldo.
4. Conectar o cliente v3 ou o fluxo Foxbit Partner homologado ao motor de pagamentos; manter feature flags desabilitadas até sandbox aprovado.
5. Construir onboarding e checkout dinâmicos para os campos requeridos pelo provedor.
6. Homologar payin, conversão, merchant payout 98%, platform payout 2%, webhooks, retries, timeouts, falhas parciais, refunds e reconciliação.
7. Implementar webhooks de saída seguros para comerciantes, com assinaturas, retries e proteção SSRF.
8. Tornar TOTP obrigatório para superadmins, implementar revogação centralizada de sessão/JTI e concluir E2E, observabilidade, runbooks, pentest e revisão jurídica/regulatória/fiscal.
9. Liberar produção somente após confirmação independente dos dois payouts, ledger balanceado e reconciliação do saldo do provedor.

## Política operacional

- Nunca ativar `sandbox/live` para contornar os bloqueios dos adaptadores.
- Nunca marcar uma cobrança como paga sem confirmação final do provedor.
- Um pagamento só está concluído quando payin confirmado, conversão reconciliada e os dois payouts confirmados individualmente.
- Uma falha ou timeout em uma perna não autoriza reenvio cego da outra.
- Segredos devem existir apenas no gerenciador de segredos do ambiente de execução.
