/**
 * Stage C Assembly
 *
 * After all Stage B artifact jobs complete:
 * 1. update_manifest — Refresh artifact_manifest.v1 with real file URLs and statuses
 * 2. generate_zip — Bundle all artifacts into a ZIP, upload to R2
 * 3. set_bundle_status — Transition bundle to 'awaiting_review'
 */
import { query, getOne, getRunData, uploadFile, emitEvent, getSignedUrl } from '@crucible/core';
import archiver from 'archiver';

interface ArtifactRow {
  id: string;
  artifact_key: string;
  display_title: string;
  display_section: string;
  preview_type: string;
  order_index: number;
  review_status: string;
  object_key: string;
  byte_size: number;
  mime_type: string;
  file_name: string;
}

interface BundleRow {
  id: string;
  run_id: string;
  org_id: string;
  project_id: string;
  status: string;
}

/**
 * Check if all Stage B jobs for a bundle are complete.
 * Returns the list of completed artifacts if done, null if still pending.
 */
export async function checkBundleComplete(bundleId: string): Promise<ArtifactRow[] | null> {
  // Get all artifacts for this bundle that have file_object_id (i.e., actually generated)
  const artifacts = await query<ArtifactRow>(
    `SELECT a.id, a.artifact_key, a.display_title, a.display_section,
            a.preview_type, a.order_index, a.review_status,
            f.object_key, f.byte_size, f.mime_type,
            SPLIT_PART(f.object_key, '/', -1) as file_name
     FROM artifact a
     JOIN file_object f ON f.id = a.file_object_id
     WHERE a.bundle_id = $1
     ORDER BY a.order_index ASC`,
    [bundleId]
  );

  // Check if the bundle has an associated run plan to know expected count
  const bundle = await getOne<BundleRow>(
    `SELECT * FROM bundle WHERE id = $1`,
    [bundleId]
  );

  if (!bundle) return null;

  // Check run_data for the run plan
  try {
    const plan = await getRunData<{ tasks: Array<{ artifact_key: string }> }>(bundle.run_id, 'runplan.v1');
    const expectedCount = plan.tasks.length;

    if (artifacts.length >= expectedCount) {
      return artifacts;
    }

    console.log(`[stageC] Bundle ${bundleId}: ${artifacts.length}/${expectedCount} artifacts complete`);
    return null;
  } catch {
    // No run plan — check if we have at least some artifacts
    if (artifacts.length > 0) {
      return artifacts;
    }
    return null;
  }
}

/**
 * Stage C Step 1: Update the artifact manifest with real download URLs and statuses.
 */
export async function updateManifest(
  bundleId: string,
  artifacts: ArtifactRow[]
): Promise<void> {
  const bundle = await getOne<BundleRow>(
    `SELECT * FROM bundle WHERE id = $1`,
    [bundleId]
  );
  if (!bundle) throw new Error(`Bundle ${bundleId} not found`);

  // Group artifacts by section
  const sectionMap: Record<string, {
    key: string;
    title: string;
    artifacts: Array<{
      artifact_key: string;
      display_title: string;
      status: string;
      order_index: number;
      download_url: string | null;
      preview_type: string;
    }>;
  }> = {};

  const SECTION_TITLES: Record<string, string> = {
    start_here: 'Start Here',
    apply: 'Your Documents',
    battle_plan: 'Your Battle Plan',
    interview: 'Interview & Negotiate',
    barriers: 'Your Barriers, Your Strengths',
    online: 'Your Online Presence',
  };

  for (const artifact of artifacts) {
    const section = artifact.display_section || 'apply';
    if (!sectionMap[section]) {
      sectionMap[section] = {
        key: section,
        title: SECTION_TITLES[section] || section,
        artifacts: [],
      };
    }

    // Generate signed URL for download
    let downloadUrl: string | null = null;
    try {
      downloadUrl = await getSignedUrl(artifact.object_key, 86400); // 24hr URL
    } catch {
      console.warn(`[stageC] Could not generate signed URL for ${artifact.object_key}`);
    }

    sectionMap[section].artifacts.push({
      artifact_key: artifact.artifact_key,
      display_title: artifact.display_title,
      status: 'ready',
      order_index: artifact.order_index,
      download_url: downloadUrl,
      preview_type: artifact.preview_type || 'none',
    });
  }

  // Sort artifacts within each section
  for (const section of Object.values(sectionMap)) {
    section.artifacts.sort((a, b) => a.order_index - b.order_index);
  }

  // Order sections
  const sectionOrder = ['start_here', 'apply', 'battle_plan', 'interview', 'barriers', 'online'];
  const orderedSections = sectionOrder
    .filter(key => sectionMap[key])
    .map(key => sectionMap[key]);

  const manifest = {
    sections: orderedSections,
    recommended_next_action: 'Review all artifacts, then approve the package for delivery.',
    package_complete: true,
  };

  // Update bundle manifest
  await query(
    `UPDATE bundle SET manifest = $2 WHERE id = $1`,
    [bundleId, JSON.stringify(manifest)]
  );

  console.log(`[stageC] Manifest updated for bundle ${bundleId}: ${artifacts.length} artifacts across ${orderedSections.length} sections`);
}

