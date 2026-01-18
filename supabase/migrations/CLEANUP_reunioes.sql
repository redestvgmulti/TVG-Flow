-- ⚠️ DANGER: THIS WILL DELETE ALL MEETINGS ⚠️
-- Use this query to clean up test data before handing over to the client.

TRUNCATE TABLE reunioes CASCADE;

-- Note: 'CASCADE' ensures that related 'reunioes_participantes' are also deleted.
