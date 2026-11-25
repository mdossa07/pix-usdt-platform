# Runbook operacional do PixSplit

> Estado: procedimento operacional proposto. Antes de produção, o titular deve designar responsáveis, aprovar contatos, horários de resposta, autoridade de comunicação e política de retenção de evidências.

## Liveness e readiness da API

- `GET /health` é o probe de liveness: confirma que o processo HTTP está vivo e não depende de PostgreSQL ou Redis.
- `GET /ready` é o probe de readiness: executa `SELECT 1` no PostgreSQL e `PING` no Redis.
- A resposta de `/ready` é HTTP 200 com `status: ready` somente quando os dois serviços respondem. Se algum estiver indisponível, retorna HTTP 503 e indicadores booleanos por dependência, sem expor mensagens de erro, URLs ou credenciais.
- Configure o balanceador/orquestrador para usar `/health` como liveness e `/ready` como readiness. Não use `/health` como evidência de que banco e filas estão operacionais.
- Ambas as respostas usam `Cache-Control: no-store`.

## 1. Regras que não podem ser ignoradas

- O sistema deve permanecer em `PAYMENTS_MODE=mock` até que provedor, fluxo PIX, conversão, Travel Rule e os dois payouts independentes tenham sido homologados e liberados por escrito.
- Nunca alterar `PAYMENTS_MODE` ou remover os guards de produção para contornar aprovação pendente.
- Nunca marcar PIX como confirmado sem evidência final autenticada do provedor.
- Uma operação só fica concluída quando a entrada PIX, conversão e as duas pernas de liquidação estiverem confirmadas e reconciliadas.
- Em timeout de payout, consultar o ID externo e reconciliar antes de qualquer nova tentativa. Nunca repetir cegamente uma perna que possa ter sido processada.
- Não solicitar nem armazenar seed phrase, chave privada, senha de corretora ou chave de saque do comerciante.

## 2. Papéis e contatos

Preencher antes do go-live:

| Papel | Responsabilidade | Titular / contato |
|---|---|---|
| Responsável operacional | Coordena triagem, preservação de evidências e comunicação técnica | A designar |
| Responsável de segurança | Acesso emergencial, credenciais, sessões e investigação | A designar |
| Responsável financeiro | Reconciliação de saldo, ledger, payin e payouts | A designar |
| Responsável jurídico/compliance | LGPD, incidentes regulatórios, KYC/KYB e Travel Rule | A designar |
| Contato de cada provedor | Bloqueios, liquidez, status e reconciliação externa | A designar |

Nenhuma pessoa deve acumular sozinha a execução e a aprovação de uma operação emergencial com impacto financeiro.

## 3. Triagem inicial de incidente

1. Abrir registro com ID único, data/hora UTC, responsável e severidade.
2. Descrever sintoma e janela temporal sem incluir CPF, segredos, tokens, endereços completos ou dados desnecessários.
3. Preservar IDs de pagamento, IDs de evento, IDs de ordem/transferência, request IDs do provedor e hashes de transação.
4. Consultar health, estado do provedor, filas, entregas de webhook e métricas.
5. Não executar reprocessamento financeiro nem editar o ledger manualmente durante a triagem.
6. Definir se o incidente envolve disponibilidade, integridade financeira, segurança, dados pessoais ou provedor externo.

## 4. PIX recebido, conversão ou payout divergente

**Sinais:** pagamento sem confirmação final, estado desconhecido, diferença de saldo, uma perna concluída e outra pendente, timeout de ordem ou saque.

1. Colocar a operação sob revisão; não prometer liquidação.
2. Localizar o pagamento pelo ID interno e external ID.
3. Verificar evento de entrada, assinatura, fingerprint, claim de webhook e timestamps.
4. Consultar o provedor pelo ID de ordem/transferência e verificar saldo, valor, moeda, rede, destino, status final e hash on-chain.
5. Comparar cada perna com as linhas do ledger. Conferir o total: merchant + comissão = total líquido convertido, conforme cotação e tarifas do provedor.
6. Se uma perna já estiver concluída, não a reenviar. Reconciliar somente a perna pendente.
7. Exigir dupla revisão do responsável operacional e financeiro antes de qualquer ação externa manual.
8. Registrar evidências, decisão, executor, aprovador e resultado.

**Escalonar imediatamente** quando houver diferença de saldo, hash ausente, beneficiário divergente, possível duplicidade ou evidência inconclusiva.

## 5. Webhooks de saída para comerciantes

