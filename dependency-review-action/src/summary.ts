import * as core from '@actions/core'
import {ConfigurationOptions, Changes, Change} from './schemas'
import {SummaryTableRow} from '@actions/core/lib/summary'
import {InvalidLicenseChanges, InvalidLicenseChangeTypes} from './licenses'
import {groupDependenciesByManifest, getManifestsSet, renderUrl} from './utils'

const icons = {
  check: '✅',
  cross: '❌',
  warning: '⚠️'
}

export function addSummaryToSummary(
  vulnerableChanges: Changes,
  invalidLicenseChanges: InvalidLicenseChanges,
  deniedChanges: Changes,
  config: ConfigurationOptions
): void {
  core.summary.addHeading('Dependency Review', 1)

  if (
    vulnerableChanges.length === 0 &&
    countLicenseIssues(invalidLicenseChanges) === 0 &&
    deniedChanges.length === 0
  ) {
    if (!config.license_check) {
      core.summary.addRaw(`${icons.check} No vulnerabilities found.`)
    } else if (!config.vulnerability_check) {
      core.summary.addRaw(`${icons.check} No license issues found.`)
    } else {
      core.summary.addRaw(
        `${icons.check} No vulnerabilities or license issues found.`
      )
    }

    return
  }

  core.summary
    .addRaw('The following issues were found:')
    .addList([
      ...(config.vulnerability_check
        ? [
            `${checkOrFailIcon(vulnerableChanges.length)} ${
              vulnerableChanges.length
            } vulnerable package(s)`
          ]
        : []),
      ...(config.license_check
        ? [
            `${checkOrFailIcon(invalidLicenseChanges.forbidden.length)} ${
              invalidLicenseChanges.forbidden.length
            } package(s) with incompatible licenses`,
            `${checkOrFailIcon(invalidLicenseChanges.unresolved.length)} ${
              invalidLicenseChanges.unresolved.length
            } package(s) with invalid SPDX license definitions`,
            `${checkOrWarnIcon(invalidLicenseChanges.unlicensed.length)} ${
              invalidLicenseChanges.unlicensed.length
            } package(s) with unknown licenses.`
          ]
        : []),
      ...(deniedChanges.length > 0
        ? [
            `${checkOrWarnIcon(deniedChanges.length)} ${
              deniedChanges.length
            } package(s) denied.`
          ]
        : [])
    ])
    .addRaw('See the Details below.')
}

export function addChangeVulnerabilitiesToSummary(
  vulnerableChanges: Changes,
  severity: string
): void {
  if (vulnerableChanges.length === 0) {
    return
  }

  const rows: SummaryTableRow[] = []

  const manifests = getManifestsSet(vulnerableChanges)

  core.summary.addHeading('Vulnerabilities', 2)

  for (const manifest of manifests) {
    for (const change of vulnerableChanges.filter(
      pkg => pkg.manifest === manifest
    )) {
      let previous_package = ''
      let previous_version = ''
      for (const vuln of change.vulnerabilities) {
        const sameAsPrevious =
          previous_package === change.name &&
          previous_version === change.version

        if (!sameAsPrevious) {
          rows.push([
            renderUrl(change.source_repository_url, change.name),
            change.version,
            renderUrl(vuln.advisory_url, vuln.advisory_summary),
            vuln.severity
          ])
        } else {
          rows.push([
            {data: '', colspan: '2'},
            renderUrl(vuln.advisory_url, vuln.advisory_summary),
            vuln.severity
          ])
        }
        previous_package = change.name
        previous_version = change.version
      }
    }
    core.summary.addHeading(`<em>${manifest}</em>`, 4).addTable([
      [
        {data: 'Name', header: true},
        {data: 'Version', header: true},
        {data: 'Vulnerability', header: true},
        {data: 'Severity', header: true}
      ],
      ...rows
    ])
  }

  if (severity !== 'low') {
    core.summary.addQuote(
      `Only included vulnerabilities with severity <strong>${severity}</strong> or higher.`
    )
  }
}

export function addLicensesToSummary(
  invalidLicenseChanges: InvalidLicenseChanges,
  config: ConfigurationOptions
): void {
  if (countLicenseIssues(invalidLicenseChanges) === 0) {
    return
  }

  core.summary.addHeading('License Issues', 2)
  printLicenseViolations(invalidLicenseChanges)

  if (config.allow_licenses && config.allow_licenses.length > 0) {
    core.summary.addQuote(
      `<strong>Allowed Licenses</strong>: ${config.allow_licenses.join(', ')}`
    )
  }
  if (config.deny_licenses && config.deny_licenses.length > 0) {
    core.summary.addQuote(
      `<strong>Denied Licenses</strong>: ${config.deny_licenses.join(', ')}`
    )
  }
  if (config.allow_dependencies_licenses) {
    core.summary.addQuote(
      `<strong>Excluded from license check</strong>: ${config.allow_dependencies_licenses.join(
        ', '
      )}`
    )
  }

  core.debug(
    `found ${invalidLicenseChanges.unlicensed.length} unknown licenses`
  )

  core.debug(
    `${invalidLicenseChanges.unresolved.length} licenses could not be validated`
  )
}

