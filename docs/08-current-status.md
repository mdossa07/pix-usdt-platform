# Status do projeto PixSplit — 24/11/2026

## Progresso estimado

**71% concluído.** O percentual representa a entrega de software verificável. Não significa que o produto possa movimentar dinheiro real; a etapa financeira de produção continua bloqueada por homologação e credenciais externas.

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
- Obrigatoriedade de MFA para superadministradores integrada no PR #14: sem matrícula TOTP, o superadmin só acessa status/configuração/ativação; após ativação, toda rota administrativa exige sessão verificada por MFA. CI da branch aprovada; merge commit `5191d19`.
- O middleware revalida usuário ativo e papel atual no PostgreSQL em cada rota autenticada.
- Sessões de navegador persistidas em `AuthSession` no PostgreSQL, com JTI único, expiração, metadados limitados e revogação centralizada; JWTs sem sessão ativa são rejeitados em cada requisição autenticada.
- Logout revoga a sessão atual antes de limpar o cookie; o usuário pode listar até 25 sessões ativas, revogar uma sessão específica e encerrar todas as sessões. As operações são registradas na auditoria.
- O JWT tem validade de duas horas e a sessão no banco compartilha o mesmo prazo. JWTs anteriores à migração não possuem JTI persistido e deixam de ser aceitos após o rollout; exigir novo login.
- O layout do comerciante autentica usando a sessão HttpOnly em `/v1/me`; o marcador `pixsplit_authenticated` não é credencial e nenhum JWT novo é persistido em `localStorage`. JWT legado só é usado durante a transição.

### Webhooks de saída para comerciantes
- Até 10 endpoints HTTPS ativos por comerciante, com seleção de eventos, desativação, rotação de segredo e consulta de entregas.
- Segredos aleatórios fortes guardados cifrados e exibidos somente na criação/rotação.
- Eventos persistidos no mesmo commit PostgreSQL da criação ou atualização de pagamento, com despachante assíncrono e recuperação de entregas pendentes após reinício.
- Assinatura HMAC-SHA256 calculada sobre timestamp + corpo JSON bruto; payloads monetários usam strings/centavos inteiros e não incluem CPF, dados do pagador ou endereço completo de carteira.
- Proteção SSRF: HTTPS/443 obrigatório, DNS validado a cada tentativa, bloqueio de IPs privados/reservados e pinning de IP público, sem seguir redirects.
- Retentativas limitadas, timeout e resposta limitados; sem promessa de exactly-once. Consumidores devem deduplicar pelo ID do evento.
- Testes PostgreSQL cobrem subscriptions, payload sem PII e rollback transacional; CI de PR #16 e CI pós-merge passaram.
- Runbook operacional inicial em `docs/10-operations-runbook.md`: triagem, reconciliação, incidentes de webhook/conta, deploy/rollback e proposta de break-glass 2-de-3. O procedimento emergencial ainda precisa de aprovação formal, responsáveis nomeados e simulado.

### Observabilidade da API
- Endpoint Prometheus `GET /metrics` implementado e integrado: contador HTTP, histograma de latência, uptime e memória residente/heap do processo.
- Scrape protegido por `METRICS_BEARER_TOKEN` (32–256 caracteres ASCII visíveis); sem segredo o endpoint retorna 404, e credencial incorreta recebe 401.
- Labels usam somente método, template estático de rota e status HTTP; caminhos desconhecidos viram `unmatched`, sem IDs, query strings, CPF ou e-mail.
- Sem dependência adicional: métricas ficam em memória por processo. CI do PR #17 passou em lint, suíte unitária, integrações PostgreSQL, migrações e build; merge commit `a0197b1`.
- A API exporta métricas, mas Prometheus, scrape por réplica, firewall de rede, dashboards e regras de alerta ainda dependem de provisionamento no ambiente.

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
- PR #14 — MFA obrigatório em rotas de superadmin; merge commit `5191d19`.
- PR #15 — revogação centralizada de sessões de navegador; merge commit `e064947`; CI pós-merge aprovado.
- PR #16 — webhooks de saída seguros para comerciantes; merge commit `13889a7`; CI pós-merge #373 aprovado.
- PR #17 — métricas Prometheus protegidas por Bearer; merge commit `a0197b1`; CI pós-merge #392 aprovado.
- PR #18 — E2E real em Chromium e correção do guard legado do painel comerciante; merge commit `161aef8`; CI pós-merge #412 aprovado.

