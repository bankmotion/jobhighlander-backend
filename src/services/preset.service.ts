import { prisma } from '../lib/prisma';
import { FALLBACK_PRESET, LAYOUTS, type Preset } from '../resume/templates/registry';
import { ACCENTS, DENSITIES, FONT_PAIRS } from '../resume/tokens';

/**
 * Presets are DATA (rows) built from LAYOUTS (compiled components). Adding one
 * is an insert; adding a layout is a deploy. Everything below assumes a row can
 * be wrong — an unknown layout, font or density degrades to the default rather
 * than failing a render.
 */
export const presetService = {
  /** Everything the picker shows, ordered for display. */
  async list(): Promise<Preset[]> {
    const rows = await prisma.templatePreset.findMany({
      where: { archived: false },
      orderBy: [{ category: 'asc' }, { sortOrder: 'asc' }],
    });
    return rows.length ? rows.map(toPreset) : [FALLBACK_PRESET];
  },

  /** One preset by key, or the fallback when it is missing or archived. */
  async get(key: string | null | undefined): Promise<Preset> {
    if (!key) return FALLBACK_PRESET;
    const row = await prisma.templatePreset.findFirst({ where: { key, archived: false } });
    return row ? toPreset(row) : FALLBACK_PRESET;
  },

  /** The preset a profile renders with. */
  async forProfile(profileId: number, ownerId: number): Promise<Preset> {
    const profile = await prisma.profile.findFirst({
      where: { id: profileId, ownerId },
      select: { defaultTemplateKey: true },
    });
    return this.get(profile?.defaultTemplateKey);
  },

  /** Set a profile's default. Rejects an unknown key rather than storing it. */
  async setDefault(profileId: number, ownerId: number, key: string): Promise<boolean> {
    const exists = await prisma.templatePreset.findFirst({
      where: { key, archived: false },
      select: { id: true },
    });
    if (!exists) return false;
    const r = await prisma.profile.updateMany({
      where: { id: profileId, ownerId },
      data: { defaultTemplateKey: key },
    });
    return r.count > 0;
  },

  /** Seed the starter set. Idempotent — safe to re-run after adding layouts. */
  async seed(): Promise<number> {
    let n = 0;
    for (const p of SEED) {
      await prisma.templatePreset.upsert({
        where: { key: p.key },
        create: p,
        // Name/order/flags are curatable in the DB; re-seeding must not stomp
        // an admin's edits, so only the render parameters are refreshed.
        update: {
          layout: p.layout, accent: p.accent, fontPair: p.fontPair,
          density: p.density, atsSafe: p.atsSafe,
        },
      });
      n++;
    }
    return n;
  },
};

function toPreset(r: {
  key: string; name: string; category: string; layout: string;
  accent: string; fontPair: string; density: string; atsSafe: boolean;
}): Preset {
  return {
    key: r.key, name: r.name, category: r.category, layout: r.layout,
    accent: r.accent, fontPair: r.fontPair, density: r.density, atsSafe: r.atsSafe,
  };
}

/**
 * Five presets in the `classic` category, all on the one layout that exists.
 * They differ on accent, type pairing and density — which is the whole point of
 * the parameter engine: the visual range comes from tokens, not from five
 * near-identical components nobody can maintain.
 */