/**
 * Stage C Step 2: Generate a ZIP of all artifacts and upload to R2.
 */
export async function generateZip(
  bundleId: string,
  artifacts: ArtifactRow[]
): Promise<{ fileObjectId: string; byteSize: number }> {
  const bundle = await getOne<BundleRow>(
    `SELECT * FROM bundle WHERE id = $1`,
    [bundleId]
  );
  if (!bundle) throw new Error(`Bundle ${bundleId} not found`);

  // Create ZIP archive
  const archive = archiver('zip', { zlib: { level: 6 } });
  const chunks: Buffer[] = [];

  archive.on('data', (chunk: Buffer) => chunks.push(chunk));

  // Download each artifact from R2 and add to ZIP
  for (const artifact of artifacts) {
    try {
      const signedUrl = await getSignedUrl(artifact.object_key, 3600);
      const response = await fetch(signedUrl);
      if (!response.ok) {
        console.warn(`[stageC] Failed to fetch ${artifact.object_key}: ${response.status}`);
        continue;
      }
      const buffer = Buffer.from(await response.arrayBuffer());

      // Use a clean filename
      const fileName = artifact.file_name || `${artifact.artifact_key}.bin`;
      archive.append(buffer, { name: fileName });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      console.warn(`[stageC] Error adding ${artifact.artifact_key} to ZIP: ${msg}`);
    }
  }

  await archive.finalize();

  // Wait for all data
  await new Promise<void>((resolve, reject) => {
    archive.on('end', resolve);
    archive.on('error', reject);
  });

  const zipBuffer = Buffer.concat(chunks);

  // Upload ZIP to R2
  const zipKey = `${bundle.org_id}/${bundle.project_id}/bundles/${bundle.run_id}/Career_Package.zip`;
  const fileObject = await uploadFile(
    bundle.org_id, zipKey, zipBuffer,
    'application/zip'
  );

  // Store file_object_id on the bundle
  await query(
    `UPDATE bundle SET zip_file_object_id = $2 WHERE id = $1`,
    [bundleId, fileObject.id]
  );

  console.log(`[stageC] ZIP generated for bundle ${bundleId}: ${zipBuffer.length} bytes, ${artifacts.length} files`);

  return { fileObjectId: fileObject.id, byteSize: zipBuffer.length };
}

/**
 * Stage C Step 3: Set bundle status to 'awaiting_review'.
 */
export async function setBundleStatus(
  bundleId: string,
  status: 'awaiting_review' | 'ready' | 'published'
): Promise<void> {
  await query(
    `UPDATE bundle SET status = $2 WHERE id = $1`,
    [bundleId, status]
  );

  const bundle = await getOne<BundleRow>(
    `SELECT * FROM bundle WHERE id = $1`,
    [bundleId]
  );

  if (bundle) {
    await emitEvent({
      org_id: bundle.org_id,
      project_id: bundle.project_id,
      run_id: bundle.run_id,
      step_id: null,
      event_type: 'RUN_COMPLETED',
      severity: 'info',
      actor_type: 'system',
      actor_user_id: null,
      actor_label: 'stage-c',
      data_classification: 'internal',
      retention_class: 'standard',
      correlation_id: null,
      parent_event_id: null,
      payload: {
        bundle_id: bundleId,
        bundle_status: status,
        message: 'All artifacts generated. Package ready for review.',
      },
      sensitive_ref: null,
    });
  }

  console.log(`[stageC] Bundle ${bundleId} status set to: ${status}`);
}

/**
 * Run the full Stage C assembly pipeline.
 * Called after detecting all artifacts are complete.
 */
export async function runStageC(bundleId: string): Promise<void> {
  console.log(`[stageC] Starting assembly for bundle ${bundleId}...`);

  const artifacts = await checkBundleComplete(bundleId);
  if (!artifacts) {
    console.log(`[stageC] Bundle ${bundleId} not yet complete — skipping assembly`);
    return;
  }

  // Step 1: Update manifest with real URLs
  await updateManifest(bundleId, artifacts);

  // Step 2: Generate ZIP bundle
  const { fileObjectId, byteSize } = await generateZip(bundleId, artifacts);
  console.log(`[stageC] ZIP uploaded: file_object=${fileObjectId}, ${byteSize} bytes`);

  // Step 3: Set status to awaiting_review
  await setBundleStatus(bundleId, 'awaiting_review');

  console.log(`[stageC] Assembly complete for bundle ${bundleId}`);
}
