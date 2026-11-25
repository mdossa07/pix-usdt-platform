# Status do projeto PixSplit — 25/11/2026

## Progresso estimado

**74% concluído (entrega de software verificável).** A estimativa anterior era 73% em 25/11. O avanço reflete também a automação de varredura de segredos no histórico (Gitleaks), análise estática CodeQL para JavaScript/TypeScript e geração de credenciais temporárias mascaradas em cada execução do CI (PR #25). Este índice mede implementação de software; não mede homologação financeira ou autorização para dinheiro real.

Este percentual é uma estimativa de planejamento da implementação de software. **Não significa que o sistema esteja homologado, implantado em produção ou autorizado a movimentar dinheiro real.** A operação financeira continua bloqueada por aprovações, credenciais e validações externas.

## Entregue e integrado na branch master

### Plataforma e contas
- Monorepo pnpm com Next.js, React, Fastify, TypeScript, Prisma e PostgreSQL.
- Painéis iniciais de superadmin e comerciante, checkout público, operações, carteiras e relatórios.
- Cadastro/login com Argon2id, JWT, RBAC e escopo por comerciante.
- Dados sensíveis criptografados com AES-256-GCM.
- Cadastro e revisão administrativa de carteiras USDT em Polygon/Tron, com verificação, carteira padrão e endereços mascarados.
- Chaves de API de comerciante com hash de verificação separado, segredo HMAC criptografado, timestamp e nonce anti-replay.
- Sessões de navegador em cookie HttpOnly; JWT não é entregue ao JavaScript nem persistido em localStorage.
- Proteção CSRF em mutações autenticadas por cookie.
- TOTP RFC 6238, códigos de recuperação armazenados como hashes e MFA obrigatório para superadministradores.
- Workflow de segurança integrado: Gitleaks analisa o histórico Git completo; CodeQL executa análise `security-extended` em JavaScript/TypeScript.
- O CI gera JWT secret, chave PII, token Prometheus e senha Grafana aleatórios por execução e mascara os valores nos logs; não mantém esses segredos fixos no YAML.
- Sessões persistidas em PostgreSQL, revogação centralizada, logout e encerramento individual/global de sessões.
- O layout administrativo valida identidade em `/v1/me` via cookie HttpOnly, exige `SUPER_ADMIN` e encerra a sessão pelo endpoint de logout; PR #22 cobre login sem bearer token, acesso ao painel e revogação em Chromium.
- Middleware revalida usuário ativo e papel atual no PostgreSQL em rotas autenticadas.

### Pagamentos e ledger
- Criação de cobranças exclusivamente em modo mock, com identificador explícito MOCK-PIX-NOT-PAYABLE.
- Motor de cálculo e ledger do split contábil 98%/2%, com precisão inteira/BigInt e pernas independentes.
- Idempotência transacional: chave por comerciante/endpoint, hash canônico e resposta original persistida.
- Requisições concorrentes com a mesma chave não criam cobranças duplicadas; corpo divergente recebe HTTP 409.
- Tentativas e transferências preservadas, tratamento conservador de resultados desconhecidos e reconciliação; não há retry cego de payout ambíguo.
- Webhooks de entrada com assinatura sobre corpo bruto, fingerprint SHA-256, claim atômico por lease, recuperação e fencing token.
- Migrações PostgreSQL testadas em schema vazio; migrate deploy separado de migrate dev.

### Provedores e integração financeira
- Foxbit e TransFi continuam bloqueados para sandbox/live; adaptadores não podem ser ativados por instanciação direta.
- Cliente TransFi v3 tipado com Basic Auth + MID, onboarding individual/empresa, descoberta de campos e métodos, ordens, consulta de saldo e KYC/KYB, com testes de contrato.
- O cliente TransFi ainda não está conectado a um fluxo ativo de pagamentos.
- A aplicação não presume que o Fiat Gateway Foxbit partner-level financie automaticamente uma subconta. O desenho comercial/financeiro precisa de confirmação escrita do provedor.

### Webhooks de saída e SSRF
- Até 10 endpoints HTTPS ativos por comerciante, seleção de eventos, desativação, rotação de segredo e consulta de entregas.
- Segredos aleatórios armazenados cifrados e exibidos somente na criação/rotação.
- Outbox transacional PostgreSQL e despachante assíncrono com recuperação de entregas pendentes.
- Assinatura HMAC-SHA256 sobre timestamp + corpo bruto; payloads não expõem CPF, dados do pagador ou endereço completo de carteira.
- HTTPS/443 obrigatório, resolução DNS a cada tentativa, pinning do IP validado, bloqueio de destinos privados/reservados e rejeição de redirects.
- PR #19 acrescentou bloqueio explícito aos prefixos NAT64 well-known e local-use, com teste de regressão. Merge commit `3c94594`.

### Observabilidade e operação
- Endpoint Prometheus GET /metrics com contagem HTTP, latência, uptime e memória do processo.
- Scrape protegido por METRICS_BEARER_TOKEN; sem token o endpoint fica oculto e token incorreto recebe 401.
- Labels de baixa cardinalidade, sem IDs, query strings, CPF ou e-mail.
- PR #20 adicionou overlay Docker Compose local para Prometheus e Grafana, dashboard provisionado, regras iniciais de alerta e documentação operacional.
- CI valida configuração Prometheus, regras de alerta, dashboard, readiness de Prometheus/Grafana, scrape da API e provisionamento do dashboard.
- Runbook operacional inicial em docs/10-operations-runbook.md.

## PRs recentes e evidência de CI

- PR #16 — webhooks de saída seguros para comerciantes; integrado.
- PR #17 — métricas Prometheus protegidas por Bearer; integrado.
- PR #18 — E2E real em Chromium para autenticação, cookies HttpOnly, CSRF e revogação; integrado.
- PR #19 — bloqueio explícito de prefixos NAT64 no filtro SSRF; integrado em `3c94594`.
- PR #20 — stack Prometheus/Grafana, dashboard, alertas e smoke tests; integrado em `761d078`.
- PR #21 — status/roadmap atualizado após os marcos de observabilidade e SSRF; integrado em `b9e91c8`.
- PR #22 — guard administrativo HttpOnly, roteamento por papel e E2E Chromium de superadmin; integrado em `f6238f2`.
- PR #23 — reativação de endpoint e retry manual seguro de webhooks `FAILED`, preservando evento/payload; integrado em `f865f64`.

Evidências:
- [CI pós-merge do PR #20 — sucesso](https://github.com/mdossa07/pix-usdt-platform/actions/runs/45623673089).
- [CI do PR #19 — sucesso](https://github.com/mdossa07/pix-usdt-platform/actions/runs/45519035765).
- [CI pós-merge do PR #18 — sucesso](https://github.com/mdossa07/pix-usdt-platform/actions/runs/45518472158).
- [CI do PR #22 — push, sucesso](https://github.com/mdossa07/pix-usdt-platform/actions/runs/45625231839).
- [CI do PR #22 — pull request, sucesso](https://github.com/mdossa07/pix-usdt-platform/actions/runs/45625264032).
- [CI pós-merge do PR #23 — sucesso](https://github.com/mdossa07/pix-usdt-platform/actions/runs/45625664517).

O CI executa instalação, geração Prisma, lint/typecheck, testes unitários, integrações PostgreSQL, migrações em schema vazio, testes financeiros, idempotência, HMAC, webhooks, MFA, sessões, build, smoke tests de observabilidade e E2E Chromium para comerciante e superadministrador.

## Bloqueios — não habilitar dinheiro real

- **Nenhuma cobrança PIX real, conversão BRL→USDT ou retirada on-chain está habilitada.** A aplicação permanece mock-only.
- Não há credenciais sandbox, MID, permissões, webhook secrets, corredores, limites ou tarifas aprovados para um provedor.
- Ainda falta aprovação comercial escrita para o modelo marketplace: payin PIX de terceiros, atribuição de saldo, conversão e dois payouts independentes (98% merchant / 2% plataforma).
- TransFi exige confirmação do método PIX BRL habilitado para o MID, onboarding dinâmico de sender/recipient, dados por país/tipo e autorização do modelo com pagador final.
- Foxbit Partner exige confirmação específica sobre Fiat Gateway, funding de sub-member, conversão, transferências internas e withdrawals.
- O onboarding atual não cobre todos os campos dinâmicos KYC/KYB e Travel Rule exigidos pelos corredores.
- Falta homologar cenários de estorno/devolução PIX, chargeback, falha parcial entre pernas, timeout, webhook perdido, duplicidade e reconciliação real.
- A stack Prometheus/Grafana está provisionada como overlay local e validada no CI; ainda faltam implantação no ambiente real, scrape de todas as réplicas, firewall/rede e canal de notificação (Alertmanager/receiver).
- O runbook de break-glass 2-de-3 é uma proposta: faltam aprovação formal, responsáveis nomeados e simulado.
- Faltam pentest externo e revisão jurídica, regulatória, fiscal e de LGPD.
- **O repositório GitHub continua público** e a branch master está sem proteção obrigatória. O issue #13 registra a ação do proprietário para torná-lo Private antes de adicionar credenciais. Não colocar segredos, MIDs, certificados ou dados reais no repositório.

## Próximas etapas, em ordem

1. Tornar o repositório Private, verificar o histórico por segredos e ativar proteção de branch com CI obrigatório.
2. Escolher o provedor principal e obter aprovação comercial escrita do fluxo completo.
3. Confirmar titularidade/ownership dos fundos, obrigações de KYC/KYB, Travel Rule, método PIX BRL, redes, limites, taxas, prazos e reembolsos.
4. Receber acesso sandbox, MIDs e contratos técnicos; implementar o adapter homologado mantendo feature flags desativadas.
5. Completar onboarding e checkout dinâmicos para os requisitos do provedor.
6. Homologar payin, conversão, os dois payouts, webhooks, retentativas, falhas parciais, estornos e reconciliação.
7. Provisionar ambiente de produção, segredos, observabilidade por réplica, alertas/notificações, runbooks e processo break-glass; executar pentest e revisões independentes.
8. Só liberar produção depois da aprovação formal, confirmação individual dos dois payouts, ledger balanceado e reconciliação do saldo do provedor.

## Política operacional obrigatória

- Nunca ativar sandbox/live para contornar os bloqueios dos adaptadores.
- Nunca marcar cobrança como paga sem confirmação final do provedor.
- Pagamento só é concluído depois de payin confirmado, conversão reconciliada e os dois payouts confirmados individualmente.
- Falha ou timeout em uma perna não autoriza reenvio cego da outra.
- Segredos só podem existir no secret manager do ambiente de execução.


## Entrega validada — retry manual de webhooks — 25/11/2026

- PR #23 integrado em `master`, merge commit `f865f64`; CI pós-merge #438 aprovado.
- Comerciante pode reabilitar endpoint próprio e solicitar retry apenas de uma entrega `FAILED`.
- Retry reabre a mesma linha PostgreSQL do outbox, preservando `eventId` e payload original; não cria um novo evento financeiro.
- Operação usa compare-and-set, valida propriedade do comerciante/endpoint, exige endpoint habilitado, aplica rate limit e grava auditoria.
- Tentativas repetidas em `PENDING`, `PROCESSING` ou `DELIVERED` são recusadas; consumidores continuam deduplicando pelo mesmo `X-PixSplit-Event-Id`.
- Testes PostgreSQL cobrem preservação do evento/payload, reenvio duplicado, endpoint desativado e isolamento entre comerciantes.

**Progresso global estimado: 74%.**

O produto permanece em modo mock. O retry de webhook não habilita pagamentos reais. Permanecem bloqueios de autorização/contratos e credenciais de provedores, implantação de produção, Alertmanager/receivers, pentest externo e revisão jurídica/regulatória/fiscal.


## Entrega validada — autenticação administrativa e retry de webhooks — 25/11/2026

- PR #22: login de superadministrador pelo cookie HttpOnly; o servidor confirma a identidade em `/v1/me`, valida o papel `SUPER_ADMIN` e revoga sessão no logout. E2E Chromium confirmou ausência de bearer token no `localStorage` e rejeição da sessão antiga após logout.
- PR #23: comerciante pode reativar o próprio endpoint e reenfileirar apenas entregas `FAILED`; mantém o mesmo `eventId` e payload, valida ownership, usa compare-and-set, limita tentativas e grava auditoria.
- Ambos os recursos estão integrados em `master`; CI de PR #22 e pós-merge de PR #23 aprovados.

**Progresso global estimado: 74%.** O sistema permanece em modo mock; nenhum PIX real, conversão ou payout on-chain foi habilitado.


## Entrega validada — segurança automatizada do repositório — 25/11/2026

- PR #25 integrado em `master` no commit `60079e7`.
- Gitleaks executou a varredura do histórico Git completo; primeira execução do workflow terminou com sucesso.
- CodeQL executou análise `security-extended` para JavaScript/TypeScript; workflow terminou com sucesso.
- CI deixou de usar credenciais de teste fixas no YAML: gera valores criptograficamente aleatórios para JWT, chave de criptografia PII, token Prometheus e senha Grafana em cada execução, com mascaramento no log.
- Isso automatiza detecção e reduz exposição de valores estáticos no CI, mas não substitui tornar o repositório privado, proteger `master`, revisar alertas e manter segredos reais em secret manager.
