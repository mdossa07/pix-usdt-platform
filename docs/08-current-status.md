# Status do projeto — 24/11/2026 (atualizado após PR #11)

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


## Novas entregas integradas no master

- PR #8: serviço de idempotência transacional com hash canônico do corpo, resposta serializada e evento de auditoria na mesma transação PostgreSQL.
- PR #9: contrato de idempotência conectado ao endpoint `POST /v1/payments` e ao dashboard do comerciante. A mesma chave e o mesmo payload recuperam a resposta original; corpo diferente retorna HTTP 409. Chave pendente e fingerprint SHA-256 ficam no navegador até resposta confirmada ou logout.
- A cobrança idempotente nasce em `PIX_PENDING` e usa a taxa `PLATFORM_COMMISSION_BPS` configurada.
- PR #10: TOTP RFC 6238 para superadministradores, segredo cifrado AES-256-GCM, desafio de login de cinco minutos, consumo atômico de passos e limitação de tentativas.
- PR #10: dez códigos de recuperação independentes de 128 bits, armazenamento apenas de hashes SHA-256, consumo único transacional e regeneração protegida por senha atual + TOTP.
- Middleware de sessão revalida usuário ativo e papel atual no PostgreSQL em cada rota autenticada, revogando imediatamente sessões de contas desativadas ou com papel alterado.
- PR #11: painel web deixou de receber/guardar JWT em `localStorage`; sessões de navegador usam cookie `HttpOnly`, `Path=/`, duração de 2 horas e `Secure`/`SameSite=None` em produção.
- PR #11: mutações autenticadas por cookie exigem `Origin` igual ao `APP_URL` e `x-csrf-token` vinculado ao JWT assinado; novas abas recuperam o token sem rotacionar a sessão.
- PR #11: logout limpa o cookie de sessão; autenticação por bearer JWT permanece disponível para compatibilidade e as integrações de comerciantes continuam usando HMAC.

## Verificações recentes

- PR #8: serviço e testes PostgreSQL de idempotência aprovados.
- PR #9: CI completo aprovado, incluindo concorrência de cobranças, migrations, financeiro, HMAC, webhooks e build: https://github.com/mdossa07/pix-usdt-platform/actions/runs/45481197090
- PR #10: CI completo aprovado, incluindo RFC 6238, teste concorrente de recuperação PostgreSQL, migrations, testes financeiros, idempotência, HMAC, webhooks e build: https://github.com/mdossa07/pix-usdt-platform/actions/runs/45484553161
- PR #11: CI completo aprovado em `63ecdb7`; install, Prisma, lint, testes unitários, migrações limpas, integração financeira, idempotência concorrente, HMAC, webhooks, TOTP e build: https://github.com/mdossa07/pix-usdt-platform/actions/runs/45491203507
- PR #8, #9, #10 e #11 estão integrados ao branch principal; PR #11 entrou no commit `05ce453`.

## Bloqueios atuais para produção

- Nenhuma cobrança PIX real é emitida; o checkout permanece explicitamente mock.
- Nenhuma conversão BRL→USDT real é executada.
- Nenhum dos dois payouts on-chain (comerciante 98% e plataforma 2%) foi homologado.
- TransFi v3 ainda exige integração atualizada de senders/recipients, consulta dinâmica de campos obrigatórios, método PIX disponível para BR, onboarding KYC/KYB e dois payouts independentes.
- Foxbit Partner exige permissões comerciais específicas. O Fiat Gateway coleta PIX no nível do parceiro; funding de sub-member é um fluxo separado (cash-in interno ou chave PIX provisionada pela Foxbit), que precisa ser aprovado para a arquitetura escolhida.
- Ainda não recebemos credenciais sandbox, MID/IDs de parceiro, permissões ou contratos operacionais para certificar um provedor de ponta a ponta.
- O cadastro atual de comerciante/carteira não completa todo o KYC/KYB dinâmico exigido por cada corredor e provedor.
- Webhooks de saída para sistemas dos comerciantes ainda não foram implementados.
- Sessão do painel agora usa cookie HttpOnly e CSRF. Ainda falta implementar revogação centralizada por sessão/JTI; hoje o cookie é limpo no logout e o JWT expira em até 2 horas (usuários desativados ou com papel alterado são bloqueados por consulta ao banco).
- O TOTP está implementado, mas todos os superadministradores precisam habilitá-lo antes da produção e a operação precisa documentar um processo multi-pessoa de break-glass caso todos os fatores de recuperação sejam perdidos.
- O repositório GitHub continua público. Não colocar credenciais, chaves, certificados ou dados reais neste repositório; alterar a visibilidade para Private antes de iniciar homologação com credenciais.
- Faltam teste visual/funcional de navegador, observabilidade/alertas operacionais, runbooks, pentest externo e revisão jurídica/regulatória/fiscal.

## Próximas etapas

1. Escolher e obter aprovação formal do provedor principal para o fluxo marketplace (payin PIX, saldo em USDT e dois payouts).
2. Confirmar a arquitetura de ownership do dinheiro, KYC/KYB, Travel Rule, tarifas, limites e quem é o beneficiário legal de cada perna.
3. Implementar o cliente TransFi v3 atual ou o fluxo Foxbit Partner homologado, sem inventar campos ou endpoints.
4. Construir checkout do pagador com captura segura de dados e onboarding dinâmico para os campos exigidos pelo provedor.
5. Homologar payin, conversão, payouts independentes, webhooks e conciliação com credenciais reais de sandbox.
6. Implementar webhooks de saída seguros para comerciantes e completar o fluxo KYC/KYB.
7. Concluir revogação centralizada de sessões, testes E2E de navegador, pentest e revisão jurídica/regulatória/fiscal.
8. Alterar a visibilidade do repositório para Private e configurar segredos apenas no gerenciador de segredos do ambiente de deploy.
9. Liberar produção somente depois de confirmar os dois payouts, ledger balanceado e reconciliação do saldo do provedor.
