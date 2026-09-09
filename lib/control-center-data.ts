export type JobStatus =
  | "Success"
  | "Running"
  | "Failed"
  | "Ready"
  | "Pending"
  | "Warning"
  | "Skipped";

export type Job = {
  id: string;
  name: string;
  description: string;
  group: string;
  type: "Daily" | "Special" | "Ad-hoc";
  environment: "DEV" | "SIT" | "UAT" | "PROD";
  expectedStart: string;
  expectedEnd: string;
  actualStart?: string;
  actualEnd?: string;
  duration: string;
  averageDuration: string;
  status: JobStatus;
  preStatus: JobStatus | "Not Applicable";
  postStatus: JobStatus | "Not Applicable";
  fileStatus: JobStatus | "Not Applicable";
  reportStatus: JobStatus | "Not Applicable";
  preCount?: number;
  postCount?: number;
  redwoodId: string;
  executionId: string;
  source: string;
  query: string;
  datasource: string;
};

export const jobs: Job[] = [
  {
    id: "job-001",
    name: "DOH-DOB Inbound",
    description: "Processes verified birth records from the daily inbound feed.",
    group: "Eligibility Intake",
    type: "Daily",
    environment: "UAT",
    expectedStart: "07:00",
    expectedEnd: "07:18",
    actualStart: "07:01",
    actualEnd: "07:16",
    duration: "15m 12s",
    averageDuration: "16m 08s",
    status: "Success",
    preStatus: "Success",
    postStatus: "Success",
    fileStatus: "Success",
    reportStatus: "Success",
    preCount: 482,
    postCount: 482,
    redwoodId: "RMJ-DOH-DOB-01",
    executionId: "EXE-0827-0701",
    source: "EXCEL_DAILY",
    query: "SELECT COUNT(*) FROM DOB_INBOUND WHERE BUSINESS_DATE = :businessDate",
    datasource: "BES UAT Oracle",
  },
  {
    id: "job-002",
    name: "DOD Outbound Extract",
    description: "Builds the outbound death-record extract and control totals.",
    group: "Eligibility Outbound",
    type: "Daily",
    environment: "UAT",
    expectedStart: "07:30",
    expectedEnd: "07:58",
    actualStart: "07:31",
    actualEnd: "07:55",
    duration: "24m 06s",
    averageDuration: "22m 44s",
    status: "Success",
    preStatus: "Success",
    postStatus: "Success",
    fileStatus: "Success",
    reportStatus: "Ready",
    preCount: 126,
    postCount: 0,
    redwoodId: "RMJ-DOH-DOD-04",
    executionId: "EXE-0827-0731",
    source: "EXCEL_DAILY",
    query: "SELECT COUNT(*) FROM DEATH_DETAILS WHERE SENT_IND = 'N'",
    datasource: "BES UAT Oracle",
  },
  {
    id: "job-003",
    name: "DOM Inbound Match",
    description: "Matches marriage records to active client cases.",
    group: "Eligibility Intake",
    type: "Daily",
    environment: "UAT",
    expectedStart: "08:00",
    expectedEnd: "08:25",
    actualStart: "08:03",
    duration: "34m 18s",
    averageDuration: "19m 42s",
    status: "Running",
    preStatus: "Success",
    postStatus: "Pending",
    fileStatus: "Pending",
    reportStatus: "Pending",
    preCount: 318,
    redwoodId: "RMJ-DOH-DOM-02",
    executionId: "EXE-0827-0803",
    source: "EXCEL_DAILY",
    query: "SELECT COUNT(*) FROM DOM_INBOUND_DETAIL WHERE VERIFIED = 0",
    datasource: "BES UAT Oracle",
  },
  {
    id: "job-004",
    name: "Monthly Eligibility Reconciliation",
    description: "Reconciles eligibility totals for the month-end processing window.",
    group: "Month End",
    type: "Special",
    environment: "UAT",
    expectedStart: "08:30",
    expectedEnd: "09:15",
    duration: "Not started",
    averageDuration: "41m 10s",
    status: "Ready",
    preStatus: "Warning",
    postStatus: "Pending",
    fileStatus: "Pending",
    reportStatus: "Pending",
    preCount: 19422,
    redwoodId: "RMJ-MONTH-END-11",
    executionId: "Pending",
    source: "EXCEL_SPECIAL",
    query: "SELECT COUNT(*) FROM ELIGIBILITY_CASE WHERE STATUS = 'ACTIVE'",
    datasource: "BES UAT PostgreSQL",
  },
  {
    id: "job-005",
    name: "Vendor Payment Export",
    description: "Creates the scheduled vendor payment file for downstream transfer.",
    group: "Finance",
    type: "Special",
    environment: "UAT",
    expectedStart: "09:00",
    expectedEnd: "09:20",
    duration: "Not started",
    averageDuration: "18m 32s",
    status: "Pending",
    preStatus: "Pending",
    postStatus: "Pending",
    fileStatus: "Pending",
    reportStatus: "Pending",
    redwoodId: "RMJ-FIN-VPE-05",
    executionId: "Pending",
    source: "EXCEL_SPECIAL",
    query: "SELECT COUNT(*) FROM PAYMENT_QUEUE WHERE EXPORT_DATE = :businessDate",
    datasource: "Finance UAT SQL Server",
  },
  {
    id: "job-006",
    name: "S009 Exception Review",
    description: "Reviews unresolved DOB verification exceptions for manual action.",
    group: "Exceptions",
    type: "Ad-hoc",
    environment: "UAT",
    expectedStart: "09:30",
    expectedEnd: "09:45",
    duration: "Not started",
    averageDuration: "12m 51s",
    status: "Pending",
    preStatus: "Ready",
    postStatus: "Not Applicable",
    fileStatus: "Not Applicable",
    reportStatus: "Pending",
    redwoodId: "RMJ-S009-REVIEW",
    executionId: "Pending",
    source: "MANUAL",
    query: "db.alerts.countDocuments({ code: 'S009', resolved: false })",
    datasource: "BES UAT MongoDB",
  },
  {
    id: "job-007",
    name: "Benefits Case Snapshot",
    description: "Creates the business-date snapshot used by downstream reporting.",
    group: "Reporting",
    type: "Daily",
    environment: "UAT",
    expectedStart: "06:30",
    expectedEnd: "07:05",
    actualStart: "06:31",
    actualEnd: "07:12",
    duration: "41m 02s",
    averageDuration: "25m 20s",
    status: "Warning",
    preStatus: "Success",
    postStatus: "Warning",
    fileStatus: "Success",
    reportStatus: "Success",
    preCount: 84721,
    postCount: 84683,
    redwoodId: "RMJ-RPT-BCS-07",
    executionId: "EXE-0827-0631",
    source: "EXCEL_DAILY",
    query: "SELECT COUNT(*) FROM CASE_SNAPSHOT WHERE SNAPSHOT_DATE = :businessDate",
    datasource: "Reporting UAT PostgreSQL",
  },
  {
    id: "job-008",
    name: "Control Report Publisher",
    description: "Publishes control reports and makes them available to operations.",
    group: "Reporting",
    type: "Daily",
    environment: "UAT",
    expectedStart: "07:15",
    expectedEnd: "07:28",
    actualStart: "07:16",
    actualEnd: "07:22",
    duration: "6m 48s",
    averageDuration: "7m 10s",
    status: "Failed",
    preStatus: "Not Applicable",
    postStatus: "Failed",
    fileStatus: "Success",
    reportStatus: "Failed",
    redwoodId: "RMJ-RPT-CTRL-08",
    executionId: "EXE-0827-0716",
    source: "EXCEL_DAILY",
    query: "SELECT COUNT(*) FROM REPORT_ARTIFACT WHERE PUBLISHED = FALSE",
    datasource: "Reporting UAT PostgreSQL",
  },
];