**Sinais:** fila pendente crescente, entregas em retry, endpoint com falha, 3xx, timeout, DNS bloqueado.

1. Consultar `GET /v1/merchant/webhooks/:endpointId/deliveries` e registrar IDs de evento, tentativas e códigos de erro.
2. Confirmar se o endpoint está habilitado e se o host continua resolvendo exclusivamente para IPs públicos.
3. Verificar se o comerciante validou HMAC sobre o timestamp + corpo JSON bruto e se deduplica por `X-PixSplit-Event-Id`.
4. Em vazamento de segredo, rotacionar o segredo e comunicar o comerciante por canal autenticado.
5. Não criar manualmente uma segunda entrega para substituir uma entrega ambígua. A entrega é at-least-once; o mesmo evento pode chegar novamente.
6. Não seguir redirecionamentos nem desativar a proteção SSRF para “corrigir” endpoint do cliente.

## 6. Conta administrativa comprometida ou suspeita

1. Confirmar com o responsável de segurança por canal separado.
2. Desativar temporariamente o usuário comprometido e revogar todas as sessões desse usuário.
3. Revogar chaves API de comerciante afetadas e rotacionar segredos relacionados.
4. Preservar registros de auditoria, IP, user-agent, IDs de sessão e horários; não copiar tokens ou segredos para o ticket.
5. Verificar alterações em comerciantes, carteiras, credenciais de provedores, usuários, MFA e configurações.
6. Reativar acesso apenas após troca de senha, MFA validado, revisão de sessões e aprovação de duas pessoas.
7. Se houver evidência de acesso indevido a dados pessoais, envolver o responsável jurídico/compliance para avaliar as obrigações legais e prazos aplicáveis.

## 7. Recuperação emergencial administrativa — proposta de break-glass

Este fluxo ainda precisa de aprovação formal e de configuração operacional.

**Modelo recomendado: aprovação 2-de-3**, com três responsáveis distintos previamente cadastrados: titular/operacional, segurança e financeiro ou compliance. Nenhum indivíduo pode aprovar a própria solicitação.

- Exigir incidente/ticket com justificativa, escopo exato, ações permitidas e prazo de validade.
- Dois aprovadores independentes devem registrar aprovação por canal autenticado separado.
- Preferir conta individual temporária e MFA; nunca compartilhar conta, senha, TOTP, código de recuperação ou token.
- Conceder apenas o menor privilégio necessário, por prazo curto e com encerramento automático.
- Não permitir que break-glass habilite pagamentos sandbox/live, altere carteira de destino ou repita payout sem o processo de aprovação financeira e homologação correspondente.
- Registrar login, JTI da sessão, aprovadores, operações executadas e horários. Alertar imediatamente os outros responsáveis.
- Ao encerrar, desativar a conta temporária, revogar todas as sessões, rotacionar credenciais usadas e realizar revisão independente.
- Realizar simulado trimestral sem movimentação financeira real.

**Não implementar um bypass de MFA** como mecanismo de break-glass. Recuperação deve preservar a separação de funções e a trilha de auditoria.

## 8. Métricas Prometheus e scrape

O endpoint `GET /metrics` só existe para scrapes autenticados quando `METRICS_BEARER_TOKEN` está configurado com 32 a 256 caracteres ASCII visíveis. Sem segredo, responde 404; token ausente/incorreto responde 401. O segredo deve ficar no secret manager do ambiente e nunca ser colocado em painel, frontend, query string ou repositório.

Métricas exportadas:
- `pixsplit_http_requests_total`: contador por método, template de rota e status HTTP.
- `pixsplit_http_request_duration_seconds`: histograma de duração por método, template de rota e status.
- `pixsplit_process_uptime_seconds`, `pixsplit_process_resident_memory_bytes` e `pixsplit_process_heap_used_bytes`.

Os labels de rota usam somente `request.routeOptions.url` (template Fastify). IDs, CPF, e-mail, query strings e URLs desconhecidas não são labels; rotas não correspondidas aparecem como `unmatched`. As métricas ficam em memória por processo, sem estado persistente nem dependência adicional. Em múltiplas réplicas, configure um scrape por réplica e agregue no Prometheus.

Exemplo ilustrativo de scrape config (usar o mecanismo de secret file do ambiente; não inserir o valor no YAML):

```yaml
scrape_configs:
  - job_name: pixsplit-api
    metrics_path: /metrics
    scrape_interval: 15s
    authorization:
      type: Bearer
      credentials_file: /run/secrets/pixsplit_metrics_token
    static_configs:
      - targets: ["pixsplit-api:4000"]
```

