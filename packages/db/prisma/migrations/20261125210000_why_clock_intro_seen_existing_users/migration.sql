-- Issue #606: data-only. The first-sign-in intro "Warum stempeln?" keeps its seen state in
-- "User"."uiPreferences" under the key "whyClockIntroSeen" (written by PUT /api/v1/me/preferences).
-- Everyone who has signed in at least once before this release is marked as having seen it, so no
-- existing person gets the card unasked; a person invited earlier who never signed in
-- ("lastLoginAt" IS NULL), and everyone created later, gets it at their first sign-in.
-- The stored object is merged, never replaced; a non-object value (SQL NULL, JSON null, array,
-- scalar) becomes '{}' first - the same guard as the atomic merge of PUT /me/preferences (#392).
-- Idempotent: a second run writes the same value again. No DDL, no "updatedAt" change.
UPDATE "User"
SET "uiPreferences" = (
      CASE
        WHEN jsonb_typeof("uiPreferences") = 'object' THEN "uiPreferences"
        ELSE '{}'::jsonb
      END
    ) || '{"whyClockIntroSeen": true}'::jsonb
WHERE "lastLoginAt" IS NOT NULL;
