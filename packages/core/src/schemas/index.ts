export { ProfileV1 } from './profile';
export type { ProfileV1 as ProfileV1Type } from './profile';

export { SignalsV1 } from './signals';
export type { SignalsV1 as SignalsV1Type } from './signals';

export { JobsV1 } from './jobs';
export type { JobsV1 as JobsV1Type } from './jobs';

export { EmployersV1, EmployersEnrichedV1 } from './employers';
export type { EmployersV1 as EmployersV1Type, EmployersEnrichedV1 as EmployersEnrichedV1Type } from './employers';

export { MarketV1 } from './market';
export type { MarketV1 as MarketV1Type } from './market';

export { ResourcesV1 } from './resources';
export type { ResourcesV1 as ResourcesV1Type } from './resources';

export { PortfolioPrefsV1, DEFAULT_PORTFOLIO_PREFS } from './portfolioPrefs';
export type { PortfolioPrefsV1 as PortfolioPrefsV1Type } from './portfolioPrefs';

export { RunPlanV1 } from './runplan';
export type { RunPlanV1 as RunPlanV1Type } from './runplan';

export { ArtifactManifestV1 } from './artifactManifest';
export type { ArtifactManifestV1 as ArtifactManifestV1Type } from './artifactManifest';

import { z } from 'zod';
import { ProfileV1 } from './profile';
import { SignalsV1 } from './signals';
import { JobsV1 } from './jobs';
import { EmployersV1 } from './employers';
import { MarketV1 } from './market';
import { ResourcesV1 } from './resources';
import { PortfolioPrefsV1 } from './portfolioPrefs';
import { RunPlanV1 } from './runplan';
import { ArtifactManifestV1 } from './artifactManifest';

/** Registry for runtime Zod validation by data product key */
export const DATA_PRODUCT_SCHEMAS: Record<string, z.ZodType> = {
  'profile.v1': ProfileV1,
  'signals.v1': SignalsV1,
  'jobs.v1': JobsV1,
  'employers.v1': EmployersV1,
  'employers_enriched.v1': EmployersV1,
  'market.v1': MarketV1,
  'resources.v1': ResourcesV1,
  'portfolio_prefs.v1': PortfolioPrefsV1,
  'runplan.v1': RunPlanV1,
  'artifact_manifest.v1': ArtifactManifestV1,
};
