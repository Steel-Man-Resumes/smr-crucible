/**
 * gen_tracker — Job Application Tracker (XLSX)
 *
 * Consumes: employers_enriched.v1
 * Template-based — no AI needed
 */
import { getRunData, uploadFile, insert, emitEvent } from '@crucible/core';
import type { EmployersV1Type } from '@crucible/core';
import ExcelJS from 'exceljs';
import type { ArtifactJobData, GeneratorResult } from './types';

const GOLD = 'FFD4A84B';
const GOLD_LIGHT = 'FFFDF6E3';
const DARK = 'FF1A1A1A';
const GRAY = 'FF666666';

export async function generateTracker(job: ArtifactJobData): Promise<GeneratorResult> {
  const { runId, bundleId, orgId, projectId, artifactKey } = job;

  const employers = await getRunData<EmployersV1Type>(runId, 'employers_enriched.v1');

  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'Steel Man Resumes';
  workbook.created = new Date();

  // ── Sheet 1: Job Applications ──
  const sheet = workbook.addWorksheet('Job Applications', {
    properties: { defaultColWidth: 18 },
  });

  const headerRow = sheet.addRow([
    'Company', 'Position', 'Date Applied', 'Follow-Up Date',
    'Status', 'Contact Person', 'Contact Info', 'Notes',
  ]);

  // Style header
  headerRow.eachCell(cell => {
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: GOLD } };
    cell.font = { bold: true, color: { argb: DARK }, size: 11, name: 'Calibri' };
    cell.alignment = { horizontal: 'center', vertical: 'middle' };
    cell.border = {
      bottom: { style: 'medium', color: { argb: DARK } },
    };
  });

  // Set column widths
  sheet.getColumn(1).width = 25;  // Company
  sheet.getColumn(2).width = 22;  // Position
  sheet.getColumn(3).width = 14;  // Date Applied
  sheet.getColumn(4).width = 14;  // Follow-Up
  sheet.getColumn(5).width = 16;  // Status
  sheet.getColumn(6).width = 20;  // Contact
  sheet.getColumn(7).width = 22;  // Contact Info
  sheet.getColumn(8).width = 30;  // Notes

  // Pre-populate Tier 1 employers
  for (const emp of employers.tier1.slice(0, 10)) {
    const row = sheet.addRow([
      emp.name,
      '',  // Position — user fills in
      '',  // Date Applied
      '',  // Follow-Up
      'Not Applied',
      emp.contact_name || '',
      [emp.phone, emp.website].filter(Boolean).join(' | ') || '',
      emp.why_good_fit ? `Fit: ${emp.why_good_fit.substring(0, 80)}` : '',
    ]);

    row.eachCell(cell => {
      cell.font = { size: 10, name: 'Calibri' };
      cell.alignment = { vertical: 'middle', wrapText: true };
    });
    // Light gold background for pre-populated rows
    row.getCell(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: GOLD_LIGHT } };
  }

  // Add 50 blank rows
  for (let i = 0; i < 50; i++) {
    const row = sheet.addRow(['', '', '', '', '', '', '', '']);
    row.eachCell(cell => {
      cell.font = { size: 10, name: 'Calibri' };
      cell.alignment = { vertical: 'middle' };
    });
  }

  // Status dropdown (Data Validation)
  const statusCol = sheet.getColumn(5);
  for (let r = 2; r <= 62; r++) {
    sheet.getCell(`E${r}`).dataValidation = {
      type: 'list',
      allowBlank: true,
      formulae: ['"Not Applied,Applied,Phone Screen,Interview Scheduled,Interviewed,Offer Received,Accepted,Declined,No Response"'],
    };
  }

  // ── Sheet 2: Summary ──
  const summary = workbook.addWorksheet('Summary', {
    properties: { defaultColWidth: 25 },
  });

  const summaryHeader = summary.addRow(['Metric', 'Count']);
  summaryHeader.eachCell(cell => {
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: GOLD } };
    cell.font = { bold: true, color: { argb: DARK }, size: 11, name: 'Calibri' };
  });

  const metrics = [
    ['Total Applications', `=COUNTA('Job Applications'!A2:A62)-COUNTBLANK('Job Applications'!C2:C62)+COUNTA('Job Applications'!C2:C62)`],
    ['Applied', `=COUNTIF('Job Applications'!E2:E62,"Applied")`],
    ['Phone Screens', `=COUNTIF('Job Applications'!E2:E62,"Phone Screen")`],
    ['Interviews Scheduled', `=COUNTIF('Job Applications'!E2:E62,"Interview Scheduled")`],
    ['Interviewed', `=COUNTIF('Job Applications'!E2:E62,"Interviewed")`],
    ['Offers Received', `=COUNTIF('Job Applications'!E2:E62,"Offer Received")`],
    ['No Response', `=COUNTIF('Job Applications'!E2:E62,"No Response")`],
  ];

  for (const [label, formula] of metrics) {
    const row = summary.addRow([label, { formula }]);
    row.getCell(1).font = { bold: true, size: 10, name: 'Calibri' };
    row.getCell(2).font = { size: 10, name: 'Calibri' };
    row.getCell(2).alignment = { horizontal: 'center' };
  }

  summary.getColumn(1).width = 25;
  summary.getColumn(2).width = 15;

  // Generate buffer
  const buffer = Buffer.from(await workbook.xlsx.writeBuffer());

  const fileName = 'Job_Application_Tracker.xlsx';
  const objectKey = `${orgId}/${projectId}/artifacts/${runId}/${fileName}`;
  const fileObject = await uploadFile(orgId, objectKey, buffer, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');

  const artifact = await insert<{ id: string }>('artifact', {
    org_id: orgId, run_id: runId, project_id: projectId,
    artifact_type: artifactKey, artifact_key: artifactKey, bundle_id: bundleId,
    file_object_id: fileObject.id, display_title: 'Job Application Tracker',
    display_section: 'apply', preview_type: 'none', order_index: 22, version: 1, review_status: 'pending',
  });

  await emitEvent({
    org_id: orgId, project_id: projectId, run_id: runId, step_id: null,
    event_type: 'ARTIFACT_GENERATED', severity: 'info',
    actor_type: 'system', actor_user_id: null, actor_label: 'gen_tracker',
    data_classification: 'internal', retention_class: 'standard',
    correlation_id: null, parent_event_id: null, sensitive_ref: null,
    payload: { artifact_id: artifact.id, artifact_key: artifactKey, file_name: fileName, byte_size: buffer.length, pre_populated_rows: Math.min(employers.tier1.length, 10) },
  });

  console.log(`[gen_tracker] Tracker generated: ${fileName} (${buffer.length} bytes, ${Math.min(employers.tier1.length, 10)} pre-populated)`);
  return { artifactKey, fileObjectId: fileObject.id, fileName, byteSize: buffer.length };
}
