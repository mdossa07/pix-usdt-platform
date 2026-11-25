# 06 — Roadmap de entrega PixSplit

Atualizado em 25/11/2026. Consulte também `docs/08-current-status.md` para o status detalhado e os bloqueios de produção.

## 0.2.x — Fundação SaaS e protótipo verificável

- [x] Monorepo pnpm com Next.js, Fastify, Prisma e PostgreSQL.
- [x] Painéis iniciais de superadmin e comerciante, checkout público, operações, carteiras e relatórios.
- [x] Cadastro/login com Argon2id, RBAC e escopo por comerciante.
- [x] Criptografia AES-256-GCM para dados sensíveis e cadastro/revisão de carteiras USDT.
- [x] Sessões HttpOnly, proteção CSRF, revogação de sessão e MFA TOTP obrigatório para superadmin.
- [x] Chaves API merchant com HMAC, nonce e proteção anti-replay.
- [x] Cobrança mock não pagável e liquidação simulada, split contábil 98%/2% e ledger com precisão inteira.
- [x] Idempotência transacional de cobranças e tratamento conservador de payout ambíguo.
- [x] Webhooks de entrada assinados e com claim/lease/fencing.
- [x] Webhooks de saída via outbox transacional, assinatura HMAC, retries limitados e proteção SSRF.
- [x] Bloqueio de IPv4/IPv6 privados e reservados, incluindo NAT64 well-known/local-use (PR #19).
- [x] Cliente TransFi v3 tipado e testes de contrato; não habilitado como adaptador de pagamentos.
- [x] Métricas Prometheus protegidas por Bearer.
- [x] Overlay local Prometheus + Grafana, dashboard provisionado, alertas iniciais e smoke tests no CI (PR #20).
- [x] CI com lint/typecheck, unitários, integrações PostgreSQL, migrações, build e E2E Chromium de comerciante e superadministrador.
- [x] Guard do painel superadmin por cookie HttpOnly, validação server-side do papel e logout com revogação (PR #22).
- [x] Retry manual de entregas de webhook `FAILED`, com ownership, compare-and-set, rate limit, auditoria e preservação do evento/payload (PR #23).
- [x] Gitleaks com varredura de histórico e CodeQL `security-extended` para JavaScript/TypeScript (PR #25).
- [x] Segredos temporários e mascarados gerados a cada execução do CI, sem valores fixos no workflow (PR #25).
- [x] Dependências JWT/Prisma corrigidas, lockfile congelado e `pnpm audit --audit-level moderate` obrigatório e aprovado (PR #28).
- [x] Dependabot semanal para npm (monorepo), GitHub Actions e Docker Compose (PR #28).
- [x] Atualização de Argon2 para `0.45.2` (PR #36).
- [x] Limite de dez endpoints webhook ativos por comerciante aplicado atomicamente na criação e reativação, com tratamento de conflitos SERIALIZABLE e testes concorrentes PostgreSQL (PR #37).
- [x] Prometheus atualizado para `v3.16.0` e Grafana para `13.3.1`, com smoke tests de scrape/provisioning (PRs #29 e #31).
- [x] GitHub Actions `checkout` e `setup-node` atualizadas para `v7`; `pnpm/action-setup` atualizado para `v6` (PRs #32, #33 e #38).
- [x] Workflow Dependency Review preparado; sua ativação automática aguarda o proprietário habilitar Dependency Graph nas configurações do GitHub (PR #28).
- [x] Runbook operacional inicial.

## Próxima etapa — Governança e preparação de homologação

- [ ] Tornar o repositório Private e revisar o histórico em busca de segredos/dados reais.
- [ ] Ativar proteção de branch e exigir CI aprovado antes de merge.
- [ ] Habilitar Dependency Graph no GitHub e mudar `.github/workflows/dependency-review.yml` de `workflow_dispatch` para `pull_request`.
- [x] Preparação PostgreSQL 16→18: runbook de backup/restore/cutover/rollback, sidecar 18 em volume separado e ensaio lógico automatizado em CI com clusters descartáveis (PR #40).
- [ ] Planejar e aprovar o cutover dos dados reais para PostgreSQL 18: snapshot e backup verificados, compatibilidade de extensões/roles, restauração ensaiada com os dados do ambiente, janela de manutenção e rollback; só então atualizar o serviço principal (PR #30).
- [ ] Definir o provedor principal (Foxbit ou TransFi) e obter aprovação comercial escrita para o modelo marketplace.
- [ ] Confirmar por escrito o payin PIX de terceiros, funding/ownership de saldo, conversão BRL→USDT e os dois payouts independentes.
- [ ] Receber sandbox, MIDs, permissões, webhooks e limites/tarifas documentados.
- [ ] Fechar fluxo de KYC/KYB dinâmico, beneficiários, Travel Rule e redes aceitas.
- [ ] Obter validação jurídica, regulatória, fiscal e de LGPD antes de operar valores reais.

## Próxima etapa — Integração financeira homologada (somente após aprovação)

- [ ] Implementar adapter do provedor principal a partir de contratos e schemas oficiais confirmados.
- [ ] Conectar onboarding de sender/recipient e descoberta de requisitos por país/tipo.
- [ ] Conectar cobrança PIX e confirmação final do payin.
- [ ] Conectar cotação/conversão e conciliação do valor líquido.
- [ ] Implementar payout merchant 98% e payout da plataforma 2% como pernas independentes.
- [ ] Implementar estados, retentativas seguras, timeouts, fila, idempotência e recuperação manual para cada perna.
- [ ] Homologar devolução PIX, chargeback, reembolso, falha parcial, webhook perdido/duplicado e reconciliação.
- [ ] Manter sandbox/live travado até aprovação independente de todos os cenários.

## Próxima etapa — Operação e produção

- [ ] Provisionar serviços, banco, Redis, domínios, TLS e secret manager em ambiente controlado.
- [ ] Migrar o overlay Prometheus/Grafana para ambiente real, com scrape de todas as réplicas.
- [ ] Configurar Alertmanager/receiver e validar notificações.
- [ ] Aplicar firewall/rede privada e controle de acesso operacional.
- [ ] Formalizar responsáveis e simular break-glass 2-de-3.
- [ ] Executar pentest externo, revisão de código e revisão de segurança independente.
- [ ] Fazer teste de carga, backups, restauração e disaster recovery.
- [ ] Fazer piloto controlado com limites aprovados e monitoramento.
- [ ] Liberar produção apenas depois de confirmar os dois payouts, ledger balanceado e saldo reconciliado.

## Critério de conclusão — 100%

O projeto só será considerado 100% concluído quando:
1. Aplicação e APIs estiverem implantadas, monitoradas e operacionais.
2. Provedor tiver aprovado por escrito o modelo e o fluxo completo.
3. Sandbox comprovar payin, conversão, dois payouts e todos os casos de falha/reconciliação.
4. Compliance, KYC/KYB, Travel Rule, jurídico/regulatório/fiscal e LGPD estiverem validados.
5. Pentest, backups, recuperação, incidentes e operação break-glass estiverem aprovados.
6. Produção real tiver sido liberada explicitamente e passar pelos critérios de segurança e reconciliação.

**Importante:** uma interface pronta ou CI verde não equivale à homologação financeira. Até o cumprimento dos gates acima, `PAYMENTS_MODE` permanece `mock`.
