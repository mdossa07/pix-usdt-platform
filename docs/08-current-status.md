# Status do projeto PixSplit — 25/11/2026

## Progresso estimado

**90% concluído (entrega de software verificável).** A estimativa anterior era 89% em 25/11. A PR #63 reforçou a configuração de produção: `APP_URL` (origem pública do painel) e `NEXT_PUBLIC_API_URL` (API acessada pelo navegador) precisam usar HTTPS; backend e frontend rejeitam configurações HTTP/inválidas antes da operação. O CI usa um endereço HTTPS reservado apenas durante o build de produção, sem relaxar a validação de runtime. A PR #63 foi integrada em `80276dbc`; CI de push e pull request passaram em 47/47 etapas, com Gitleaks e CodeQL aprovados. A PR #64 também protege os metadados livres de cadastro de carteira na trilha administrativa; PR #62 cobre `no-store` em toda a API versionada. Este índice mede implementação de software; não significa que a base real tenha sido migrada, que o fluxo financeiro esteja autorizado ou que o sistema esteja pronto para dinheiro real.

Este percentual é uma estimativa de planejamento da implementação de software. **Não significa que o sistema esteja homologado, implantado em produção ou autorizado a movimentar dinheiro real.** A operação financeira continua bloqueada por aprovações, credenciais e validações externas.

## Entregue e integrado na branch master