O scrape token deve ser gerado aleatoriamente, ter pelo menos 32 caracteres e ser provisionado no secret manager. Restringir também o acesso de rede à porta da API para que somente o Prometheus possa consultar `/metrics`. Configurar alertas e retenção no ambiente de monitoramento; o endpoint por si só não instala nem opera Prometheus.

### Alertmanager — entrega opcional por webhook

O stack padrão Prometheus/Grafana permanece independente. Para ativar entrega de alertas, use o overlay opcional `docker-compose.alertmanager.yml`, que adiciona Alertmanager e faz Prometheus encaminhar alertas para ele na rede Docker interna. A porta do Alertmanager fica publicada somente em `127.0.0.1:9093`.

1. Crie um arquivo de segredo local, fora do Git, com a URL HTTPS do webhook que aceitará o payload JSON padrão do Alertmanager:

```bash
mkdir -p .secrets
read -r -s -p "HTTPS Alertmanager webhook URL: " ALERTMANAGER_WEBHOOK_URL
printf '\n'
printf '%s' "$ALERTMANAGER_WEBHOOK_URL" > .secrets/alertmanager_webhook_url
unset ALERTMANAGER_WEBHOOK_URL
chmod 600 .secrets/alertmanager_webhook_url
export ALERTMANAGER_WEBHOOK_URL_FILE="$PWD/.secrets/alertmanager_webhook_url"
```

2. Valide a configuração e suba o stack com o overlay:

```bash
docker run --rm --entrypoint=amtool \
  -v "$PWD/infra/alertmanager/alertmanager.yml:/etc/alertmanager/alertmanager.yml:ro" \
  -v "$ALERTMANAGER_WEBHOOK_URL_FILE:/run/secrets/alertmanager_webhook_url:ro" \
  prom/alertmanager:v0.35.1 \
  check-config /etc/alertmanager/alertmanager.yml

docker compose -f docker-compose.observability.yml -f docker-compose.alertmanager.yml config --quiet
docker compose -f docker-compose.observability.yml -f docker-compose.alertmanager.yml up -d
```

3. Confirme `http://127.0.0.1:9093/-/ready` e verifique na API do Prometheus `/api/v1/alertmanagers` que o alvo `alertmanager:9093` está ativo.

O receiver lê a URL pelo campo `url_file`; a URL/token não deve ser inserida no YAML, no `.env`, em logs, tickets ou commits. Mantenha a validação TLS padrão e não publique a porta 9093 na Internet. O receiver envia alertas resolvidos, agrupa por nome/serviço/severidade e limita cada notificação a 20 alertas.

O CI usa somente `https://alerts.pixsplit.invalid/webhook` para validar o parser, a inicialização do Alertmanager e o registro no Prometheus. Esse domínio reservado não recebe notificações; **a entrega real só estará homologada depois que o responsável configurar a URL HTTPS do receptor e confirmar uma notificação de teste recebida**. O endpoint de destino deve tolerar entregas repetidas e usar o fingerprint/labels para deduplicar notificações.
## 9. Deploy e rollback

1. Confirmar aprovação de release, revisão de código, CI verde e hash do commit.
2. Fazer backup PostgreSQL consistente e testar leitura/verificação do artefato antes da migração.
3. Confirmar secrets, domínio, TLS, CORS, Redis, storage, e-mail e scanner; nunca imprimir valores secretos no log.
4. Aplicar migrações com `prisma migrate deploy`; não usar `migrate dev` em produção.
5. Subir versão com feature flags financeiras desabilitadas.
6. Executar smoke checks de health, login, MFA, sessões, painel, criação mock e consulta de entregas de webhook.
7. Monitorar erros, latência, DB pool, filas, falhas de webhook e saldo de ledger.
8. Em falha, interromper rollout e fazer rollback da aplicação. Não tentar desfazer migração destrutiva manualmente; restaurar conforme plano de recuperação testado.
9. Reconciliar pagamentos pendentes antes de retomar o processamento.

## 10. Evidências e encerramento

Cada incidente deve guardar: ID, severidade, impacto, timestamps, serviços afetados, commit/versão, IDs externos, hashes, decisões, aprovadores, ações, resultado, causa raiz e tarefas preventivas. Remover PII desnecessária e armazenar o registro no repositório de incidentes com acesso restrito.

Encerrar somente quando integridade financeira for confirmada, sessões/segredos estiverem seguros, clientes/provedores pertinentes forem informados e as ações corretivas tiverem responsáveis e prazos.
