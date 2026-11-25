# Observabilidade PixSplit

O endpoint Prometheus da API já existe em `GET /metrics`. Este overlay adiciona Prometheus, regras iniciais de alerta e um dashboard Grafana sem alterar o Compose principal de PostgreSQL/Redis e sem ativar pagamentos reais.

## Pré-requisitos

- Docker Engine com Docker Compose v2.
- API PixSplit rodando no host na porta 4000 (o serviço escuta em `0.0.0.0`).
- Um token de scrape aleatório igual ao valor de `METRICS_BEARER_TOKEN` da API.
- Uma senha forte e exclusiva para o administrador Grafana.

## 1. Gerar o token de scrape

Na raiz do repositório:

```bash
umask 077
mkdir -p .secrets
openssl rand -hex 32 | tr -d '\\n' > .secrets/prometheus_metrics_token
chmod 600 .secrets/prometheus_metrics_token
```

Configure o mesmo conteúdo do arquivo como `METRICS_BEARER_TOKEN` no ambiente da API. Não commite o token e não o coloque no frontend, numa query string, no dashboard ou nos logs. O diretório `.secrets/` está no `.gitignore`.

## 2. Iniciar Prometheus e Grafana

Exporte o caminho do segredo e a senha do administrador. O token do arquivo e o token injetado na API precisam ser idênticos:

```bash
export PROMETHEUS_METRICS_TOKEN_FILE="$PWD/.secrets/prometheus_metrics_token"
export GRAFANA_ADMIN_PASSWORD='use-uma-senha-forte-e-exclusiva'
docker compose -f docker-compose.observability.yml config --quiet
docker compose -f docker-compose.observability.yml up -d
```

Acesse apenas pela máquina local:

- Grafana: http://localhost:3001
- Prometheus: http://localhost:9090

Os dois serviços publicam portas limitadas a `127.0.0.1`, não em todas as interfaces. Grafana recebe datasource e dashboard por provisioning; não é necessário cadastrar o Prometheus manualmente.

## 3. Alvo de scrape

O Prometheus resolve `host.docker.internal:4000` a partir do container. O Compose inclui `host-gateway` para Docker Engine Linux; Docker Desktop também fornece o nome `host.docker.internal`.

Se a API estiver em outra máquina ou em container próprio, ajuste `infra/prometheus/prometheus.yml` para o DNS/porta internos do serviço. Não exponha `/metrics` na Internet. Restringir a porta da API a redes confiáveis e manter o Bearer token forte.

Verifique em Prometheus → Status → Targets se `pixsplit-api` está `UP`. O endpoint ficará oculto (HTTP 404) até que a API receba `METRICS_BEARER_TOKEN`; token divergente produz falha de scrape (HTTP 401).

## 4. Alertas e dashboard

As regras incluem API indisponível, taxa HTTP 5xx elevada, p95 acima de um segundo e reinício do processo. O dashboard mostra disponibilidade, requisições/s, 5xx, uptime, latência p50/p95/p99 e memória.

As regras são avaliadas pelo Prometheus, mas não enviam notificações por si mesmas. Para receber alertas por e-mail, Slack, PagerDuty ou outro canal, configurar Alertmanager e um receiver autenticado fora do repositório. Não inserir credenciais de notificação em YAML versionado.

## 5. Persistência e encerramento

Dados TSDB do Prometheus e estado do Grafana usam volumes nomeados. Para interromper:

```bash
docker compose -f docker-compose.observability.yml down
```

Isso preserva os volumes. `down -v` remove os dados históricos e a base local do Grafana; só usar intencionalmente.

## Limitações

- Métricas são locais ao processo. Se a API tiver várias réplicas, configurar um scrape para cada réplica e agregar no Prometheus.
- Não existe Node Exporter/host metrics nesta configuração; memória exportada é a do processo Node.js.
- Não foram provisionados alertas de notificação/Alertmanager, firewall ou infraestrutura real nesta alteração.
- Este overlay não instala nem habilita provedores financeiros e não altera `PAYMENTS_MODE=mock`.
