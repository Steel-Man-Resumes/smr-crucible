/**
 * Tenant Configuration
 *
 * Controls branding, geography, content labels, and feature flags.
 * Default: Steel Man Resumes (SMR).
 * To deploy for another org: create a JSON file matching TenantConfig,
 * set TENANT_CONFIG_PATH env var, and deploy.
 */

export interface TenantGeo {
  primaryLocations: string[];
  searchRadiusMiles: number;
  state: string;
  stateFullName: string;
}

export interface TenantConfig {
  // Branding
  orgName: string;
  orgShortName: string;
  orgTagline: string;
  logoPath: string;
  contactEmail: string;
  contactPhone?: string;
  website: string;
  partnerBrand: {
    name: string;
    descriptor: string;
    logoPath?: string;
    primaryColor: string;
    isPlaceholder: boolean;
  };

  // Geography
  geo: TenantGeo;

  // Labels (for white-label renaming)
  assistantName: string;
  forgeLabel: string;
  refineryLabel: string;

  // Feature flags
  features: {
    rushMode: boolean;
    disclosurePlanner: boolean;
    interviewPractice: boolean;
    jobBoard: boolean;
    applicationTracker: boolean;
    tour: boolean;
    resourceDirectory: boolean;
  };
}

const DEFAULT_TENANT: TenantConfig = {
  orgName: "Steel Man Resumes",
  orgShortName: "Steel Man",
  orgTagline: "Rough. Raw. Real.",
  logoPath: "/images/smr-logo.png",
  // steelmanresumes.com has no MX -- inbound must go to a real inbox.
  contactEmail: "troyrichardcarr@gmail.com",
  website: "https://steelmanresumes.com",
  partnerBrand: {
    name: process.env.NEXT_PUBLIC_PARTNER_NAME || "Your Organization",
    descriptor: process.env.NEXT_PUBLIC_PARTNER_DESCRIPTOR || "Example partner branding",
    logoPath: process.env.NEXT_PUBLIC_PARTNER_LOGO_PATH || undefined,
    primaryColor: process.env.NEXT_PUBLIC_PARTNER_COLOR || "#3f5363",
    isPlaceholder: !process.env.NEXT_PUBLIC_PARTNER_NAME,
  },

  geo: {
    primaryLocations: ["Milwaukee, WI", "Waukesha, WI"],
    searchRadiusMiles: 25,
    state: "WI",
    stateFullName: "Wisconsin",
  },

  assistantName: "t.ROY",
  forgeLabel: "The Forge",
  refineryLabel: "The Refinery",

  features: {
    rushMode: true,
    disclosurePlanner: true,
    interviewPractice: true,
    jobBoard: true,
    applicationTracker: true,
    tour: true,
    resourceDirectory: true,
  },
};

let _cachedConfig: TenantConfig | null = null;

/**
 * Geography override, applied on top of the default tenant.
 *
 * The header above has always told deployers to set TENANT_CONFIG_PATH, but
 * nothing ever read it -- getTenantConfig() returned the hardcoded Milwaukee /
 * Waukesha default unconditionally, so there was no way to run this app for
 * another region without editing source. That is now honored, plus a much
 * smaller env override for the common case of "same product, different state".
 *
 * TENANT_GEO_PRIMARY_LOCATIONS -- comma-separated, e.g. "Butte, MT|Helena, MT"
 *   (pipe-separated entries, because each entry contains a comma)
 * TENANT_GEO_STATE            -- two-letter code, e.g. "MT"
 * TENANT_GEO_STATE_NAME       -- e.g. "Montana"
 * TENANT_GEO_RADIUS_MILES     -- integer; rural regions need a wider ring than
 *                                the 25-mile metro default
 *
 * Anything unset falls back to the default, so a partial override is safe.
 */
function applyGeoOverrides(base: TenantConfig): TenantConfig {
  const rawLocations = process.env.TENANT_GEO_PRIMARY_LOCATIONS;
  const rawState = process.env.TENANT_GEO_STATE;
  const rawStateName = process.env.TENANT_GEO_STATE_NAME;
  const rawRadius = process.env.TENANT_GEO_RADIUS_MILES;

  const locations = rawLocations
    ?.split("|")
    .map((s) => s.trim())
    .filter(Boolean);
  const radius = rawRadius ? Number.parseInt(rawRadius, 10) : NaN;

  if (!locations?.length && !rawState && !rawStateName && !Number.isFinite(radius)) {
    return base;
  }

  return {
    ...base,
    geo: {
      primaryLocations: locations?.length ? locations : base.geo.primaryLocations,
      searchRadiusMiles: Number.isFinite(radius) && radius > 0 ? radius : base.geo.searchRadiusMiles,
      state: rawState?.trim() || base.geo.state,
      stateFullName: rawStateName?.trim() || base.geo.stateFullName,
    },
  };
}

export function getTenantConfig(): TenantConfig {
  if (_cachedConfig) return _cachedConfig;

  let config: TenantConfig = DEFAULT_TENANT;

  // File-based override, as the header has always documented.
  const configPath = process.env.TENANT_CONFIG_PATH;
  if (configPath) {
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const fs = require("fs") as typeof import("fs");
      const parsed = JSON.parse(fs.readFileSync(configPath, "utf8")) as Partial<TenantConfig>;
      config = {
        ...config,
        ...parsed,
        geo: { ...config.geo, ...(parsed.geo ?? {}) },
        features: { ...config.features, ...(parsed.features ?? {}) },
        partnerBrand: { ...config.partnerBrand, ...(parsed.partnerBrand ?? {}) },
      };
    } catch (err) {
      // A broken tenant file must not take the app down -- fall back to the
      // default and make the reason loud in logs.
      console.error(`[tenant-config] TENANT_CONFIG_PATH="${configPath}" not loaded:`, err);
    }
  }

  _cachedConfig = applyGeoOverrides(config);
  return _cachedConfig;
}

// Convenience accessors for common values
export const tenant = {
  get config() {
    return getTenantConfig();
  },
  get orgName() {
    return getTenantConfig().orgName;
  },
  get geo() {
    return getTenantConfig().geo;
  },
  get features() {
    return getTenantConfig().features;
  },
};