### Plataforma e contas
- Origens públicas seguras em produção: `APP_URL` e `NEXT_PUBLIC_API_URL` exigem HTTPS, sem credenciais, query string ou fragmento; backend falha no startup e frontend falha no build/runtime quando a configuração não atende ao contrato. HTTP permanece permitido em desenvolvimento/teste. O CI injeta `https://api.pixsplit.invalid` somente na etapa de build de produção; deploys reais precisam fornecer a origem HTTPS efetiva (PR #63, integrada em `80276dbc`; CI push e pull request 47/47, Gitleaks e CodeQL aprovados).
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
- Instalação CI exige `pnpm install --frozen-lockfile`; o gate `pnpm audit --audit-level moderate` bloqueia vulnerabilidades moderadas, altas e críticas.
- PR #28 atualiza `@fastify/jwt` para 10.2.9 e fixa `fast-jwt` 6.3.7, `deepmerge-ts` 8.0.0 e `effect` 3.22.1; lockfile gerado pelo pnpm e instalação congelada validada.
- Dependabot semanal acompanha manifests npm nas três áreas do monorepo, GitHub Actions e imagens Docker Compose. A ação Dependency Review está preparada em execução manual; a ativação automática em PR depende do Dependency Graph ser habilitado nas configurações do repositório.
- Sessões persistidas em PostgreSQL, revogação centralizada, logout e encerramento individual/global de sessões.
- O layout administrativo valida identidade em `/v1/me` via cookie HttpOnly, exige `SUPER_ADMIN` e encerra a sessão pelo endpoint de logout; PR #22 cobre login sem bearer token, acesso ao painel e revogação em Chromium.
- Middleware revalida usuário ativo e papel atual no PostgreSQL em rotas autenticadas.

### Pagamentos e ledger
- Criação de cobranças exclusivamente em modo mock, com identificador explícito MOCK-PIX-NOT-PAYABLE.
- Motor de cálculo e ledger do split contábil 98%/2%, com precisão inteira/BigInt e pernas independentes.
- Idempotência transacional: chave por comerciante/endpoint, hash canônico e resposta original persistida.
- Requisições concorrentes com a mesma chave não criam cobranças duplicadas; corpo divergente recebe HTTP 409.
- Tentativas e transferências preservadas, tratamento conservador de resultados desconhecidos e reconciliação; não há retry cego de payout ambíguo.
- Reconciliação distribuída entre réplicas Fastify via advisory lock transacional PostgreSQL, com lote máximo de 25 pagamentos, liberação automática do lock em commit/rollback e enfileiramento paralelo; PR #47 integrada em `cceb16e`. Teste E2E com dois clientes Prisma independentes confirmou a contenção e a liberação do lock em PostgreSQL real (PR #49, integrada em `0fd1fd7`).
- Criação de cobranças HMAC de comerciantes protegida por idempotência persistente: `externalId` reservado antes do efeito externo, fingerprint HMAC com chave derivada da chave PII, rejeição de payload divergente, replay da resposta original, recuperação da janela de crash e recuperação concorrente. Resultados ambíguos continuam fail-closed e exigem reconciliação manual. PR #52 integrada em `0fef2ef`; CI 45/45, Gitleaks e CodeQL aprovados.
- Fila administrativa para reservas HMAC antigas sem resposta persistida: grava somente merchantId, valor e walletDestinationId (sem PII do pagador), lista apenas registros com mais de 2 minutos, enriquece comerciante, permite documentar revisão e grava audit event. A revisão não libera nem apaga a reserva. PR #54 integrada em `6cd1d63`; CI push e PR 47/47, Gitleaks 5/5 e CodeQL 8/8.
- Justiça da fila administrativa: a consulta exibe apenas reservas ainda não revisadas (`lastReviewedAt IS NULL`); a primeira revisão as retira da fila de trabalho sem liberar a idempotência. A atualização usa compare-and-set para impedir sobrescrever a primeira revisão; nota e ator permanecem em auditoria. PR #56 integrada em `a7d8a48`; CI 47/47, Gitleaks 5/5 e CodeQL 8/8.
- Proteção de dados das revisões administrativas: o backend rejeita, antes da mutação/auditoria, formatos reconhecíveis de CPF/CNPJ, e-mail, telefone brasileiro formatado, bearer/API keys, campos de segredo/senha e cabeçalhos de chave privada. O CPF é normalizado e validado com dígitos verificadores; fixture sintético histórico tem exceção de Gitleaks limitada a um fingerprint específico. PR #58 integrada em `8fd1e68`; no SHA validado, CI 47/47, Gitleaks e CodeQL aprovados.
- Minimização da fila administrativa e anti-cache: API não devolve e-mail do comerciante, `merchantId` nem `walletDestinationId`, não consulta o e-mail para montar a lista e envia `Cache-Control: no-store` na consulta e no registro de revisão. Testes unitários/PostgreSQL garantem ausência desses campos no resultado. PR #60 integrada em `fe7963e`; CI 47/47, Gitleaks e CodeQL aprovados.
- Política global de cache e auditoria histórica: hook `onSend` aplica `Cache-Control: no-store` e `Pragma: no-cache` em todas as rotas `/v1/admin/*`, com testes para caminhos/query strings e exclusão de rotas públicas/comerciante. `/v1/admin/audit` remove `reviewNote` de eventos antigos de revisão de reserva, mantendo evento e metadados operacionais e acrescentando `reviewNoteRedacted`. PR #61 integrada em `e683d8d`; CI 47/47, Gitleaks e CodeQL aprovados.
- Política de cache da API versionada: o hook global aplica `Cache-Control: no-store` e `Pragma: no-cache` a todas as respostas `/v1/`, incluindo administração, autenticação/sessão, perfil, comerciante e checkout; `/health`, `/metrics` e arquivos estáticos não são alterados. Testes cobrem caminhos, query strings e exclusões. PR #62 integrada em `6c58028`; CI 47/47, Gitleaks e CodeQL aprovados tanto no SHA da PR quanto nos workflows pós-merge.
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
- PR #28 — atualização das dependências JWT/Prisma, auditoria moderada e Dependabot; integrado em `3a6594d`.
- PR #29 — Prometheus atualizado para `v3.16.0`; integrado após CI de scrape/alertas.
- PR #31 — Grafana atualizado para `13.3.1`; integrado após teste de provisioning/dashboard.
- PR #32 — `actions/checkout` atualizado para `v7`; integrado após CI e Security.
- PR #33 — `actions/setup-node` atualizado para `v7`; integrado após CI e Security.
- PR #36 — Argon2 atualizado para `0.45.2`; integrado após testes e análise estática.
- PR #37 — criação e reativação de webhooks com limite transacional `SERIALIZABLE`, audit log atômico e testes de concorrência; integrado em `1515002`.
- PR #38 — `pnpm/action-setup` atualizado para `v6`; integrado em `cf3a616`.
- PR #40 — runbook PostgreSQL 16→18, sidecar isolado com volume novo e ensaio lógico automatizado em CI; integrado em `5b6600b`.
- PR #47 — advisory lock transacional para coordenação da reconciliação entre réplicas, lotes limitados e teste unitário; integrada em `cceb16e` após CI e Security aprovados.
- PR #49 — teste E2E com dois clientes Prisma/PostgreSQL reais em schema isolado e etapa própria no CI; integrada em `0fd1fd7` após 45/45 etapas de CI, CodeQL e Gitleaks aprovados.
- PR #52 — idempotência persistente para criação HMAC de cobranças, testes unitários, testes de hooks/recuperação concorrente e integração PostgreSQL; integrada em `0fef2ef` após CI 45/45, Gitleaks 5/5 e CodeQL 8/8.
- PR #54 — fila administrativa para reservas HMAC não resolvidas, metadata mínima, revisão manual auditada e teste PostgreSQL que comprova que revisão não libera a reserva; integrada em `6cd1d63` após CI 47/47, Gitleaks 5/5 e CodeQL 8/8.
- PR #56 — corrige o fluxo da fila para que reservas já revisadas saiam da lista de trabalho sem serem desbloqueadas; compare-and-set impede segunda revisão e o teste PostgreSQL confirma permanência da reserva sem resposta. Integrada em `a7d8a48` após CI 47/47, Gitleaks 5/5 e CodeQL 8/8.

Evidências:
- [CI pós-merge do PR #20 — sucesso](https://github.com/mdossa07/pix-usdt-platform/actions/runs/45623673089).
- [CI do PR #19 — sucesso](https://github.com/mdossa07/pix-usdt-platform/actions/runs/45519035765).
- [CI pós-merge do PR #18 — sucesso](https://github.com/mdossa07/pix-usdt-platform/actions/runs/45518472158).
- [CI do PR #22 — push, sucesso](https://github.com/mdossa07/pix-usdt-platform/actions/runs/45625231839).
- [CI do PR #22 — pull request, sucesso](https://github.com/mdossa07/pix-usdt-platform/actions/runs/45625264032).
- [CI pós-merge do PR #23 — sucesso](https://github.com/mdossa07/pix-usdt-platform/actions/runs/45625664517).
- [CI PR #37 — push, sucesso](https://github.com/mdossa07/pix-usdt-platform/actions/runs/45633985690).
- [CI PR #37 — pull request, sucesso](https://github.com/mdossa07/pix-usdt-platform/actions/runs/45634056875).
- [Security PR #37 — Gitleaks e CodeQL, sucesso](https://github.com/mdossa07/pix-usdt-platform/actions/runs/45634056837).
- [CI PR #38 — push, sucesso](https://github.com/mdossa07/pix-usdt-platform/actions/runs/45634840203).
- [CI PR #38 — pull request, sucesso](https://github.com/mdossa07/pix-usdt-platform/actions/runs/45634856768).
- [Security PR #38 — Gitleaks e CodeQL, sucesso](https://github.com/mdossa07/pix-usdt-platform/actions/runs/45634856709).
- [CI PR #40 — push, sucesso com ensaio 16→18](https://github.com/mdossa07/pix-usdt-platform/actions/runs/45636981635).
- [CI PR #40 — pull request, sucesso](https://github.com/mdossa07/pix-usdt-platform/actions/runs/45637080866).
- [Security PR #40 — Gitleaks e CodeQL, sucesso](https://github.com/mdossa07/pix-usdt-platform/actions/runs/45637080961).
- [CI PR #47 — sucesso](https://github.com/mdossa07/pix-usdt-platform/actions/runs/45646235215).
- [Security PR #47 — Gitleaks e CodeQL, sucesso](https://github.com/mdossa07/pix-usdt-platform/actions/runs/45646235047).
- [CI PR #49 — sucesso, incluindo teste de advisory lock em PostgreSQL real](https://github.com/mdossa07/pix-usdt-platform/actions/runs/45647362568).
- [Security PR #49 — Gitleaks e CodeQL, sucesso](https://github.com/mdossa07/pix-usdt-platform/actions/runs/45647362549).
- [CI PR #52 — sucesso, 45/45 etapas](https://github.com/mdossa07/pix-usdt-platform/actions/runs/45652385503).
- [Security PR #52 — Gitleaks e CodeQL, sucesso](https://github.com/mdossa07/pix-usdt-platform/actions/runs/45652458872).
- [CI PR #54 — sucesso, 47/47 etapas](https://github.com/mdossa07/pix-usdt-platform/actions/runs/45655539203).
- [Security PR #54 — Gitleaks e CodeQL, sucesso](https://github.com/mdossa07/pix-usdt-platform/actions/runs/45655539240).
- [CI PR #56 — sucesso, 47/47 etapas](https://github.com/mdossa07/pix-usdt-platform/actions/runs/45657531472).
- [Security PR #56 — Gitleaks e CodeQL, sucesso](https://github.com/mdossa07/pix-usdt-platform/actions/runs/45657531512).

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
- **Gate regulatório brasileiro aberto:** a Lei 14.478/2022 (arts. 2º e 5º), Resolução BCB 520/2025 (art. 91, com redação da Res. 589/2026, vigente desde 06/11/2026) e Resolução BCB 521/2025 (art. 76-A, § 3º) exigem análise formal do papel da PixSplit, da contraparte autorizada e da movimentação de recursos de terceiros no split 98%/2%. O risco e as perguntas para o parecer estão em `docs/12-brazil-crypto-regulatory-gates.md`. Nenhuma autorização de provedor pode ser presumida pela marca, API ou protocolo de pedido.

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

**Progresso global estimado: 77%.**

O produto permanece em modo mock. O retry de webhook não habilita pagamentos reais. Permanecem bloqueios de autorização/contratos e credenciais de provedores, implantação de produção, Alertmanager/receivers, pentest externo e revisão jurídica/regulatória/fiscal.


## Entrega validada — autenticação administrativa e retry de webhooks — 25/11/2026

- PR #22: login de superadministrador pelo cookie HttpOnly; o servidor confirma a identidade em `/v1/me`, valida o papel `SUPER_ADMIN` e revoga sessão no logout. E2E Chromium confirmou ausência de bearer token no `localStorage` e rejeição da sessão antiga após logout.
- PR #23: comerciante pode reativar o próprio endpoint e reenfileirar apenas entregas `FAILED`; mantém o mesmo `eventId` e payload, valida ownership, usa compare-and-set, limita tentativas e grava auditoria.
- Ambos os recursos estão integrados em `master`; CI de PR #22 e pós-merge de PR #23 aprovados.

**Progresso global estimado: 76%.** O sistema permanece em modo mock; nenhum PIX real, conversão ou payout on-chain foi habilitado.


## Entrega validada — segurança automatizada do repositório — 25/11/2026

- PR #25 integrado em `master` no commit `60079e7`.
- Gitleaks executou a varredura do histórico Git completo; primeira execução do workflow terminou com sucesso.
- CodeQL executou análise `security-extended` para JavaScript/TypeScript; workflow terminou com sucesso.
- CI deixou de usar credenciais de teste fixas no YAML: gera valores criptograficamente aleatórios para JWT, chave de criptografia PII, token Prometheus e senha Grafana em cada execução, com mascaramento no log.
- Isso automatiza detecção e reduz exposição de valores estáticos no CI, mas não substitui tornar o repositório privado, proteger `master`, revisar alertas e manter segredos reais em secret manager.


## Entrega validada — dependências e supply-chain — 25/11/2026

- PR #28 integra atualização dos componentes JWT e overrides transitivos de Prisma, com lockfile atualizado pelo pnpm.
- A instalação congelada `pnpm install --frozen-lockfile` e a auditoria `pnpm audit --audit-level moderate` passaram.
- CI passou em push e pull request; testes unitários, integração PostgreSQL, migrações, E2E Chromium, build e smoke de Prometheus/Grafana também passaram.
- Gitleaks e CodeQL passaram na PR.
- Dependabot está configurado para npm, GitHub Actions e Docker Compose. O Dependency Review foi deixado em `workflow_dispatch` enquanto o Dependency Graph estiver desativado; o CI mantém `pnpm audit` como gate ativo.
- O workflow temporário de geração de lockfile foi removido depois da geração e validação para não deixar automação de escrita limitada a uma branch de trabalho.
- Reconciliação também seleciona payouts `SUBMITTED` há mais de 30 minutos nas duas pernas independentes, reentra no orquestrador para consulta pelo identificador original, consolida candidatos em uma consulta OR e impede ciclos `setInterval` sobrepostos na mesma instância.
- A reconciliação não converte ausência de status do provedor em falha nem reenvia automaticamente uma transferência ambígua; quando o adapter não oferece consulta segura, o pagamento continua `UNDER_REVIEW`.

**Progresso global estimado: 75%.** A plataforma permanece `mock` e não pode movimentar dinheiro real.


## Entrega validada — limite transacional e cadeia de ferramentas — 25/11/2026

- PR #36 atualizou Argon2 para `0.45.2`; CI e Security passaram.
- PR #37 centralizou a regra de no máximo dez webhooks ativos por comerciante. Criação e reativação verificam capacidade e gravam auditoria na mesma transação PostgreSQL `SERIALIZABLE`; conflitos de serialização viram HTTP 409.
- O teste de integração disputou a última vaga entre duas criações concorrentes e entre duas reativações concorrentes. Em ambos os cenários, exatamente uma operação foi aceita e a contagem final permaneceu em dez. A tentativa de reativar com capacidade cheia foi recusada.
- PR #29 atualizou Prometheus para `v3.16.0`; PR #31 atualizou Grafana para `13.3.1`; os smoke tests validaram scrape, provisioning e dashboard.
- PR #32 e #33 atualizaram `actions/checkout` e `actions/setup-node` para `v7`; PR #38 atualizou `pnpm/action-setup` para `v6`. CI e Security passaram após essas atualizações.
- PR #30 (PostgreSQL 16→18) permanece aberta e não foi integrada ao serviço principal. PR #40 criou o ensaio lógico de dump/restore; PR #45 ampliou o fixture validado para PK/identity e sequência, FK, UNIQUE/CHECK, índice, JSONB e numeric(28,8), com cliente PG18 lendo o servidor 16 e restore em cluster 18 descartável. O volume real `pixsplit_pg` continua em PG16 e não foi tocado; o cutover só deve ocorrer após backup/snapshot verificado, rehearsal dos dados reais, plano de rollback e aprovação do operador.
- PR #35 (Dependency Review v5) permanece aberto; a ação está em `workflow_dispatch` até o proprietário habilitar Dependency Graph.

**Progresso global estimado: 76%.** A plataforma continua em modo mock. A aprovação do provedor, credenciais sandbox/live, compliance e ambiente de produção permanecem pendentes.


## Entrega validada — preparação segura PostgreSQL 16→18 — 25/11/2026

- PR #40 integrada em `master` no commit `5b6600b`.
- `scripts/postgres-major-upgrade-smoke.sh` cria clusters descartáveis PostgreSQL 16/18, gera dump custom-format com cliente 18 lendo o servidor 16, restaura no servidor 18 e verifica conteúdo de texto e JSONB.
- O ensaio usa rede e volume temporários próprios, removidos pelo script; nunca monta nem modifica `pixsplit_pg` ou `pixsplit_redis`.
- `docker-compose.postgres18-migration.yml` define sidecar opcional em `localhost:5434` com volume separado e mount correto `/var/lib/postgresql`.
- `docs/11-postgres-major-upgrade-runbook.md` documenta backup, restore, validações, cutover e rollback; o volume PG16 permanece preservado.
- O CI passou a validar o overlay Compose, executar o ensaio 16→18 e usar `promtool v3.16.0`, alinhado à imagem Prometheus do stack.
- CI de push, CI de PR e Gitleaks/CodeQL da PR #40 passaram.

**Progresso global estimado: 77%.** O software agora possui um rehearsal repetível de migração major; a base real do usuário ainda não foi migrada, e o serviço principal permanece PostgreSQL 16.


## Entrega validada — recuperação de payouts ambíguos — 25/11/2026

- PR #43 integrada na `master` no commit `250ff57`.
- O reconciliador passou a localizar cada uma das pernas `SUBMITTED` que permaneça sem resolução por pelo menos 30 minutos, inclusive quando ambas estiverem ambíguas.
- Cada pagamento é enfileirado uma vez por ciclo; uma consulta OR substitui as múltiplas consultas por categoria e a ordenação prioriza os pagamentos mais antigos.
- O serviço usa single-flight local para impedir ciclos sobrepostos no mesmo processo. Falha temporária ao enfileirar libera a trava para o próximo ciclo.
- A retomada usa o `PaymentOrchestrator`, que consulta o provedor pela referência e chave de idempotência originais antes de qualquer nova tentativa. Resultado ausente, erro de consulta ou falta de capacidade do adapter não autoriza novo payout; mantém-se a revisão manual.
- Cinco testes unitários cobrem as duas pernas `SUBMITTED`, deduplicação, ciclo sobreposto, falha de Redis e ausência de candidatos.
- CI de push e pull request, auditoria de dependências, Chromium, integrações PostgreSQL, build, Gitleaks e CodeQL passaram.

**Progresso global estimado: 78%.** A plataforma permanece em modo mock e não movimenta dinheiro real.


## Entrega validada — ampliação do ensaio PostgreSQL 16→18 — 25/11/2026

- PR #45 integrada na `master` no commit `5649a6f`.
- O fixture descartável cria schema com PK, `GENERATED BY DEFAULT AS IDENTITY`, UNIQUE, CHECK, FK, índice, JSONB, timestamptz e `numeric(28,8)`.
- O ensaio cria duas linhas e uma relação filha no PG16, usa o `pg_dump` do PG18 para gerar dump custom-format, restaura no PG18 e valida marker, JSONB, precisão decimal, linha filha/FK, constraints e índice.
- Após o restore, uma inserção sem ID exige o próximo valor `3`, verificando que o estado da identity/sequence foi preservado.
- A primeira versão do teste revelou duas fragilidades de automação (captura do ID remoto e saída de command tag do `psql`); ambas foram corrigidas e a execução final do ensaio passou.
- Source PG16 fica em tmpfs descartável; target PG18 usa volume com prefixo único `pixsplit-pg18-smoke-`, removido no cleanup. O script nunca monta, lê, modifica ou remove `pixsplit_pg` ou `pixsplit_redis`.
- CI de push e pull request passaram, assim como Gitleaks e CodeQL. O ensaio não valida todo o schema real, roles, extensões, collation, downtime ou cutover de produção.

**Progresso global estimado: 79%.** O serviço principal segue PostgreSQL 16 e permanece em modo mock.

- Proteção dos metadados de auditoria de carteira: o campo livre `exchangeName` deixou de ser armazenado em novos eventos `WALLET_REGISTERED`; valores históricos do campo são removidos na resposta administrativa, com marcador `exchangeNameRedacted`, mantendo rede e tipo de carteira. PR #64 integrada em `5afcb4e`; CI 47/47, Gitleaks e CodeQL aprovados no SHA da PR; workflows pós-merge em execução.