CI completo do PR #17 aprovado (lint, unitários, integrações PostgreSQL, migrações e build): https://github.com/mdossa07/pix-usdt-platform/actions/runs/45515013582
CI pós-merge do PR #18 aprovado, incluindo Chromium e integrações PostgreSQL: https://github.com/mdossa07/pix-usdt-platform/actions/runs/45518472158

O pipeline inclui instalação, Prisma, lint, testes unitários, migrações em schema vazio, cenários financeiros PostgreSQL, concorrência de idempotência, HMAC, webhooks, TOTP e build.

## Bloqueios — não habilitar dinheiro real

- Nenhuma cobrança PIX real é emitida.
- Nenhuma conversão BRL→USDT real é executada.
- Nenhum payout on-chain é executado; os dois repasses independentes (comerciante 98% e plataforma 2%) ainda não foram homologados.
- Ainda não há credenciais sandbox, MIDs, permissões, webhook secrets, corredores, limites ou tarifas aprovados para um provedor.
- TransFi v3 exige onboarding de sender/recipient, dados dinâmicos por país/tipo, confirmação do método PIX BRL habilitado para o MID e confirmação de que o modelo permite o cadastro do pagador final. Payin usa userId de sender; payout usa recipient/userId conforme a ordem.
- Foxbit Partner depende de permissões comerciais específicas. Fiat Gateway no nível do parceiro e funding de sub-member são fluxos distintos; a arquitetura de saldo e os dois withdrawals precisam de aprovação escrita.
- O cadastro atual de comerciante/carteira não completa todo o KYC/KYB dinâmico exigido pelos corredores e provedores.
- O processo multi-pessoa de break-glass está descrito como proposta, mas depende de aprovação formal, designação dos três responsáveis e simulado antes de produção.
- Faltam provisionamento do Prometheus e scrape por réplica, dashboards/regras de alertas, runbooks específicos de cada provedor/produção, pentest externo e revisão jurídica/regulatória/fiscal.
- O repositório GitHub continua público. Não inserir credenciais, MIDs, webhook secrets, certificados ou dados reais. O issue #13 registra a ação do proprietário para mudar a visibilidade para Private antes da homologação.

## Próximas etapas

1. Tornar o repositório Private e confirmar que nenhuma credencial ou dado real foi versionado.
2. Escolher o provedor principal e obter aprovação comercial escrita para o fluxo marketplace: payin PIX, saldo em USDT e dois payouts independentes.
3. Confirmar ownership legal do dinheiro, requisitos de sender/recipient, KYC/KYB, Travel Rule, método PIX BRL, redes, limites, tarifas e tratamento de saldo.
4. Conectar o cliente v3 ou o fluxo Foxbit Partner homologado ao motor de pagamentos; manter feature flags desabilitadas até sandbox aprovado.
5. Construir onboarding e checkout dinâmicos para os campos requeridos pelo provedor.
6. Homologar payin, conversão, merchant payout 98%, platform payout 2%, webhooks, retries, timeouts, falhas parciais, refunds e reconciliação.
7. Provisionar Prometheus por réplica, dashboards/alertas, runbooks específicos, formalizar e simular o processo multi-pessoa de break-glass, executar pentest externo e revisão jurídica/regulatória/fiscal.
8. Liberar produção somente após confirmação independente dos dois payouts, ledger balanceado e reconciliação do saldo do provedor.

## Política operacional

- Nunca ativar `sandbox/live` para contornar os bloqueios dos adaptadores.
- Nunca marcar uma cobrança como paga sem confirmação final do provedor.
- Um pagamento só está concluído quando payin confirmado, conversão reconciliada e os dois payouts confirmados individualmente.
- Uma falha ou timeout em uma perna não autoriza reenvio cego da outra.
- Segredos devem existir apenas no gerenciador de segredos do ambiente de execução.
