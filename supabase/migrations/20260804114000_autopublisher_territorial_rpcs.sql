-- Transactional territorial administration RPCs.
--
-- Every mutation resolves the tenant from an authenticated membership or from
-- the target row, validates the per-tenant feature flag and keeps city + visual
-- title mutations inside one database transaction.

CREATE OR REPLACE FUNCTION ap.require_territorial_client_access(
    p_cliente_id uuid
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $function$
BEGIN
    IF auth.uid() IS NULL THEN
        RAISE EXCEPTION 'AUTHENTICATION_REQUIRED'
            USING ERRCODE = '42501';
    END IF;

    IF p_cliente_id IS NULL OR NOT EXISTS (
        SELECT 1
        FROM public.clientes AS client
        WHERE client.id = p_cliente_id
    ) THEN
        RAISE EXCEPTION 'CLIENTE_NOT_FOUND'
            USING ERRCODE = '23503';
    END IF;

    IF NOT EXISTS (
        SELECT 1
        FROM ap.get_user_cliente_ids() AS allowed(cliente_id)
        WHERE allowed.cliente_id = p_cliente_id
    ) THEN
        RAISE EXCEPTION 'CLIENT_ACCESS_DENIED'
            USING ERRCODE = '42501';
    END IF;

    IF NOT EXISTS (
        SELECT 1
        FROM ap.system_config AS config
        WHERE config.cliente_id = p_cliente_id
          AND config.territorial_admin_enabled
    ) THEN
        RAISE EXCEPTION 'TERRITORIAL_FEATURE_DISABLED'
            USING ERRCODE = '42501';
    END IF;
END;
$function$;

CREATE OR REPLACE FUNCTION ap.is_valid_territorial_asset(
    p_cliente_id uuid,
    p_kind text,
    p_asset_bucket text,
    p_asset_path text,
    p_asset_version text,
    p_sha256 text,
    p_asset_metadata jsonb
)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
SET search_path = pg_catalog
AS $function$
    SELECT
        p_cliente_id IS NOT NULL
        AND p_kind IN ('regions', 'cities')
        AND p_asset_bucket = 'ap-images'
        AND COALESCE(p_sha256, '') ~ '^[0-9a-f]{64}$'
        AND p_asset_version = substr(p_sha256, 1, 12)
        AND jsonb_typeof(COALESCE(p_asset_metadata, '{}'::jsonb)) = 'object'
        AND p_asset_path ~ (
            '^'
            || p_kind
            || '/'
            || p_cliente_id::text
            || '/[a-z0-9][a-z0-9_-]*/'
            || p_sha256
            || '[.]png$'
        );
$function$;

CREATE OR REPLACE FUNCTION ap.enforce_territorial_city_title()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $function$
DECLARE
    v_title ap.visual_titles%ROWTYPE;
BEGIN
    SELECT *
    INTO v_title
    FROM ap.visual_titles AS title
    WHERE title.id = NEW.visual_title_id
      AND title.cliente_id = NEW.cliente_id;

    IF NOT FOUND
       OR v_title.tipo <> 'cidade'
       OR ap.normalize_territorial_name(v_title.nome)
            IS DISTINCT FROM ap.normalize_territorial_name(NEW.nome)
       OR v_title.slug IS DISTINCT FROM NEW.slug
       OR v_title.asset_bucket IS DISTINCT FROM NEW.asset_bucket
       OR v_title.asset_path IS DISTINCT FROM NEW.asset_path
       OR v_title.asset_version IS DISTINCT FROM NEW.asset_version
       OR v_title.sha256 IS DISTINCT FROM NEW.sha256
       OR v_title.ativo IS DISTINCT FROM NEW.ativo THEN
        RAISE EXCEPTION 'CITY_VISUAL_TITLE_CONTRACT_INVALID'
            USING ERRCODE = '23514';
    END IF;

    RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION ap.protect_managed_city_visual_title()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $function$
BEGIN
    IF EXISTS (
        SELECT 1
        FROM ap.territorial_cities AS city
        WHERE city.visual_title_id = OLD.id
    )
       AND current_setting('ap.territorial_managed_write', true)
            IS DISTINCT FROM 'on'
       AND (
           NEW.nome IS DISTINCT FROM OLD.nome
           OR NEW.slug IS DISTINCT FROM OLD.slug
           OR NEW.asset_bucket IS DISTINCT FROM OLD.asset_bucket
           OR NEW.asset_path IS DISTINCT FROM OLD.asset_path
           OR NEW.asset_version IS DISTINCT FROM OLD.asset_version
           OR NEW.sha256 IS DISTINCT FROM OLD.sha256
           OR NEW.ativo IS DISTINCT FROM OLD.ativo
           OR NEW.tipo IS DISTINCT FROM OLD.tipo
       ) THEN
        RAISE EXCEPTION 'CITY_TITLE_MANAGED_BY_TERRITORIAL_RPC'
            USING ERRCODE = '42501';
    END IF;

    RETURN NEW;
END;
$function$;

CREATE TRIGGER trg_ap_territorial_cities_enforce_title
    BEFORE INSERT OR UPDATE OF
        cliente_id,
        visual_title_id,
        nome,
        slug,
        asset_bucket,
        asset_path,
        asset_version,
        sha256,
        ativo
    ON ap.territorial_cities
    FOR EACH ROW EXECUTE FUNCTION ap.enforce_territorial_city_title();

CREATE TRIGGER trg_ap_visual_titles_protect_managed_city
    BEFORE UPDATE OF
        nome,
        slug,
        asset_bucket,
        asset_path,
        asset_version,
        sha256,
        ativo,
        tipo
    ON ap.visual_titles
    FOR EACH ROW EXECUTE FUNCTION ap.protect_managed_city_visual_title();

CREATE OR REPLACE FUNCTION ap.create_territorial_region(
    p_cliente_id uuid,
    p_nome text,
    p_asset_bucket text,
    p_asset_path text,
    p_asset_version text,
    p_sha256 text,
    p_asset_metadata jsonb DEFAULT '{}'::jsonb,
    p_ativo boolean DEFAULT true
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $function$
DECLARE
    v_nome text := regexp_replace(
        btrim(COALESCE(p_nome, '')),
        '[[:space:]]+',
        ' ',
        'g'
    );
    v_slug text;
    v_region ap.territorial_regions%ROWTYPE;
BEGIN
    PERFORM ap.require_territorial_client_access(p_cliente_id);

    v_slug := ap.slugify_sponsor(v_nome);
    IF length(v_nome) = 0 OR length(v_slug) = 0 THEN
        RAISE EXCEPTION 'REGION_NAME_REQUIRED'
            USING ERRCODE = '22023';
    END IF;

    IF NOT ap.is_valid_territorial_asset(
        p_cliente_id,
        'regions',
        p_asset_bucket,
        p_asset_path,
        p_asset_version,
        p_sha256,
        p_asset_metadata
    ) THEN
        RAISE EXCEPTION 'REGION_ASSET_INVALID'
            USING ERRCODE = '22023';
    END IF;

    INSERT INTO ap.territorial_regions (
        cliente_id,
        nome,
        slug,
        asset_bucket,
        asset_path,
        asset_version,
        sha256,
        asset_metadata,
        ativo
    )
    VALUES (
        p_cliente_id,
        v_nome,
        v_slug,
        p_asset_bucket,
        p_asset_path,
        p_asset_version,
        p_sha256,
        COALESCE(p_asset_metadata, '{}'::jsonb),
        COALESCE(p_ativo, true)
    )
    RETURNING * INTO v_region;

    RETURN to_jsonb(v_region);
END;
$function$;

CREATE OR REPLACE FUNCTION ap.update_territorial_region(
    p_region_id uuid,
    p_nome text,
    p_asset_bucket text,
    p_asset_path text,
    p_asset_version text,
    p_sha256 text,
    p_asset_metadata jsonb DEFAULT '{}'::jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $function$
DECLARE
    v_region ap.territorial_regions%ROWTYPE;
    v_nome text := regexp_replace(
        btrim(COALESCE(p_nome, '')),
        '[[:space:]]+',
        ' ',
        'g'
    );
    v_slug text;
BEGIN
    SELECT *
    INTO v_region
    FROM ap.territorial_regions AS region
    WHERE region.id = p_region_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'REGION_NOT_FOUND'
            USING ERRCODE = 'P0002';
    END IF;

    PERFORM ap.require_territorial_client_access(v_region.cliente_id);

    v_slug := ap.slugify_sponsor(v_nome);
    IF length(v_nome) = 0 OR length(v_slug) = 0 THEN
        RAISE EXCEPTION 'REGION_NAME_REQUIRED'
            USING ERRCODE = '22023';
    END IF;

    IF NOT ap.is_valid_territorial_asset(
        v_region.cliente_id,
        'regions',
        p_asset_bucket,
        p_asset_path,
        p_asset_version,
        p_sha256,
        p_asset_metadata
    ) THEN
        RAISE EXCEPTION 'REGION_ASSET_INVALID'
            USING ERRCODE = '22023';
    END IF;

    UPDATE ap.territorial_regions AS region
    SET nome = v_nome,
        slug = v_slug,
        asset_bucket = p_asset_bucket,
        asset_path = p_asset_path,
        asset_version = p_asset_version,
        sha256 = p_sha256,
        asset_metadata = COALESCE(p_asset_metadata, '{}'::jsonb)
    WHERE region.id = p_region_id
    RETURNING * INTO v_region;

    RETURN to_jsonb(v_region);
END;
$function$;

CREATE OR REPLACE FUNCTION ap.set_territorial_region_active(
    p_region_id uuid,
    p_ativo boolean
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $function$
DECLARE
    v_region ap.territorial_regions%ROWTYPE;
BEGIN
    SELECT *
    INTO v_region
    FROM ap.territorial_regions AS region
    WHERE region.id = p_region_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'REGION_NOT_FOUND'
            USING ERRCODE = 'P0002';
    END IF;

    PERFORM ap.require_territorial_client_access(v_region.cliente_id);

    UPDATE ap.territorial_regions AS region
    SET ativo = COALESCE(p_ativo, false)
    WHERE region.id = p_region_id
    RETURNING * INTO v_region;

    RETURN to_jsonb(v_region);
END;
$function$;

CREATE OR REPLACE FUNCTION ap.create_territorial_city(
    p_region_id uuid,
    p_nome text,
    p_asset_bucket text,
    p_asset_path text,
    p_asset_version text,
    p_sha256 text,
    p_asset_metadata jsonb DEFAULT '{}'::jsonb,
    p_ativo boolean DEFAULT true
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $function$
DECLARE
    v_region ap.territorial_regions%ROWTYPE;
    v_title ap.visual_titles%ROWTYPE;
    v_city ap.territorial_cities%ROWTYPE;
    v_group_id uuid;
    v_order integer;
    v_nome text := regexp_replace(
        btrim(COALESCE(p_nome, '')),
        '[[:space:]]+',
        ' ',
        'g'
    );
    v_slug text;
BEGIN
    SELECT *
    INTO v_region
    FROM ap.territorial_regions AS region
    WHERE region.id = p_region_id
    FOR SHARE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'REGION_NOT_FOUND'
            USING ERRCODE = 'P0002';
    END IF;

    PERFORM ap.require_territorial_client_access(v_region.cliente_id);

    v_slug := ap.slugify_sponsor(v_nome);
    IF length(v_nome) = 0 OR length(v_slug) = 0 THEN
        RAISE EXCEPTION 'CITY_NAME_REQUIRED'
            USING ERRCODE = '22023';
    END IF;

    IF NOT ap.is_valid_territorial_asset(
        v_region.cliente_id,
        'cities',
        p_asset_bucket,
        p_asset_path,
        p_asset_version,
        p_sha256,
        p_asset_metadata
    ) THEN
        RAISE EXCEPTION 'CITY_ASSET_INVALID'
            USING ERRCODE = '22023';
    END IF;

    -- Do not silently duplicate an active city seal already present in the
    -- legacy catalog. Existing seals remain untouched and can be reviewed
    -- before a new city is registered.
    IF EXISTS (
        SELECT 1
        FROM ap.visual_titles AS title
        WHERE title.cliente_id = v_region.cliente_id
          AND title.tipo = 'cidade'
          AND title.ativo
          AND ap.normalize_territorial_name(title.nome)
                = ap.normalize_territorial_name(v_nome)
    ) THEN
        RAISE EXCEPTION 'CITY_VISUAL_TITLE_CONFLICT'
            USING ERRCODE = '23505';
    END IF;

    SELECT group_row.id
    INTO v_group_id
    FROM ap.visual_title_groups AS group_row
    WHERE group_row.cliente_id = v_region.cliente_id
      AND ap.normalize_territorial_name(group_row.nome) = 'cidades'
    ORDER BY group_row.ativo DESC, group_row.ordem, group_row.id
    LIMIT 1;

    SELECT COALESCE(max(title.ordem) + 1, 0)
    INTO v_order
    FROM ap.visual_titles AS title
    WHERE title.cliente_id = v_region.cliente_id
      AND title.group_id IS NOT DISTINCT FROM v_group_id;

    INSERT INTO ap.visual_titles (
        cliente_id,
        nome,
        slug,
        asset_bucket,
        asset_path,
        asset_version,
        sha256,
        ativo,
        ordem,
        formatos,
        group_id,
        tipo
    )
    VALUES (
        v_region.cliente_id,
        v_nome,
        v_slug,
        p_asset_bucket,
        p_asset_path,
        p_asset_version,
        p_sha256,
        COALESCE(p_ativo, true),
        v_order,
        ARRAY['feed', 'reels']::text[],
        v_group_id,
        'cidade'
    )
    RETURNING * INTO v_title;

    INSERT INTO ap.territorial_cities (
        cliente_id,
        region_id,
        nome,
        slug,
        asset_bucket,
        asset_path,
        asset_version,
        sha256,
        asset_metadata,
        visual_title_id,
        ativo
    )
    VALUES (
        v_region.cliente_id,
        v_region.id,
        v_nome,
        v_slug,
        p_asset_bucket,
        p_asset_path,
        p_asset_version,
        p_sha256,
        COALESCE(p_asset_metadata, '{}'::jsonb),
        v_title.id,
        COALESCE(p_ativo, true)
    )
    RETURNING * INTO v_city;

    RETURN jsonb_build_object(
        'city', to_jsonb(v_city),
        'visual_title', to_jsonb(v_title)
    );
END;
$function$;

CREATE OR REPLACE FUNCTION ap.update_territorial_city(
    p_city_id uuid,
    p_region_id uuid,
    p_nome text,
    p_asset_bucket text,
    p_asset_path text,
    p_asset_version text,
    p_sha256 text,
    p_asset_metadata jsonb DEFAULT '{}'::jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $function$
DECLARE
    v_city ap.territorial_cities%ROWTYPE;
    v_region ap.territorial_regions%ROWTYPE;
    v_title ap.visual_titles%ROWTYPE;
    v_nome text := regexp_replace(
        btrim(COALESCE(p_nome, '')),
        '[[:space:]]+',
        ' ',
        'g'
    );
    v_slug text;
BEGIN
    SELECT *
    INTO v_city
    FROM ap.territorial_cities AS city
    WHERE city.id = p_city_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'CITY_NOT_FOUND'
            USING ERRCODE = 'P0002';
    END IF;

    PERFORM ap.require_territorial_client_access(v_city.cliente_id);

    SELECT *
    INTO v_region
    FROM ap.territorial_regions AS region
    WHERE region.id = p_region_id
      AND region.cliente_id = v_city.cliente_id
    FOR SHARE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'REGION_TENANT_MISMATCH'
            USING ERRCODE = '42501';
    END IF;

    v_slug := ap.slugify_sponsor(v_nome);
    IF length(v_nome) = 0 OR length(v_slug) = 0 THEN
        RAISE EXCEPTION 'CITY_NAME_REQUIRED'
            USING ERRCODE = '22023';
    END IF;

    IF NOT ap.is_valid_territorial_asset(
        v_city.cliente_id,
        'cities',
        p_asset_bucket,
        p_asset_path,
        p_asset_version,
        p_sha256,
        p_asset_metadata
    ) THEN
        RAISE EXCEPTION 'CITY_ASSET_INVALID'
            USING ERRCODE = '22023';
    END IF;

    IF EXISTS (
        SELECT 1
        FROM ap.visual_titles AS title
        WHERE title.cliente_id = v_city.cliente_id
          AND title.id <> v_city.visual_title_id
          AND title.tipo = 'cidade'
          AND title.ativo
          AND ap.normalize_territorial_name(title.nome)
                = ap.normalize_territorial_name(v_nome)
    ) THEN
        RAISE EXCEPTION 'CITY_VISUAL_TITLE_CONFLICT'
            USING ERRCODE = '23505';
    END IF;

    PERFORM set_config('ap.territorial_managed_write', 'on', true);

    UPDATE ap.visual_titles AS title
    SET nome = v_nome,
        slug = v_slug,
        asset_bucket = p_asset_bucket,
        asset_path = p_asset_path,
        asset_version = p_asset_version,
        sha256 = p_sha256,
        tipo = 'cidade'
    WHERE title.id = v_city.visual_title_id
      AND title.cliente_id = v_city.cliente_id
    RETURNING * INTO v_title;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'CITY_VISUAL_TITLE_NOT_FOUND'
            USING ERRCODE = '23503';
    END IF;

    UPDATE ap.territorial_cities AS city
    SET region_id = v_region.id,
        nome = v_nome,
        slug = v_slug,
        asset_bucket = p_asset_bucket,
        asset_path = p_asset_path,
        asset_version = p_asset_version,
        sha256 = p_sha256,
        asset_metadata = COALESCE(p_asset_metadata, '{}'::jsonb)
    WHERE city.id = p_city_id
    RETURNING * INTO v_city;

    PERFORM set_config('ap.territorial_managed_write', 'off', true);

    RETURN jsonb_build_object(
        'city', to_jsonb(v_city),
        'visual_title', to_jsonb(v_title)
    );
END;
$function$;

CREATE OR REPLACE FUNCTION ap.set_territorial_city_active(
    p_city_id uuid,
    p_ativo boolean
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $function$
DECLARE
    v_city ap.territorial_cities%ROWTYPE;
    v_title ap.visual_titles%ROWTYPE;
    v_active boolean := COALESCE(p_ativo, false);
BEGIN
    SELECT *
    INTO v_city
    FROM ap.territorial_cities AS city
    WHERE city.id = p_city_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'CITY_NOT_FOUND'
            USING ERRCODE = 'P0002';
    END IF;

    PERFORM ap.require_territorial_client_access(v_city.cliente_id);
    PERFORM set_config('ap.territorial_managed_write', 'on', true);

    UPDATE ap.visual_titles AS title
    SET ativo = v_active,
        tipo = 'cidade'
    WHERE title.id = v_city.visual_title_id
      AND title.cliente_id = v_city.cliente_id
    RETURNING * INTO v_title;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'CITY_VISUAL_TITLE_NOT_FOUND'
            USING ERRCODE = '23503';
    END IF;

    UPDATE ap.territorial_cities AS city
    SET ativo = v_active
    WHERE city.id = p_city_id
    RETURNING * INTO v_city;

    PERFORM set_config('ap.territorial_managed_write', 'off', true);

    RETURN jsonb_build_object(
        'city', to_jsonb(v_city),
        'visual_title', to_jsonb(v_title)
    );
END;
$function$;

CREATE OR REPLACE FUNCTION ap.set_territorial_region_sponsor(
    p_region_id uuid,
    p_sponsor_id uuid,
    p_ativo boolean DEFAULT true
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $function$
DECLARE
    v_region ap.territorial_regions%ROWTYPE;
    v_link ap.territorial_region_sponsors%ROWTYPE;
BEGIN
    SELECT *
    INTO v_region
    FROM ap.territorial_regions AS region
    WHERE region.id = p_region_id
    FOR SHARE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'REGION_NOT_FOUND'
            USING ERRCODE = 'P0002';
    END IF;

    PERFORM ap.require_territorial_client_access(v_region.cliente_id);

    IF NOT EXISTS (
        SELECT 1
        FROM ap.render_sponsors AS sponsor
        WHERE sponsor.id = p_sponsor_id
          AND sponsor.cliente_id = v_region.cliente_id
    ) THEN
        RAISE EXCEPTION 'SPONSOR_TENANT_MISMATCH'
            USING ERRCODE = '42501';
    END IF;

    IF COALESCE(p_ativo, true) THEN
        INSERT INTO ap.territorial_region_sponsors (
            cliente_id,
            region_id,
            sponsor_id,
            ativo,
            removed_at
        )
        VALUES (
            v_region.cliente_id,
            v_region.id,
            p_sponsor_id,
            true,
            NULL
        )
        ON CONFLICT (cliente_id, region_id, sponsor_id)
        DO UPDATE
        SET ativo = true,
            removed_at = NULL
        RETURNING * INTO v_link;
    ELSE
        UPDATE ap.territorial_region_sponsors AS link
        SET ativo = false,
            removed_at = clock_timestamp()
        WHERE link.cliente_id = v_region.cliente_id
          AND link.region_id = v_region.id
          AND link.sponsor_id = p_sponsor_id
          AND link.ativo
        RETURNING * INTO v_link;

        IF NOT FOUND THEN
            RAISE EXCEPTION 'REGION_SPONSOR_ASSOCIATION_NOT_FOUND'
                USING ERRCODE = 'P0002';
        END IF;
    END IF;

    RETURN to_jsonb(v_link);
END;
$function$;

CREATE OR REPLACE FUNCTION ap.set_visual_title_type(
    p_visual_title_id uuid,
    p_tipo text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $function$
DECLARE
    v_title ap.visual_titles%ROWTYPE;
    v_tipo text := lower(btrim(COALESCE(p_tipo, '')));
BEGIN
    SELECT *
    INTO v_title
    FROM ap.visual_titles AS title
    WHERE title.id = p_visual_title_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'VISUAL_TITLE_NOT_FOUND'
            USING ERRCODE = 'P0002';
    END IF;

    PERFORM ap.require_territorial_client_access(v_title.cliente_id);

    IF v_tipo NOT IN ('editorial', 'cidade') THEN
        RAISE EXCEPTION 'VISUAL_TITLE_TYPE_INVALID'
            USING ERRCODE = '22023';
    END IF;

    IF v_tipo <> 'cidade' AND EXISTS (
        SELECT 1
        FROM ap.territorial_cities AS city
        WHERE city.visual_title_id = v_title.id
    ) THEN
        RAISE EXCEPTION 'CITY_TITLE_TYPE_LOCKED'
            USING ERRCODE = '23514';
    END IF;

    PERFORM set_config('ap.territorial_managed_write', 'on', true);

    UPDATE ap.visual_titles AS title
    SET tipo = v_tipo
    WHERE title.id = p_visual_title_id
    RETURNING * INTO v_title;

    PERFORM set_config('ap.territorial_managed_write', 'off', true);

    RETURN to_jsonb(v_title);
END;
$function$;

REVOKE ALL ON FUNCTION ap.require_territorial_client_access(uuid)
FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION ap.is_valid_territorial_asset(
    uuid, text, text, text, text, text, jsonb
) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION ap.enforce_territorial_city_title()
FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION ap.protect_managed_city_visual_title()
FROM PUBLIC, anon, authenticated;

REVOKE ALL ON FUNCTION ap.create_territorial_region(
    uuid, text, text, text, text, text, jsonb, boolean
) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION ap.update_territorial_region(
    uuid, text, text, text, text, text, jsonb
) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION ap.set_territorial_region_active(uuid, boolean)
FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION ap.create_territorial_city(
    uuid, text, text, text, text, text, jsonb, boolean
) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION ap.update_territorial_city(
    uuid, uuid, text, text, text, text, text, jsonb
) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION ap.set_territorial_city_active(uuid, boolean)
FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION ap.set_territorial_region_sponsor(
    uuid, uuid, boolean
) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION ap.set_visual_title_type(uuid, text)
FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION ap.create_territorial_region(
    uuid, text, text, text, text, text, jsonb, boolean
) TO authenticated;
GRANT EXECUTE ON FUNCTION ap.update_territorial_region(
    uuid, text, text, text, text, text, jsonb
) TO authenticated;
GRANT EXECUTE ON FUNCTION ap.set_territorial_region_active(uuid, boolean)
TO authenticated;
GRANT EXECUTE ON FUNCTION ap.create_territorial_city(
    uuid, text, text, text, text, text, jsonb, boolean
) TO authenticated;
GRANT EXECUTE ON FUNCTION ap.update_territorial_city(
    uuid, uuid, text, text, text, text, text, jsonb
) TO authenticated;
GRANT EXECUTE ON FUNCTION ap.set_territorial_city_active(uuid, boolean)
TO authenticated;
GRANT EXECUTE ON FUNCTION ap.set_territorial_region_sponsor(
    uuid, uuid, boolean
) TO authenticated;
GRANT EXECUTE ON FUNCTION ap.set_visual_title_type(uuid, text)
TO authenticated;

COMMENT ON FUNCTION ap.create_territorial_city(
    uuid, text, text, text, text, text, jsonb, boolean
) IS
    'Atomically creates a tenant city and its linked cidade visual title. No candidate, render or rotation row is touched.';
COMMENT ON FUNCTION ap.update_territorial_city(
    uuid, uuid, text, text, text, text, text, jsonb
) IS
    'Atomically updates city name/region/asset and the same linked visual title.';
COMMENT ON FUNCTION ap.set_territorial_city_active(uuid, boolean) IS
    'Atomically synchronizes city and linked visual-title availability.';
COMMENT ON FUNCTION ap.set_territorial_region_active(uuid, boolean) IS
    'Archives/reactivates only the region; child city and visual-title flags are intentionally unchanged.';
COMMENT ON FUNCTION ap.set_territorial_region_sponsor(
    uuid, uuid, boolean
) IS
    'Adds/removes one historical region association without changing sponsor rotation memberships or state.';

NOTIFY pgrst, 'reload schema';