const SEED = [
  // classic - serif, conservative. Law, finance, government, academia.
  { key: 'classic-ink', name: 'Classic Ink', category: 'classic', layout: 'classic',
    accent: ACCENTS.ink, fontPair: 'serif-classic', density: 'regular', atsSafe: true, sortOrder: 1 },
  { key: 'classic-navy', name: 'Classic Navy', category: 'classic', layout: 'classic',
    accent: ACCENTS.navy, fontPair: 'serif-sans', density: 'regular', atsSafe: true, sortOrder: 2 },
  { key: 'classic-pine', name: 'Classic Pine', category: 'classic', layout: 'classic',
    accent: ACCENTS.pine, fontPair: 'slab-sans', density: 'regular', atsSafe: true, sortOrder: 3 },
  { key: 'classic-compact', name: 'Classic Compact', category: 'classic', layout: 'classic',
    accent: ACCENTS.slate, fontPair: 'sans-modern', density: 'compact', atsSafe: true, sortOrder: 4 },
  { key: 'classic-airy', name: 'Classic Airy', category: 'classic', layout: 'classic',
    accent: ACCENTS.burgundy, fontPair: 'sans-humanist', density: 'airy', atsSafe: true, sortOrder: 5 },

  // modern - sans with an accent rule. Tech and startups, most of the corpus.
  { key: 'modern-pine', name: 'Modern Pine', category: 'modern', layout: 'modern',
    accent: ACCENTS.pine, fontPair: 'sans-modern', density: 'regular', atsSafe: true, sortOrder: 1 },
  { key: 'modern-navy', name: 'Modern Navy', category: 'modern', layout: 'modern',
    accent: ACCENTS.navy, fontPair: 'sans-humanist', density: 'regular', atsSafe: true, sortOrder: 2 },
  { key: 'modern-slate', name: 'Modern Slate', category: 'modern', layout: 'modern',
    accent: ACCENTS.slate, fontPair: 'sans-modern', density: 'compact', atsSafe: true, sortOrder: 3 },
  { key: 'modern-bronze', name: 'Modern Bronze', category: 'modern', layout: 'modern',
    accent: ACCENTS.bronze, fontPair: 'serif-sans', density: 'regular', atsSafe: true, sortOrder: 4 },
  { key: 'modern-airy', name: 'Modern Airy', category: 'modern', layout: 'modern',
    accent: ACCENTS.ink, fontPair: 'sans-humanist', density: 'airy', atsSafe: true, sortOrder: 5 },

  // professional - tinted bands, right-aligned dates. Management, consulting.
  { key: 'professional-navy', name: 'Executive Navy', category: 'professional', layout: 'professional',
    accent: ACCENTS.navy, fontPair: 'serif-sans', density: 'regular', atsSafe: true, sortOrder: 1 },
  { key: 'professional-burgundy', name: 'Executive Burgundy', category: 'professional', layout: 'professional',
    accent: ACCENTS.burgundy, fontPair: 'serif-classic', density: 'regular', atsSafe: true, sortOrder: 2 },
  { key: 'professional-pine', name: 'Executive Pine', category: 'professional', layout: 'professional',
    accent: ACCENTS.pine, fontPair: 'slab-sans', density: 'regular', atsSafe: true, sortOrder: 3 },
  { key: 'professional-dense', name: 'Executive Dense', category: 'professional', layout: 'professional',
    accent: ACCENTS.slate, fontPair: 'sans-modern', density: 'compact', atsSafe: true, sortOrder: 4 },
  { key: 'professional-ink', name: 'Executive Ink', category: 'professional', layout: 'professional',
    accent: ACCENTS.ink, fontPair: 'serif-classic', density: 'airy', atsSafe: true, sortOrder: 5 },

  // creative - coloured sidebar. atsSafe is FALSE: extraction reads the sidebar
  // before the experience, and no markup change alters that.
  { key: 'creative-pine', name: 'Creative Pine', category: 'creative', layout: 'creative',
    accent: ACCENTS.pine, fontPair: 'sans-humanist', density: 'regular', atsSafe: false, sortOrder: 1 },
  { key: 'creative-burgundy', name: 'Creative Burgundy', category: 'creative', layout: 'creative',
    accent: ACCENTS.burgundy, fontPair: 'sans-modern', density: 'regular', atsSafe: false, sortOrder: 2 },
  { key: 'creative-navy', name: 'Creative Navy', category: 'creative', layout: 'creative',
    accent: ACCENTS.navy, fontPair: 'serif-sans', density: 'regular', atsSafe: false, sortOrder: 3 },
  { key: 'creative-bronze', name: 'Creative Bronze', category: 'creative', layout: 'creative',
    accent: ACCENTS.bronze, fontPair: 'sans-humanist', density: 'compact', atsSafe: false, sortOrder: 4 },
  { key: 'creative-slate', name: 'Creative Slate', category: 'creative', layout: 'creative',
    accent: ACCENTS.slate, fontPair: 'sans-modern', density: 'airy', atsSafe: false, sortOrder: 5 },
] satisfies Array<Preset & { sortOrder: number }>;

/** Exposed so an admin UI can offer the same choices the renderer understands. */
export const PARAMETER_SPACE = {
  layouts: Object.entries(LAYOUTS).map(([key, l]) => ({ key, name: l.name })),
  fontPairs: Object.entries(FONT_PAIRS).map(([key, f]) => ({ key, name: f.name })),
  densities: Object.entries(DENSITIES).map(([key, d]) => ({ key, name: d.name })),
  accents: ACCENTS,
};
