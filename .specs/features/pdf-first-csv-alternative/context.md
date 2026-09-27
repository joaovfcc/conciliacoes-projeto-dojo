# Contexto — fechamento de confiabilidade do PRD V2

**Registrado:** 3 de setembro de 2026  
**Spec:** `.specs/features/pdf-first-csv-alternative/spec.md`  
**Status:** aprovado para execução incremental

## Limite da entrega

Esta etapa fecha lacunas do motor existente. Ela não cria uma segunda aplicação,
não substitui o PRD web e não declara homologação contábil sem oráculo revisado.

## Decisões de negócio

### Matching por valor

- O valor é a chave principal quando for único no escopo lógico e competência.
- A data é evidência. Ela não invalida um par de valor único.
- Documento normalizado é desempate forte para valores repetidos.
- Descrição não autoriza desempate automático.
- Sem candidato único, o resultado é ambíguo e revisável.

### Razão consolidado

- Várias contas físicas podem pertencer ao mesmo escopo contábil lógico.
- A confirmação do vínculo protege contra mistura acidental de contas.
- Vínculo reutilizável precisa ser persistido e auditável.

### IA e n8n

- IA é assistente de revisão, não fonte da verdade contábil.
- A primeira integração, se aprovada no futuro, será pelo worker em modo sombra.
- n8n é avaliado somente para aprovações, notificações e integrações.

## Itens externos conhecidos

- Oráculos privados revisados para parsing e conciliação.
- Amostras autorizadas para instituições e formatos ainda ausentes.
- Ambiente OCR com Tesseract e idioma português.
- Cópias autorizadas sem senha para documentos protegidos.
