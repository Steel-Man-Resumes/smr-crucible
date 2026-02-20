import { z } from 'zod';

const ManifestArtifact = z.object({
  artifact_key: z.string(),
  display_title: z.string(),
  status: z.enum(['pending', 'generating', 'ready', 'needs_review', 'approved', 'rejected', 'failed']),
  order_index: z.number(),
  download_url: z.string().nullable(),
  preview_type: z.enum(['none', 'html', 'pdf_thumb']),
});

const ManifestSection = z.object({
  key: z.string(),
  title: z.string(),
  artifacts: z.array(ManifestArtifact),
});

export const ArtifactManifestV1 = z.object({
  sections: z.array(ManifestSection),
  recommended_next_action: z.string().nullable(),
  package_complete: z.boolean(),
});

export type ArtifactManifestV1 = z.infer<typeof ArtifactManifestV1>;
