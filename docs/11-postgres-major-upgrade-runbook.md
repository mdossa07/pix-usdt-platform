# Rehearsal e plano de migração PostgreSQL 16 → 18

> **Não é uma instrução para trocar a imagem do banco em produção.** PostgreSQL 16 e 18 são versões major diferentes. Os arquivos de dados não devem ser reutilizados diretamente por uma imagem de outra major.

## Por que existe esta etapa

O Compose local atual usa PostgreSQL 16 e o volume `pixsplit_pg`, montado em `/var/lib/postgresql/data`. O PostgreSQL Official Image mudou a estrutura de dados na major 18: o `PGDATA` padrão passou a ser versionado (em 18, `/var/lib/postgresql/18/docker`) e o volume oficial deve ser montado no diretório pai `/var/lib/postgresql`. O caminho antigo e o novo não são intercambiáveis. Consulte a documentação da imagem oficial: [PGDATA e mudança no PostgreSQL 18+](https://github.com/docker-library/docs/blob/master/postgres/content.md#pgdata).

A documentação oficial do PostgreSQL classifica 16→18 como atualização major e apresenta três rotas de migração: dump/restore lógico, `pg_upgrade` ou replicação. Uma troca simples do tag da imagem não executa nenhuma delas. Consulte [Upgrading a PostgreSQL Cluster](https://www.postgresql.org/docs/18/upgrading.html) e [pg_upgrade](https://www.postgresql.org/docs/18/pgupgrade.html).

## O que está implementado neste repositório

- `docker-compose.postgres18-migration.yml` define um serviço de ensaio separado, com volume novo `pixsplit_pg18_migration`, porta local 5434 e montagem em `/var/lib/postgresql`.
- `scripts/postgres-major-upgrade-smoke.sh` inicia clusters descartáveis PostgreSQL 16 e 18, cria um schema representativo, faz dump custom-format usando o cliente 18 e restaura no 18.
- O fixture valida chave primária, identity e estado da sequência, chave estrangeira e linha relacionada, constraint `UNIQUE`, constraint `CHECK`, índice, JSONB, texto e precisão exata de `numeric(28,8)`.
- Após o restore, o script insere uma nova linha sem informar o ID e exige o próximo valor esperado da identity; isso verifica que a sequência foi restaurada, não apenas as linhas da tabela.
- A cobertura é deliberadamente representativa e descartável. Ela não prova compatibilidade de todas as tabelas reais, extensões, roles/grants, collations, volume de produção, downtime ou procedimentos específicos de cutover.
- O ensaio não monta, lê, modifica, renomeia nem remove `pixsplit_pg` ou `pixsplit_redis`.
- O CI executa o ensaio em cada push e pull request.

## Rodar o ensaio descartável

Na raiz do repositório, com Docker funcionando:

```bash
bash scripts/postgres-major-upgrade-smoke.sh
```

Saída esperada:

```text
PostgreSQL 16→18 logical dump/restore rehearsal passed.
Verified: PK/identity, sequence state, FK, unique/check constraints, index, JSONB and numeric precision.
Source and target were disposable containers; no project volume was mounted.
```

O script limpa os contêineres, a rede e o volume temporário ao terminar. Se for interrompido abruptamente, inspecione e remova apenas os recursos com prefixo `pixsplit-pg-upgrade-` ou `pixsplit-pg18-smoke-`; nunca remova o volume `pixsplit_pg`.

## Rehearsal manual com o banco local

O serviço adicional usa um volume PostgreSQL 18 separado. Primeiro suba o PostgreSQL 16 normal e o sidecar 18:

```bash
docker compose -f docker-compose.yml -f docker-compose.postgres18-migration.yml --profile postgres18-migration up -d postgres postgres18-migration
```

Confirme versões, saúde e diretório de dados:

```bash
docker compose exec postgres psql -U postgres -d pixsplit -c 'SELECT version(); SHOW data_directory;'
docker compose exec postgres18-migration psql -U postgres -d pixsplit -c 'SELECT version(); SHOW data_directory;'
```

Crie backups antes de qualquer corte. O exemplo abaixo usa o cliente `pg_dump` da imagem 18 para ler o servidor 16 e grava um arquivo custom-format local:

```bash
mkdir -p backups
chmod 700 backups
umask 077
docker compose -f docker-compose.yml -f docker-compose.postgres18-migration.yml exec -T postgres18-migration sh -lc 'PGPASSWORD="$POSTGRES_PASSWORD" pg_dump -h postgres -U "$POSTGRES_USER" -d "$POSTGRES_DB" --format=custom' > backups/pixsplit-pg16.dump
```

Inspecione o dump:

```bash
cat backups/pixsplit-pg16.dump | docker compose -f docker-compose.yml -f docker-compose.postgres18-migration.yml exec -T postgres18-migration pg_restore --list
```

A base de destino do sidecar 18 é nova e isolada. Restaure somente depois de confirmar que ela não contém dados necessários:

```bash
cat backups/pixsplit-pg16.dump | docker compose -f docker-compose.yml -f docker-compose.postgres18-migration.yml exec -T postgres18-migration sh -lc 'PGPASSWORD="$POSTGRES_PASSWORD" pg_restore --exit-on-error --no-owner --no-privileges -h localhost -U "$POSTGRES_USER" -d "$POSTGRES_DB"'
```

Depois compare contagens e invariantes de negócio, execute `prisma migrate status`, os testes de integração, o E2E Chromium e os smoke tests da aplicação apontando para `localhost:5434`. O dump lógico do banco não substitui backup de configuração, roles/grants especiais, secrets, Redis, volumes externos, arquivos ou certificados. Registre extensões instaladas e dependências de extensões antes de uma migração real.

## Procedimento exigido antes de um corte real

1. Aprovar janela de manutenção e congelar escrita da aplicação/workers.
2. Fazer backup lógico consistente, backup de roles e snapshot do volume antigo; calcular checksum e testar leitura/restauração.
3. Restaurar em um novo volume PostgreSQL 18, nunca sobre o volume 16.
4. Validar extensões, roles/grants, schema, contagens, índices, constraints, timezone/locale, collation, migrations Prisma e consultas críticas.
5. Rodar suite financeira completa em ambiente isolado, com `PAYMENTS_MODE=mock`; não habilitar provedores ou payouts.
6. Executar smoke tests e comparar integridade entre origem e destino.
7. Somente depois de aprovações explícitas, abrir PR de cutover: atualizar a imagem para `postgres:18-alpine` e apontar o serviço normal para o novo volume `pixsplit_pg18_migration` montado em `/var/lib/postgresql`. Preservar o volume 16 sem alteração.
8. Manter o banco antigo intacto até concluir a janela de estabilização e o backup do destino.

## Rollback e proteção dos dados

- Antes de aceitar escritas no PostgreSQL 18, o rollback pode voltar ao serviço 16 e ao volume antigo `pixsplit_pg`.
- **Depois que o PostgreSQL 18 receber novas escritas, não volte simplesmente ao volume 16**: ele estará desatualizado. Será necessário congelar novamente as escritas, fazer dump lógico do 18, restaurar no 16 apenas se a compatibilidade e o teste reverso forem aprovados, ou seguir plano específico de reconciliação.
- Nunca executar `docker compose down -v`, `docker volume rm pixsplit_pg` ou `pg_upgrade --link` como tentativa improvisada de rollback.
- O ensaio automático é uma prova de dump/restore entre imagens limpas e cobre apenas o schema-fixture explícito do script (PK/identity/sequência, FK, UNIQUE/CHECK, índice, JSONB e precisão numérica). Ele não é backup do ambiente real e não valida sozinho todas as tabelas da aplicação, extensões, roles de produção, collations, volume real, volume de dados, duração de downtime ou procedimento final de cutover.

## Critério para fechar PR #30

A atualização major só pode ser integrada após: backup verificado, rehearsal reproduzível, plano de cutover e rollback aprovado, validação da aplicação e evidência de que o volume antigo continua íntegro. Até lá, manter PostgreSQL 16 no Compose principal.
