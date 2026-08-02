-- Proves that the structural migration changed definitions only, not live rows.
DO $structural_assertions$
BEGIN
    IF EXISTS (
        (
            SELECT before.row_data FROM master_rows_before AS before
            EXCEPT ALL
            SELECT to_jsonb(c) - 'sponsor_count'
            FROM ap.master_render_configs AS c
        )
        UNION ALL
        (
            SELECT to_jsonb(c) - 'sponsor_count'
            FROM ap.master_render_configs AS c
            EXCEPT ALL
            SELECT before.row_data FROM master_rows_before AS before
        )
    ) THEN
        RAISE EXCEPTION 'STRUCTURAL_MIGRATION_CHANGED_MASTER_ROWS';
    END IF;

    IF EXISTS (
        SELECT 1
        FROM ap.master_render_configs AS c
        JOIN master_rows_before AS before
          ON before.row_data ->> 'id' = c.id::text
        WHERE c.sponsor_count IS NOT NULL
    ) THEN
        RAISE EXCEPTION 'STRUCTURAL_MIGRATION_BACKFILLED_SPONSOR_COUNT';
    END IF;

    IF EXISTS (
        (
            SELECT before.row_data FROM visual_title_rows_before AS before
            EXCEPT ALL
            SELECT to_jsonb(t) FROM ap.visual_titles AS t
        )
        UNION ALL
        (
            SELECT to_jsonb(t) FROM ap.visual_titles AS t
            EXCEPT ALL
            SELECT before.row_data FROM visual_title_rows_before AS before
        )
    ) THEN
        RAISE EXCEPTION 'STRUCTURAL_MIGRATION_CHANGED_VISUAL_TITLES';
    END IF;

    IF EXISTS (
        (
            SELECT before.row_data FROM sponsor_membership_rows_before AS before
            EXCEPT ALL
            SELECT to_jsonb(m) FROM ap.render_sponsor_scope_memberships AS m
        )
        UNION ALL
        (
            SELECT to_jsonb(m) FROM ap.render_sponsor_scope_memberships AS m
            EXCEPT ALL
            SELECT before.row_data FROM sponsor_membership_rows_before AS before
        )
    ) THEN
        RAISE EXCEPTION 'STRUCTURAL_MIGRATION_CHANGED_SPONSOR_MEMBERSHIPS';
    END IF;

    IF EXISTS (
        (
            SELECT before.row_data FROM sponsor_cursor_rows_before AS before
            EXCEPT ALL
            SELECT to_jsonb(state) FROM ap.render_sponsor_rotation_state AS state
        )
        UNION ALL
        (
            SELECT to_jsonb(state) FROM ap.render_sponsor_rotation_state AS state
            EXCEPT ALL
            SELECT before.row_data FROM sponsor_cursor_rows_before AS before
        )
    ) THEN
        RAISE EXCEPTION 'STRUCTURAL_MIGRATION_CHANGED_SPONSOR_CURSORS';
    END IF;

    IF EXISTS (
        (
            SELECT before.row_data FROM candidate_rows_before AS before
            EXCEPT ALL
            SELECT to_jsonb(news) FROM ap.candidate_news AS news
        )
        UNION ALL
        (
            SELECT to_jsonb(news) FROM ap.candidate_news AS news
            EXCEPT ALL
            SELECT before.row_data FROM candidate_rows_before AS before
        )
    ) THEN
        RAISE EXCEPTION 'STRUCTURAL_MIGRATION_CHANGED_CANDIDATES';
    END IF;

    IF NOT EXISTS (
        SELECT 1
        FROM ap.master_render_configs AS c
        WHERE c.cliente_id = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'::uuid
          AND c.visual_model = 'misto'
          AND c.master_template_uuid = 'tenant-b-misto-template'
          AND c.enabled
          AND c.sponsor_count IS NULL
    ) THEN
        RAISE EXCEPTION 'STRUCTURAL_MIGRATION_CHANGED_TENANT_B';
    END IF;
END;
$structural_assertions$;