const licenseIssueTypes: InvalidLicenseChangeTypes[] = [
  'forbidden',
  'unresolved',
  'unlicensed'
]

const issueTypeNames: Record<InvalidLicenseChangeTypes, string> = {
  forbidden: 'Incompatible License',
  unresolved: 'Invalid SPDX License',
  unlicensed: 'Unknown License'
}

function printLicenseViolations(changes: InvalidLicenseChanges): void {
  const rowsGroupedByManifest: Record<string, SummaryTableRow[]> = {}

  for (const issueType of licenseIssueTypes) {
    for (const change of changes[issueType]) {
      if (!rowsGroupedByManifest[change.manifest]) {
        rowsGroupedByManifest[change.manifest] = []
      }
      rowsGroupedByManifest[change.manifest].push([
        renderUrl(change.source_repository_url, change.name),
        change.version,
        formatLicense(change.license),
        issueTypeNames[issueType]
      ])
    }
  }

  for (const [manifest, rows] of Object.entries(rowsGroupedByManifest)) {
    core.summary.addHeading(`<em>${manifest}</em>`, 4)
    core.summary.addTable([
      ['Package', 'Version', 'License', 'Issue Type'],
      ...rows
    ])
  }
}

function formatLicense(license: string | null): string {
  if (license === null || license === 'NOASSERTION') {
    return 'Null'
  }
  return license
}

export function addScannedDependencies(changes: Changes): void {
  const dependencies = groupDependenciesByManifest(changes)
  const manifests = dependencies.keys()

  const summary = core.summary.addHeading('Scanned Manifest Files', 2)

  for (const manifest of manifests) {
    const deps = dependencies.get(manifest)
    if (deps) {
      const dependencyNames = deps.map(
        dependency => `<li>${dependency.name}@${dependency.version}</li>`
      )
      summary.addDetails(manifest, `<ul>${dependencyNames.join('')}</ul>`)
    }
  }
}

function snapshotWarningRecommendation(
  config: ConfigurationOptions,
  warnings: string
): string {
  const no_pr_snaps = warnings.includes(
    'No snapshots were found for the head SHA'
  )
  const retries_disabled = !config.retry_on_snapshot_warnings
  if (no_pr_snaps && retries_disabled) {
    return 'Ensure that dependencies are being submitted on PR branches and consider enabling <em>retry-on-snapshot-warnings</em>.'
  } else if (no_pr_snaps) {
    return 'Ensure that dependencies are being submitted on PR branches. Re-running this action after a short time may resolve the issue.'
  } else if (retries_disabled) {
    return 'Consider enabling <em>retry-on-snapshot-warnings</em>.'
  }
  return 'Re-running this action after a short time may resolve the issue.'
}

export function addSnapshotWarnings(
  config: ConfigurationOptions,
  warnings: string
): void {
  core.summary.addHeading('Snapshot Warnings', 2)
  core.summary.addQuote(`${icons.warning}: ${warnings}`)
  const recommendation = snapshotWarningRecommendation(config, warnings)
  const docsLink =
    'See <a href="https://docs.github.com/en/code-security/supply-chain-security/understanding-your-software-supply-chain/about-dependency-review#best-practices-for-using-the-dependency-review-api-and-the-dependency-submission-api-together">the documentation</a> for more information and troubleshooting advice.'
  core.summary.addRaw(`${recommendation} ${docsLink}`)
}

function countLicenseIssues(
  invalidLicenseChanges: InvalidLicenseChanges
): number {
  return Object.values(invalidLicenseChanges).reduce(
    (acc, val) => acc + val.length,
    0
  )
}

export function addDeniedToSummary(deniedChanges: Change[]): void {
  if (deniedChanges.length === 0) {
    return
  }

  core.summary.addHeading('Denied dependencies', 2)
  for (const change of deniedChanges) {
    core.summary.addHeading(`<em>Denied dependencies</em>`, 4)
    core.summary.addTable([
      ['Package', 'Version', 'License'],
      [
        renderUrl(change.source_repository_url, change.name),
        change.version,
        change.license || ''
      ]
    ])
  }
}

function checkOrFailIcon(count: number): string {
  return count === 0 ? icons.check : icons.cross
}

function checkOrWarnIcon(count: number): string {
  return count === 0 ? icons.check : icons.warning
}
