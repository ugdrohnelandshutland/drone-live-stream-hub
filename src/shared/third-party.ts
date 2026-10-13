/** `/third-party.json`: the open-source packages shipped in the service and the web UI. */
export interface ThirdPartyPackage {
  name: string;
  version: string;
  /** SPDX expression from package.json, e.g. "MIT". */
  license: string;
  /** Copyright and license text from the package's LICENSE file; empty if it has none. */
  licenseText: string;
}

export interface ThirdPartyNotices {
  /** Packages inlined into the web UI bundle. */
  web: ThirdPartyPackage[];
  /** Packages inlined into the bundled service (Windows package, Docker image). */
  service: ThirdPartyPackage[];
}
