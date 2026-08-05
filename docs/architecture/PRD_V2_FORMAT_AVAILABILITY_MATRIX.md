# Matriz de disponibilidade de formatos — PRD V2

Atualizada em: 2026-08-04

## Regra de leitura

O corpus privado atual contém 68 PDFs e nenhum OFX, CSV bancário ou XLSX bancário. O razão XLSX do
ERP é fonte contábil e não conta como formato de extrato. Portanto, nenhuma instituição pode ser
declarada suportada em formato estruturado neste momento.

A dimensão de conta está tecnicamente preparada, mas bloqueada como
`AWAITING_PRIVATE_ACCOUNT_MANIFEST`: o manifesto privado deverá mapear SHA-256 de documento para uma
referência opaca de conta. Números reais de agência/conta e a relação hash-conta não entrarão no Git.
Depois do manifesto, cada linha agregada será expandida por referência de conta.

## Matriz inicial

| Instituição | Conta | PDF | OFX | CSV | XLSX bancário | Preferência atual | PDF obrigatório | Fallback |
|---|---|---:|---|---|---|---|---|---|
| ABC Brasil | `AWAITING_PRIVATE_ACCOUNT_MANIFEST` | 4 | `NOT_PROVIDED` | `NOT_PROVIDED` | `NOT_PROVIDED` | PDF textual | Sim | CSV homologado |
| Banco do Brasil | `AWAITING_PRIVATE_ACCOUNT_MANIFEST` | 2 | `NOT_PROVIDED` | `NOT_PROVIDED` | `NOT_PROVIDED` | PDF textual | Sim | CSV homologado |
| BMG | `AWAITING_PRIVATE_ACCOUNT_MANIFEST` | 5 | `NOT_PROVIDED` | `NOT_PROVIDED` | `NOT_PROVIDED` | PDF textual | Sim | CSV homologado |
| BMP | `AWAITING_PRIVATE_ACCOUNT_MANIFEST` | 1 | `NOT_PROVIDED` | `NOT_PROVIDED` | `NOT_PROVIDED` | PDF textual | Sim | CSV homologado |
| Bocom | `AWAITING_PRIVATE_ACCOUNT_MANIFEST` | 2 | `NOT_PROVIDED` | `NOT_PROVIDED` | `NOT_PROVIDED` | PDF textual/OCR | Sim | CSV homologado |
| Bradesco | `AWAITING_PRIVATE_ACCOUNT_MANIFEST` | 9 | `NOT_PROVIDED` | `NOT_PROVIDED` | `NOT_PROVIDED` | PDF textual/OCR | Sim | CSV homologado |
| BRB | `AWAITING_PRIVATE_ACCOUNT_MANIFEST` | 1 | `NOT_PROVIDED` | `NOT_PROVIDED` | `NOT_PROVIDED` | PDF textual | Sim | CSV homologado |
| Caixa | `AWAITING_PRIVATE_ACCOUNT_MANIFEST` | 3 | `NOT_PROVIDED` | `NOT_PROVIDED` | `NOT_PROVIDED` | PDF textual | Sim | CSV homologado |
| Daycoval | `AWAITING_PRIVATE_ACCOUNT_MANIFEST` | 3 | `NOT_PROVIDED` | `NOT_PROVIDED` | `NOT_PROVIDED` | PDF textual | Sim | CSV homologado |
| Guanabara | `AWAITING_PRIVATE_ACCOUNT_MANIFEST` | 2 | `NOT_PROVIDED` | `NOT_PROVIDED` | `NOT_PROVIDED` | PDF textual | Sim | CSV homologado |
| Itaú | `AWAITING_PRIVATE_ACCOUNT_MANIFEST` | 2 | `NOT_PROVIDED` | `NOT_PROVIDED` | `NOT_PROVIDED` | PDF com OCR | Sim | CSV homologado |
| Paulista | `AWAITING_PRIVATE_ACCOUNT_MANIFEST` | 2 | `NOT_PROVIDED` | `NOT_PROVIDED` | `NOT_PROVIDED` | PDF textual | Sim | CSV homologado |
| Pine | `AWAITING_PRIVATE_ACCOUNT_MANIFEST` | 3 | `NOT_PROVIDED` | `NOT_PROVIDED` | `NOT_PROVIDED` | PDF textual | Sim | CSV homologado |
| Planner | `AWAITING_PRIVATE_ACCOUNT_MANIFEST` | 2 | `NOT_PROVIDED` | `NOT_PROVIDED` | `NOT_PROVIDED` | PDF protegido | Sim | Credencial/cópia legítima |
| Safra | `AWAITING_PRIVATE_ACCOUNT_MANIFEST` | 17 | `NOT_PROVIDED` | `NOT_PROVIDED` | `NOT_PROVIDED` | PDF textual/OCR | Sim | CSV homologado |
| Santander | `AWAITING_PRIVATE_ACCOUNT_MANIFEST` | 2 | `NOT_PROVIDED` | `NOT_PROVIDED` | `NOT_PROVIDED` | PDF textual/OCR | Sim | CSV homologado |
| Sofisa | `AWAITING_PRIVATE_ACCOUNT_MANIFEST` | 6 | `NOT_PROVIDED` | `NOT_PROVIDED` | `NOT_PROVIDED` | PDF textual | Sim | CSV homologado |
| Vórtx | `AWAITING_PRIVATE_ACCOUNT_MANIFEST` | 2 | `NOT_PROVIDED` | `NOT_PROVIDED` | `NOT_PROVIDED` | PDF textual | Sim | CSV homologado |

## Amostras estruturadas necessárias

Para cada uma das 18 instituições, deve ser fornecida uma amostra real e autorizada do formato que o
banco efetivamente exportar, preferencialmente OFX, depois CSV e depois XLSX bancário. A amostra deve
ter o PDF correspondente e um oráculo contábil revisado. Receber a amostra muda o status para
`SAMPLE_RECEIVED`; somente adapter, testes, crosscheck e oráculo aprovados mudam para `HOMOLOGATED`.

Enquanto as amostras não forem fornecidas, a infraestrutura CSV genérica pode avançar com fixtures
sintéticas e terminar como `TECHNICALLY_READY_AWAITING_SAMPLE`, sem atribuir suporte a banco algum.

