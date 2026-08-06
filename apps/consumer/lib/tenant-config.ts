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

export function getTenantConfig(): TenantConfig {
  if (_cachedConfig) return _cachedConfig;

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