export const history = [
  { date: "Aug 27, 2026", job: "Control Report Publisher", id: "EXE-0827-0716", group: "Reporting", duration: "6m 48s", status: "Failed" },
  { date: "Aug 27, 2026", job: "Benefits Case Snapshot", id: "EXE-0827-0631", group: "Reporting", duration: "41m 02s", status: "Warning" },
  { date: "Aug 26, 2026", job: "DOH-DOB Inbound", id: "EXE-0826-0700", group: "Eligibility Intake", duration: "16m 44s", status: "Success" },
  { date: "Aug 26, 2026", job: "DOD Outbound Extract", id: "EXE-0826-0730", group: "Eligibility Outbound", duration: "21m 17s", status: "Success" },
  { date: "Aug 26, 2026", job: "DOM Inbound Match", id: "EXE-0826-0800", group: "Eligibility Intake", duration: "19m 03s", status: "Success" },
];

export const excelVersions = [
  { version: "Version 12", file: "Batch_Jobs_Aug_27.xlsx", uploaded: "Aug 27, 2026 at 06:42", user: "Operations Admin", rows: 147, status: "Active", changes: "+3 added  ·  4 updated  ·  1 deactivated" },
  { version: "Version 11", file: "Batch_Jobs_Aug_20.xlsx", uploaded: "Aug 20, 2026 at 10:18", user: "Operations Admin", rows: 145, status: "Previous", changes: "+2 added  ·  7 updated" },
  { version: "Version 10", file: "Batch_Jobs_Aug_13.xlsx", uploaded: "Aug 13, 2026 at 09:05", user: "Batch Operator", rows: 143, status: "Previous", changes: "+1 added  ·  2 updated" },
];

export const audits = [
  { time: "08:27:14", user: "Batch Operator", action: "Pre-validation executed", entity: "Monthly Eligibility Reconciliation", result: "Warning" },
  { time: "08:14:09", user: "System", action: "Scheduler status refreshed", entity: "DOM Inbound Match", result: "Success" },
  { time: "07:55:31", user: "System", action: "Post-validation executed", entity: "DOD Outbound Extract", result: "Success" },
  { time: "07:23:02", user: "System", action: "Control report fetch failed", entity: "Control Report Publisher", result: "Failed" },
  { time: "06:42:18", user: "Operations Admin", action: "Excel version imported", entity: "Batch_Jobs_Aug_27.xlsx", result: "Success" },
];
