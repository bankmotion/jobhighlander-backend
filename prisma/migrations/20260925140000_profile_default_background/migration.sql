-- The profile's default resume background, mirroring `default_template_key`.
--
-- Nullable with no default: NULL means "never chosen", which renders plain.
-- That is deliberately distinct from the explicit key 'none', so that if the
-- product default ever changes, a profile that actively chose no background
-- keeps it rather than being swept along.
ALTER TABLE `profiles` ADD COLUMN `default_background` VARCHAR(64) NULL;
