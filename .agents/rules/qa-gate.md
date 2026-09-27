---
trigger: always_on
---

# QA Gate

Esta regra deve estar ativa para qualquer tarefa que envolva testes, parsers, matcher, conciliação, normalização, relatórios ou validação de regra de negócio.

Antes de considerar uma tarefa concluída, verifique se existe teste suficiente para provar a regra correta.

Não aceite apenas cobertura numérica.  
Exija testes que falhem caso a regra seja quebrada.

Sempre procurar:

- falso positivo;
- falso negativo;
- cenário ambíguo;
- entrada inválida;
- regressão;
- ausência de evidência;
- comportamento proibido.

Para conciliação contábil, a prioridade é evitar aprovação incorreta.  
É melhor bloquear uma conciliação duvidosa do que aprovar uma divergência como correta.

Nunca aprove alteração em parser ou matcher sem teste negativo.
Nunca aprove alteração em regra de negócio sem teste de regressão.
Nunca aprove mudança crítica sem validação executada ou justificativa clara.