-- Least-privilege access for territorial composer configuration and rotation.
-- Browser clients can only read rows for an authorized tenant. All mutations
-- happen through reviewed RPCs or explicit service-role administration.

ALTER TABLE ap.territorial_composer_features ENABLE ROW LEVEL SECURITY;
ALTER TABLE ap.territorial_composer_templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE ap.territorial_sponsor_rotation_state ENABLE ROW LEVEL SECURITY;
ALTER TABLE ap.territorial_sponsor_reservations ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE
    ap.territorial_composer_features,
    ap.territorial_composer_templates,
    ap.territorial_sponsor_rotation_state,
    ap.territorial_sponsor_reservations
FROM PUBLIC, anon, authenticated, service_role;

GRANT SELECT ON TABLE
    ap.territorial_composer_features,
    ap.territorial_composer_templates,
    ap.territorial_sponsor_rotation_state,
    ap.territorial_sponsor_reservations
TO authenticated, service_role;

GRANT INSERT, UPDATE ON TABLE
    ap.territorial_composer_features,
    ap.territorial_composer_templates
TO service_role;

CREATE POLICY territorial_composer_features_select_own_client
    ON ap.territorial_composer_features
    FOR SELECT
    TO authenticated
    USING (
        cliente_id IN (SELECT ap.get_user_cliente_ids())
    );

CREATE POLICY territorial_composer_templates_select_own_client
    ON ap.territorial_composer_templates
    FOR SELECT
    TO authenticated
    USING (
        cliente_id IN (SELECT ap.get_user_cliente_ids())
    );

CREATE POLICY territorial_sponsor_rotation_state_select_own_client
    ON ap.territorial_sponsor_rotation_state
    FOR SELECT
    TO authenticated
    USING (
        cliente_id IN (SELECT ap.get_user_cliente_ids())
    );

CREATE POLICY territorial_sponsor_reservations_select_own_client
    ON ap.territorial_sponsor_reservations
    FOR SELECT
    TO authenticated
    USING (
        cliente_id IN (SELECT ap.get_user_cliente_ids())
    );
