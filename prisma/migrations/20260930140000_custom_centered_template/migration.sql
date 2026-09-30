-- A template built to match a reference resume: "Custom Centered".
--
-- The layout itself is code (src/resume/layouts/centered.tsx) and the font
-- pair is a token ('sans-calibri'); this row is what makes the pair selectable
-- from the templates page and the generator.
--
-- One row, inserted here rather than by re-running the preset seed. The seed
-- upserts EVERY preset it knows and refreshes each one's render parameters,
-- so re-seeding to add one row would also overwrite any layout, accent, font
-- or density an admin has since changed on the other twenty.
--
-- UTC_TIMESTAMP, not CURRENT_TIMESTAMP: the server's clock is three hours
-- ahead of UTC, and every other row's timestamps are written in UTC by the
-- application.
--
-- A backend that predates the layout still serves this row. There it renders
-- with the Classic layout, since an unknown layout key falls back to the
-- default, and looks right once the code is deployed.
INSERT INTO `template_presets`
  (`key`, `name`, `category`, `layout`, `accent`, `fontPair`, `density`,
   `ats_safe`, `sort_order`, `archived`, `created_at`, `updated_at`)
VALUES
  ('custom-centered', 'Custom Centered', 'custom', 'centered', '#111111',
   'sans-calibri', 'regular', 1, 1, 0, UTC_TIMESTAMP(3), UTC_TIMESTAMP(3))
ON DUPLICATE KEY UPDATE `key` = `key`;
