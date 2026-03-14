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
  contactEmail: "info@steelmanresumes.com",
  website: "https://steelmanresumes.com",

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

export function getTenantConfig(): TenantConfig {
  if (_cachedConfig) return _cachedConfig;

  // In the future: load from TENANT_CONFIG_PATH env var
  // For now, always return default SMR config
  _cachedConfig = DEFAULT_TENANT;
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
