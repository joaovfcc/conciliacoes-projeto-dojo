# Análise inicial

## Resumo e objetivo

O PRD define um MVP local para comparar lançamentos do razão do Protheus com extratos
bancários entregues manualmente. A aplicação deve descobrir, validar e normalizar arquivos,
conciliar lançamentos por regras conservadoras, gerar um Excel auditável, registrar logs e
arquivar as entradas. Não há banco, API, RPA, autenticação nem interface web.

## Escopo, atores, entradas e saídas

- Atores: analista contábil, revisor/coordenador e equipe de desenvolvimento.
- Entradas: configuração XLSX, razão CSV/XLSX e extratos OFX/CSV/XLSX.
- Saídas: relatório `CONCILIACAO_EMPRESA_AAAAMM.xlsx`, log técnico, manifesto de hashes e
  arquivos preservados em pastas de processados ou pendências.
- Escopo: conciliação um-para-um exata, tolerância de data, valor/data sem documento,
  divergência de valor/data, ausências, ambiguidades e duplicidades.
- Fora do escopo: integração com Protheus/bancos, PDF/OCR, muitos-para-muitos, IA,
  multiusuário, workflow e histórico em banco.

## Regras de negócio

1. Regras são aplicadas da mais segura para a menos segura e um registro não pode ser usado
   duas vezes.
2. Candidatos múltiplos nunca são escolhidos arbitrariamente.
3. Valores monetários usam `Decimal` e datas usam tipos nativos.
4. Todo resultado mantém arquivo, linha/identificador e regra de origem.
5. Hash SHA-256 impede reprocessamento silencioso; reprocessar exige opção explícita.
6. Falhas isoladas são reportadas e as contas válidas continuam quando possível.
7. Erros críticos não movem entradas.

## Requisitos funcionais

Foram identificados RF-001 a RF-016: descoberta; validação de nome, formato e completude;
normalização; relacionamento de contas; regras exata e tolerante; classificação; evidência;
rastreabilidade; Excel; log; arquivamento; duplicidade; e reprocessamento.

## Requisitos não funcionais

Foram identificados RNF-001 a RNF-010: rastreabilidade, integridade, segurança, usabilidade,
manutenibilidade, testabilidade, auditabilidade, desempenho, portabilidade Windows e
recuperação parcial.

## Integrações e dependências

Não existem integrações externas em tempo de execução. Python 3.11+, OpenPyXL, pytest e Ruff
são as únicas dependências. A configuração e os layouts constituem o contrato operacional.

## Riscos, ambiguidades e suposições

- Layouts reais ainda não foram fornecidos. O MVP adotará cabeçalhos canônicos e aliases
  frequentes, com mensagens por linha; novos layouts ficam isolados nos adaptadores.
- O sinal do razão é assumido como `credito - debito` quando não houver `valor` explícito.
- O valor do extrato preserva o sinal informado; `natureza` é derivada do sinal.
- O período é mensal e deve corresponder às datas dos registros.
- A configuração poderá conter múltiplas empresas, mas cada execução gera um relatório por
  empresa encontrada; o primeiro MVP exige uma empresa por arquivo de razão.
- Metas de volume e aprovação do piloto dependem de amostras e da área contábil; não impedem
  a validação técnica com fixtures fictícias.

## Arquitetura inicial

Arquitetura hexagonal leve: CLI/orquestrador na borda, adaptadores de arquivos, domínio puro
para normalização e conciliação, e adaptadores de saída para Excel, logs e arquivamento.
Detalhes estão em `docs/ARCHITECTURE.md`.

