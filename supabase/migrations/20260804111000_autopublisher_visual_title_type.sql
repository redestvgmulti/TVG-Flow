-- Explicit visual-title type with a fail-closed backfill.
--
-- The column is nullable while existing rows are classified. Only after the
-- classification is proven complete do we install the final constraint,
-- default and NOT NULL contract.

ALTER TABLE ap.visual_titles
    ADD COLUMN IF NOT EXISTS tipo text;

UPDATE ap.visual_titles AS title
SET tipo = CASE
    WHEN ap.normalize_territorial_name(group_row.nome) = 'cidades'
        THEN 'cidade'
    WHEN ap.normalize_territorial_name(group_row.nome) IN (
        'editorial',
        'estados/mundo',
        'eventos'
    )
        THEN 'editorial'
    ELSE title.tipo
END
FROM ap.visual_title_groups AS group_row
WHERE group_row.id = title.group_id
  AND group_row.cliente_id = title.cliente_id
  AND title.tipo IS NULL;

DO $backfill$
DECLARE
    v_unclassified_count integer;
BEGIN
    SELECT count(*)::integer
    INTO v_unclassified_count
    FROM ap.visual_titles
    WHERE tipo IS NULL;

    IF v_unclassified_count <> 0 THEN
        RAISE EXCEPTION
            'VISUAL_TITLE_TYPE_BACKFILL_INCOMPLETE count=%',
            v_unclassified_count
            USING ERRCODE = '23514';
    END IF;
END;
$backfill$;

ALTER TABLE ap.visual_titles
    DROP CONSTRAINT IF EXISTS visual_titles_tipo_check;
ALTER TABLE ap.visual_titles
    ADD CONSTRAINT visual_titles_tipo_check
    CHECK (tipo IN ('editorial', 'cidade'));
ALTER TABLE ap.visual_titles
    ALTER COLUMN tipo SET DEFAULT 'editorial';
ALTER TABLE ap.visual_titles
    ALTER COLUMN tipo SET NOT NULL;

CREATE INDEX IF NOT EXISTS idx_visual_titles_cliente_tipo_active
    ON ap.visual_titles (cliente_id, tipo, ordem, nome)
    WHERE ativo;

COMMENT ON COLUMN ap.visual_titles.tipo IS
    'Explicit administrative classification. Allowed values: editorial or cidade.';
