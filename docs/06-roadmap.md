# 06 — Roadmap de entrega

## 0.2.0 — Fundação e protótipo conectado (implementado nesta etapa)

- [x] Monorepo pnpm com Next.js, Fastify, Prisma e PostgreSQL.
- [x] Dashboard visual e áreas de operações, carteiras, API e relatórios.
- [x] Cadastro/login JWT e hash Argon2id.
- [x] Cadastro de carteiras USDT Polygon/Tron, criptografia AES-256-GCM dos campos sensíveis e dados de titular/Exchange.
- [x] Criação de pagamentos mock, consulta de operações e endpoint de liquidação simulada.
- [x] Cálculo 98%/2% usando `BigInt` em seis casas decimais.
- [x] Schema para transfers, ledger, webhooks, idempotência e auditoria.
- [x] Verificação HMAC de webhook Foxbit V2.
- [x] Trava fail-closed: a API não inicializa com modo sandbox/live nem com NODE_ENV=production nesta versão.
- [x] Documentação Foxbit atualizada com a distinção entre Fiat Gateway partner-level e funding de sub-member.

## Próxima etapa — Homologação Foxbit

- [ ] Definir qual produto Foxbit habilita pagamento PIX de terceiros vinculado ao usuário final.
- [ ] Receber aprovação comercial do modelo SaaS/white-label e do cálculo de comissão.
- [ ] Habilitar partner API + sandbox, permissões, webhook e liquidez de teste.
- [ ] Fechar KYC/KYB, cadastro de sub-members e Travel Rule de pagador/beneficiário.
- [ ] Confirmar funding de BRL na subconta e compra USDT no contexto correto.
- [ ] Confirmar transferências internas e saques HOSTED por merchant e da comissão da plataforma.
- [ ] Implementar adapter Foxbit com schemas de request/response conferidos e testes de contrato.
- [ ] Implementar filas, retentativas seguras, estados de cada perna e conciliação automática.

## Próxima etapa — Produto SaaS

- [ ] Painel superadministrador e equipe de Compliance.
- [ ] Gestão de KYC, limites, bloqueios e revisão manual de carteiras.
- [ ] Gestão de chaves de API por merchant, escopos e rotação.
- [ ] Webhooks de saída para sistemas dos merchants.
- [ ] Notificações, exportação CSV e relatórios financeiros.
- [ ] Testes de integração e E2E; observabilidade e alertas.

## Antes de produção

- [ ] Revisão jurídica/contábil do CNPJ, objeto social e responsabilidade regulatória.
- [ ] Contrato e aprovação formal do provedor.
- [ ] Pentest, revisão de LGPD, plano de incidentes e proteção de segredos.
- [ ] Teste de estorno/chargeback e operação parcial (uma perna conclui e outra falha).
- [ ] Homologação de valores mínimos, fees, network e Travel Rule.
- [ ] Aprovação explícita para desbloquear produção (remover a trava somente após checklist completo).
