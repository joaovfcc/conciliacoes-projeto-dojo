# Matriz de rastreabilidade do PRD

## Requisitos funcionais

| Requisito | Implementação | Testes/evidência | Status |
|---|---|---|---|
| RF-001 Localização | `discovery.discover_input_files` | `test_discovery_*`, E2E mensal | CONCLUÍDO |
| RF-002 Nomenclatura | regex estrita de razão/extrato | `test_filename_parser_*`, pendência E2E | CONCLUÍDO |
| RF-003 Formato | extensão + formato autorizado por conta | adaptadores CSV/XLSX/OFX | CONCLUÍDO |
| RF-004 Completude | alertas `RAZAO_AUSENTE`/`EXTRATO_AUSENTE` | E2E com extrato inválido | CONCLUÍDO |
| RF-005 Normalização | `normalization` e `adapters` | parsing e arquivos reais pequenos | CONCLUÍDO |
| RF-006 Relacionamento | chaves contábil/bancária da configuração | configuração duplicada e E2E | CONCLUÍDO |
| RF-007 Exata | regra 1 do motor | `test_exact_match_*` | CONCLUÍDO |
| RF-008 Tolerância | regras 2 e 3 por conta | tolerância e documento ausente | CONCLUÍDO |
| RF-009 Classificação | enum `Status`, regras 1–9 | todos os status centrais | CONCLUÍDO |
| RF-010 Evidência | abas detalhadas lado a lado | `test_report_contains_*` | CONCLUÍDO |
| RF-011 Rastreabilidade | IDs, arquivo, linha/FITID e hash | adaptadores e workbook | CONCLUÍDO |
| RF-012 Excel | `ExcelReportGenerator`, oito abas | reabertura real com OpenPyXL | CONCLUÍDO |
| RF-013 Log | log por execução com início/fim/duração/status | E2E valida conteúdo | CONCLUÍDO |
| RF-014 Arquivamento | processados/pendências por período | E2E compara bytes/hashes | CONCLUÍDO |
| RF-015 Duplicidade | hash intraexecução/manifesto e assinaturas | descoberta, reprocessamento, motor | CONCLUÍDO |
| RF-016 Reprocessamento | flag explícita e nomes versionados | E2E sem/sob autorização | CONCLUÍDO |

## Requisitos não funcionais

| Requisito | Implementação | Testes/evidência | Status |
|---|---|---|---|
| RNF-001 Rastreabilidade | origem em todo registro e workbook | integração/Excel | CONCLUÍDO |
| RNF-002 Integridade | leitura somente + hash antes/depois de mover | comparação de bytes E2E | CONCLUÍDO |
| RNF-003 Segurança | sem rede/segredos, formula injection neutralizada | teste específico + `.gitignore` | CONCLUÍDO |
| RNF-004 Usabilidade | CLI, BAT, template e manual | CLI e executável `init` | CONCLUÍDO |
| RNF-005 Manutenibilidade | adaptadores e domínio desacoplados | arquitetura + testes por componente | CONCLUÍDO |
| RNF-006 Testabilidade | 44 testes, cobertura mínima 85% | 89,82% observado | CONCLUÍDO |
| RNF-007 Auditabilidade | regra, tolerância, diferença e fontes | workbook de integração | CONCLUÍDO |
| RNF-008 Desempenho | contagens/duração no log | meta depende de amostra real | BLOQUEADO PARA PILOTO |
| RNF-009 Portabilidade | Python 3.11+, BAT e `.exe` Windows | wheel + exe testado no Windows | CONCLUÍDO |
| RNF-010 Recuperação | erros por registro/arquivo, demais contas seguem | CSV parcialmente inválido e E2E | CONCLUÍDO |

## Critérios de aceite

| Critério do PRD | Evidência | Status |
|---|---|---|
| 1. Importar registros válidos | adaptadores mantêm válidos e reportam inválidos | ATENDIDO |
| 2. Informar rejeitados | `Erros_Tecnicos`, log e pendências | ATENDIDO |
| 3. Contas sem lado oposto | abas de ausência + completude | ATENDIDO |
| 4. Pares exatos | teste unitário e E2E | ATENDIDO |
| 5. Respeitar tolerância | testes de data/valor | ATENDIDO |
| 6. Não reutilizar registro | teste `test_source_record_is_never_reused` | ATENDIDO |
| 7. Detalhar divergência | 32 campos no workbook | ATENDIDO |
| 8. Resumo corresponder ao detalhe | resumo derivado, teste de contagens/saldos | ATENDIDO |
| 9. Apontar arquivo/linha | testes de CSV/XLSX/OFX | ATENDIDO |
| 10. Gerar log | E2E valida conclusão/duração/contagem | ATENDIDO |
| 11. Não alterar originais | bytes iguais após arquivamento | ATENDIDO |
| 12. Reexecução controlada | teste recusa/flag/versionamento | ATENDIDO |
| 13. Excel compreensível | filtros, painéis, estilos e manual | ATENDIDO TECNICAMENTE |
| 14. Aprovação do responsável | requer dois fechamentos e decisão externa | BLOQUEADO PARA PILOTO |

## Bloqueios externos formais

- Tarefa: homologação dos layouts e sinais reais. Motivo/evidência: as amostras bancárias e do
  Protheus não foram disponibilizadas. Necessário: fixtures anonimizadas aprovadas.
- Tarefa: aceite contábil por dois fechamentos. Motivo/evidência: depende de execução paralela
  e decisão do responsável. Necessário: participantes, períodos e resultados do piloto.
- Impacto: não impede uso técnico do MVP, mas impede afirmar homologação contábil ou meta real
  de desempenho.
