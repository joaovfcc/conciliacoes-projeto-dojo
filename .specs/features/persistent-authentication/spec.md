# Autenticação persistente e acesso multicontas

**Status**: Aprovado em 2026-08-13

## Problema

O produto possui sessões públicas temporárias e credenciais V2 assinadas sem identidade persistida. Isso impede login, revogação, gestão de usuários, autorização atualizada por empresa e recuperação auditável das conciliações.

## Objetivos

- exigir autenticação para qualquer conciliação;
- administrar usuários por organização e papéis operacionais por empresa;
- manter access tokens fora de Web Storage e permitir renovação segura da sessão;
- persistir resultados e evidências por um ano sem reter uploads além do processamento;
- aplicar limites de abuso atômicos aos endpoints sensíveis.

## Fora de escopo

| Capacidade | Motivo |
| --- | --- |
| Cadastro público | Usuários serão provisionados por `OWNER` |
| Convites e reset por e-mail | Não há infraestrutura de e-mail nesta entrega |
| SSO, OAuth ou MFA | Provedor corporativo continua desacoplado |
| Compatibilidade com token V2 de dois segmentos | Não existem consumidores externos |
| Migração sem interrupção de dados produtivos | Não há banco produtivo a preservar |

## Decisões confirmadas

| Tema | Decisão | Motivo |
| --- | --- | --- |
| Acesso | Login obrigatório | Remove a fronteira pública incompatível com persistência |
| Provisionamento | `OWNER` cria usuários; primeiro `OWNER` via comando bootstrap | Evita cadastro público e endpoint inicial exposto |
| Tenant | `ConfigOrganization` | É o agregado administrativo existente |
| Empresa | `ConfigLegalEntity` com projeção operacional `Company` | Preserva os casos de uso persistentes existentes |
| Papéis | `OWNER` no tenant; `PREPARER`, `REVIEWER`, `ADMIN`, `AUDITOR` por empresa | Mantém menor privilégio e segregação financeira |
| Senha | Temporária e troca obrigatória no primeiro acesso; reset pelo `OWNER` | Não depende de e-mail |
| Sessão | Access JWT 10 min; inatividade 8 h; absoluto 24 h | Jornada financeira sem sessão longa |
| Retenção | Resultado e evidência por 1 ano; uploads temporários | Recuperação auditável com exposição limitada |
| Open questions | Nenhuma | Todas as decisões de produto foram confirmadas |

## Requisitos

| ID | Requisito | Critério de aceite |
| --- | --- | --- |
| AUTH-01 | Login obrigatório | WHEN uma rota protegida é chamada sem credencial válida THEN o sistema SHALL responder `401` e não executar a operação |
| AUTH-02 | Senhas seguras | WHEN uma senha é criada THEN o sistema SHALL persistir somente hash Argon2id; login com e-mail inexistente ou senha inválida SHALL produzir a mesma resposta pública |
| AUTH-03 | Bootstrap | WHEN não existe `OWNER` e o comando recebe configuração válida THEN SHALL criar organização, usuário e membership atomicamente; repetição SHALL falhar sem criar duplicatas |
| AUTH-04 | Sessão | WHEN o login é válido THEN SHALL emitir access JWT de 10 minutos e refresh opaco em cookie `HttpOnly`; nenhum token SHALL ser salvo em `localStorage` ou `sessionStorage` |
| AUTH-05 | Rotação | WHEN um refresh válido é usado THEN SHALL consumi-lo e emitir substituto atomicamente; reutilização SHALL revogar a família inteira |
| AUTH-06 | Expiração e revogação | WHEN a sessão excede 8 h inativa ou 24 h absoluta, o usuário é desabilitado, a senha muda ou ocorre logout THEN SHALL rejeitar refresh e acesso subsequente |
| AUTH-07 | CSRF e cache | WHEN login, refresh, logout ou troca de senha respondem THEN SHALL usar `Cache-Control: no-store`; operações autenticadas por cookie SHALL validar origem |
| AUTH-08 | Autorização tenant | WHEN um usuário sem `OWNER` administra usuários ou empresas THEN SHALL responder `403` |
| AUTH-09 | Autorização empresa | WHEN uma operação informa empresa THEN SHALL resolver membership persistida e exigir o papel adequado, sem confiar em papéis do request/JWT |
| AUTH-10 | Troca obrigatória | WHEN usuário com senha temporária autentica THEN SHALL permitir somente consulta da sessão, troca de senha e logout até concluir a troca |
| AUTH-11 | Rate limit | WHEN os limites de login, refresh, senha ou criação de conciliação são excedidos THEN SHALL responder `429` com `Retry-After`; chaves SHALL usar hashes de IP/e-mail/usuário |
| AUTH-12 | Persistência | WHEN uma conciliação autenticada conclui THEN SHALL vincular resultado a organização, empresa e usuário por um ano e eliminar arquivos temporários |
| AUTH-13 | Client | WHEN a página inicia THEN SHALL renovar a sessão por cookie, manter access JWT em memória, realizar no máximo um refresh concorrente e apresentar login/logout/troca de senha |
| AUTH-14 | Migração V2 | WHEN uma rota V2 recebe o token HMAC legado de dois segmentos THEN SHALL rejeitá-lo; apenas o JWT padrão autenticado será aceito |

## Edge cases

- Refreshes concorrentes permitem exatamente um sucesso.
- Alteração de papel passa a valer sem depender dos papéis presentes no JWT.
- Usuário desabilitado não consegue login nem refresh.
- E-mail é normalizado com `trim` e lowercase antes de unicidade e rate limit.
- Redis indisponível nos endpoints protegidos por limite falha fechado com `503`.
- Cookie `Secure` é obrigatório em produção e configurável para HTTP local.
- Respostas e logs nunca incluem senha, hash, JWT, refresh token, cookie ou cabeçalho `Authorization`.

## Dimensões implícitas

| Dimensão | Resolução |
| --- | --- |
| Validação | Zod na borda; e-mail normalizado; senha entre 12 e 128 caracteres |
| Falhas parciais | Bootstrap e rotação transacionais; falha não deixa token parcialmente consumido |
| Idempotência | Bootstrap recusa repetição; logout é idempotente |
| Auth/rate limit | AUTH-01, AUTH-08, AUTH-09 e AUTH-11 |
| Concorrência | Refresh atomizado e refresh único no client |
| Ciclo de vida | 10 min/8 h/24 h e retenção anual |
| Observabilidade | Eventos técnicos estruturados e redigidos; sem segredos |
| Dependências externas | Redis falha fechado para limites; PostgreSQL é obrigatório |
| Transições | Ativa/desabilitada, troca obrigatória e sessão ativa/revogada/expirada |

## Rastreabilidade

Todos os requisitos `AUTH-01` a `AUTH-14` estão mapeados em `tasks.md`.

## Sucesso

- todas as rotas de autenticação e V2 possuem testes de sucesso, acesso negado e falha documentada;
- Prisma valida e migra uma base PostgreSQL vazia;
- lint, typecheck, build e suítes existentes passam sem reduzir cobertura;
- teste de browser comprova que nenhum token é persistido em Web Storage.
