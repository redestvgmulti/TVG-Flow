
UPDATE empresa_profissionais
SET cargo = TRIM(UPPER(
  CASE
    -- ORDEM INVERTIDA (NOME - CARGO): extrair parte 2
    WHEN funcao = 'DANILO - DESIGNER'    THEN 'DESIGNER'
    WHEN funcao = 'EVANDRO - ATENDIMENTO' THEN 'ATENDIMENTO'

    -- PIPE MAL FORMATADO
    WHEN funcao = 'Filmagem|Foto'        THEN 'FILMAGEM / FOTO'

    -- ROLE → sem cargo
    WHEN LOWER(funcao) IN ('membro','staff','admin','administração','administrativo') THEN NULL

    -- CARGO + NOME → extrair cargo (parte antes do -)
    WHEN funcao ILIKE '%-%'              THEN split_part(funcao, '-', 1)

    -- NOMES PUROS → sem cargo definido
    WHEN funcao IN (
      'DANILO','CAROL','PEDRO','FERNANDO','PRISCILA',
      'PERLA','EVANDRO','VITOR','MICHELLE','RAFAEL',
      'JOÃO','CÍNTIA','ALE','ZÉ',
      'RODRIGO','MATHEUS','ALEXANDRE','MICHELE',
      'CINTIA','JOAO'
    ) THEN 'SEM_CARGO'

    -- CARGO LIMPO → usar diretamente
    ELSE funcao
  END
));
;
